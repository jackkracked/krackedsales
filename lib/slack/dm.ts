/**
 * Send a Slack direct message to a teammate.
 *
 * Distinct from the existing channel posts: those go to #kracked-ai-sales for the team,
 * these go to one person about their own work. Jack, 2026-09-22: DM, not a channel post,
 * so the shared channel stays a summary feed rather than a task queue.
 *
 * Scopes required and already granted on the bot token: `im:write` to open the DM and
 * `chat:write` to post. Verified 2026-09-22, no Slack app changes needed.
 *
 * NEVER THROWS. A task assignment must not fail because Slack is down or someone has not
 * been linked yet; the task itself is the durable record and the in-app notification is the
 * fallback. Callers get a boolean so they can tell the user the truth about delivery.
 */
import { db } from "@/lib/db";
import { slackSettings } from "@/lib/db/schema";

interface SlackDm {
  /** Slack member id, e.g. U013TBC8TFH. From `users.slack_user_id`. */
  slackUserId: string;
  /** Plain fallback text, also what shows in the notification preview. */
  text: string;
  /** Optional Block Kit blocks for the formatted body. */
  blocks?: unknown[];
}

export async function sendSlackDm({ slackUserId, text, blocks }: SlackDm): Promise<boolean> {
  try {
    const [settings] = await db().select().from(slackSettings).limit(1);
    if (!settings?.enabled || !settings.botToken) return false;

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      // Posting to a user id opens the DM implicitly, so no separate conversations.open.
      body: JSON.stringify({ channel: slackUserId, text, ...(blocks ? { blocks } : {}) }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      console.error(`[slack/dm] ${slackUserId}: ${data.error}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[slack/dm] failed", err);
    return false;
  }
}

/** Shape a task into the DM body. One place, so every trigger reads identically. */
export function taskDmBlocks(opts: {
  heading: string;
  title: string;
  dueDate?: Date | null;
  priority?: string | null;
  contactName?: string | null;
  assignedByName?: string | null;
  timezone?: string | null;
}): { text: string; blocks: unknown[] } {
  const { heading, title, dueDate, priority, contactName, assignedByName, timezone } = opts;

  const facts: string[] = [];
  if (dueDate) {
    // Rendered in the recipient's own timezone: a due date shown in UTC to someone in
    // California reads as the wrong day for most of the working evening.
    facts.push(
      `*Due* ${dueDate.toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short",
        timeZone: timezone ?? "UTC",
      })}`,
    );
  }
  if (priority && priority !== "medium") facts.push(`*Priority* ${priority}`);
  if (contactName) facts.push(`*Re* ${contactName}`);

  const text = `${heading}: ${title}`;
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `${heading}\n*${title}*` } },
  ];
  if (facts.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: facts.join("  ·  ") }] });
  }
  if (assignedByName) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Assigned by ${assignedByName}` }] });
  }
  return { text, blocks };
}
