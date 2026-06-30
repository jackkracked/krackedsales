/**
 * share-to-slack.mjs — post a feature update (idiot-proof message + optional GIF) to
 * a Slack channel, using the kracked_ai bot token stored in the app's slack_settings.
 *
 * Nothing is saved to disk by this script. The GIF lives in /tmp (passed in), is read
 * once, uploaded, and the caller deletes it afterwards.
 *
 * Usage:
 *   node --env-file=.env.production.vercel scripts/share-to-slack.mjs /tmp/share-brief.json
 *
 * Brief JSON shape (/tmp/share-brief.json):
 * {
 *   "channel": "kracked-software",        // channel NAME (resolved to id) or a C0... id
 *   "gifPath": "/tmp/feature-demo.gif",   // optional; omit for a message-only post
 *   "title":  "New: click any number in Rep Performance to see the records behind it",
 *   "body":   "Plain-English one or two sentences on what it does and why it helps.",
 *   "steps":  ["Open the Dashboard.", "Click any number next to a rep.", "A panel lists every record behind it."],
 *   "footer": "For admins, to verify every rep's numbers at a glance."
 * }
 *
 * Exit code 0 = posted. Non-zero = failed (prints the reason). Never posts silently.
 */

import { readFile, stat } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const SLACK = "https://slack.com/api";

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(1);
}

/** Read the kracked_ai bot token from the app's slack_settings row. */
async function getBotToken() {
  const url = process.env.DATABASE_URL;
  if (!url) die("DATABASE_URL not set (run with --env-file=.env.production.vercel)");
  const sql = neon(url);
  const rows = await sql`select bot_token from slack_settings limit 1`;
  const token = rows?.[0]?.bot_token;
  if (!token) die("No bot token configured in slack_settings");
  return token;
}

async function slack(token, method, body, isForm = true) {
  const init = { method: "POST", headers: { Authorization: `Bearer ${token}` } };
  if (isForm) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(body).toString();
  } else {
    init.headers["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${SLACK}/${method}`, init).then((r) => r.json());
  return res;
}

/** Resolve a channel NAME to its id; pass a C0... id straight through. */
async function resolveChannelId(token, channel) {
  if (/^[CG][A-Z0-9]{6,}$/.test(channel)) return channel;
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    const res = await slack(token, "conversations.list", {
      limit: "200",
      types: "public_channel,private_channel",
      ...(cursor ? { cursor } : {}),
    });
    if (!res.ok) die(`conversations.list failed: ${res.error}`);
    const hit = res.channels.find((c) => c.name === channel.replace(/^#/, ""));
    if (hit) return hit.id;
    cursor = res.response_metadata?.next_cursor || "";
    if (!cursor) break;
  }
  die(
    `Channel "${channel}" not found among channels the bot can see. ` +
      `Invite the bot first: /invite @kracked_ai in #${channel.replace(/^#/, "")}`
  );
}

/** Compose the idiot-proof message as Slack mrkdwn. */
function composeText({ title, body, steps, footer }) {
  const parts = [];
  if (title) parts.push(`:sparkles: *${title}*`);
  if (body) parts.push(body);
  if (steps?.length) {
    parts.push("*How to use it*");
    parts.push(steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  }
  if (footer) parts.push(`_${footer}_`);
  return parts.join("\n\n");
}

/** Upload a file via the current (non-deprecated) external-upload flow + share it. */
async function uploadAndShare(token, channelId, gifPath, text) {
  const info = await stat(gifPath).catch(() => die(`GIF not found: ${gifPath}`));
  const bytes = await readFile(gifPath);
  const filename = gifPath.split("/").pop();

  // 1) reserve an upload URL
  const reserve = await slack(token, "files.getUploadURLExternal", {
    filename,
    length: String(info.size),
  });
  if (!reserve.ok) {
    if (reserve.error === "missing_scope")
      die("Bot is missing the `files:write` scope. Add it in the Slack app + reinstall.");
    die(`files.getUploadURLExternal failed: ${reserve.error}`);
  }

  // 2) PUT the bytes to that URL
  const put = await fetch(reserve.upload_url, { method: "POST", body: bytes });
  if (!put.ok) die(`upload PUT failed: HTTP ${put.status}`);

  // 3) complete the upload + post into the channel with the message as the comment
  const complete = await slack(
    token,
    "files.completeUploadExternal",
    {
      files: JSON.stringify([{ id: reserve.file_id, title: filename }]),
      channel_id: channelId,
      initial_comment: text,
    }
  );
  if (!complete.ok) {
    if (complete.error === "not_in_channel")
      die("Bot is not in that channel. Run: /invite @kracked_ai there.");
    die(`files.completeUploadExternal failed: ${complete.error}`);
  }
  return complete;
}

/** Message-only post (backend features with nothing to film). */
async function postMessage(token, channelId, text) {
  const res = await slack(token, "chat.postMessage", { channel: channelId, text, mrkdwn: true });
  if (!res.ok) {
    if (res.error === "not_in_channel")
      die("Bot is not in that channel. Run: /invite @kracked_ai there.");
    die(`chat.postMessage failed: ${res.error}`);
  }
  return res;
}

async function main() {
  const briefPath = process.argv[2];
  if (!briefPath) die("Pass the brief JSON path, e.g. /tmp/share-brief.json");
  const brief = JSON.parse(await readFile(briefPath, "utf8"));
  if (!brief.channel) die("brief.channel is required");
  if (!brief.title) die("brief.title is required");

  const token = await getBotToken();
  const channelId = await resolveChannelId(token, brief.channel);
  const text = composeText(brief);

  const result = brief.gifPath
    ? await uploadAndShare(token, channelId, brief.gifPath, text)
    : await postMessage(token, channelId, text);

  console.log(`POSTED to ${brief.channel} (${channelId})`);
  if (result.ts) console.log("ts:", result.ts);
  process.exit(0);
}

main().catch((e) => die(e?.message || String(e)));
