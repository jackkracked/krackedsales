#!/usr/bin/env node
/**
 * Work out WHO BOOKED each appointment and record it on `calls.booked_by_ghl_user_id`.
 *
 * WHY
 * `calls.rep_email` says who ATTENDS a call. Nothing said who SET it. A setter books for
 * closers, so without this their headline metric cannot exist and their work counts on the
 * closer's row instead.
 *
 * GoHighLevel only names a user when a human creates the appointment inside GHL. Measured over
 * 60 days across every calendar:
 *     booking_widget      ~50   no userId   (the PROSPECT booked, via a link a rep sent)
 *     google_calendar     ~29   no userId   (synced in from Google, e.g. internal "Gage x Alice")
 *     contactdetails_page  13   userId ✓    (a rep added it by hand in GHL)
 * So `createdBy.userId` alone credits ~13 of ~90 appointments. The other sources are not
 * failures of the sync — GHL genuinely does not consider a staff member to have created them.
 *
 * THE THREE TIERS (most specific first)
 *   1. manual   — createdBy.userId. A rep booked it inside GHL. Unambiguous.
 *   2. link     — the prospect self-booked through the widget, so credit the rep who SENT them
 *                 the booking link: the last OUTBOUND message containing "widget/bookings"
 *                 before the appointment was created. Outbound messages carry `userId` only when
 *                 a human sent them (automations do not), which is exactly the distinction we
 *                 want — an automated blast should not earn a setter commission.
 *   3. owner    — no link trail, so fall back to the contact's assigned owner. This is the
 *                 safety net for a prospect who books under DIFFERENT details: GHL then creates
 *                 a new contact, the message history sits on the old record and tier 2 misses,
 *                 but the new contact is still assigned to the rep working it.
 *   none        — a genuinely cold booking straight off an ad with no rep involvement. Left
 *                 unattributed ON PURPOSE. Nobody set it, so nobody should be credited.
 *
 * READ-ONLY against GHL. Writes one column in our own database. Sends nothing.
 *
 * Usage:
 *   node scripts/attribute-booked-calls.mjs --days=30           # dry run
 *   node scripts/attribute-booked-calls.mjs --days=30 --commit
 *   node scripts/attribute-booked-calls.mjs --since=2026-08-01 --commit
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const COMMIT = process.argv.includes("--commit");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const sinceArg = process.argv.find((a) => a.startsWith("--since="));

const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));
const TOKEN = env("GHL_PRIVATE_TOKEN");
const LOC = env("GHL_LOCATION_ID");
const H = (version) => ({ Authorization: `Bearer ${TOKEN}`, Version: version, Accept: "application/json" });

let apiCalls = 0;
async function api(url, version = "2021-04-15") {
  for (let attempt = 1; attempt <= 4; attempt++) {
    apiCalls++;
    const res = await fetch(url, { headers: H(version) });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    if (!res.ok) return null;
    return res.json();
  }
  return null;
}

const startMs = sinceArg
  ? new Date(sinceArg.split("=")[1]).getTime()
  : Date.now() - 1000 * 60 * 60 * 24 * Number(daysArg?.split("=")[1] ?? 30);
const endMs = Date.now();
console.log(`window: ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}\n`);

// Map GHL user ids to names, purely so the report is readable.
const users = await sql`SELECT ghl_user_id, name FROM users WHERE ghl_user_id IS NOT NULL`;
const nameFor = new Map(users.map((u) => [u.ghl_user_id, u.name]));

const cals = (await api(`https://services.leadconnectorhq.com/calendars/?locationId=${LOC}`))?.calendars ?? [];

// ── Gather every appointment in the window ──────────────────────────────────────────────────
const appts = [];
for (const c of cals) {
  const j = await api(`https://services.leadconnectorhq.com/calendars/events?locationId=${LOC}&calendarId=${c.id}&startTime=${startMs}&endTime=${endMs}`);
  for (const e of j?.events ?? []) appts.push(e);
}
console.log(`appointments found: ${appts.length}`);

// ── Resolve a booker for each ───────────────────────────────────────────────────────────────
const results = [];
const contactOwnerCache = new Map();

for (const ev of appts) {
  const createdBy = typeof ev.createdBy === "object" ? ev.createdBy : null;

  // Tier 1 — a human created it inside GHL.
  if (createdBy?.userId) {
    results.push({ ev, userId: createdBy.userId, tier: "manual" });
    continue;
  }

  // Internal Google-synced events have no contact and are not client bookings at all.
  if (!ev.contactId) {
    results.push({ ev, userId: null, tier: "none (no contact)" });
    continue;
  }

  // Tier 2 — who sent them the booking link?
  // EVERY conversation for the contact, not just one. GHL keeps a separate conversation per
  // channel (SMS, email, Messenger), so `limit=1` looked in one thread and missed links sent in
  // any other — which is why this tier originally matched nothing at all.
  let linkSender = null;
  const convs = (await api(`https://services.leadconnectorhq.com/conversations/search?locationId=${LOC}&contactId=${ev.contactId}&limit=20`, "2021-07-28"))?.conversations ?? [];
  const bookedAt = new Date(ev.dateAdded).getTime();
  const candidates = [];
  for (const conv of convs) {
    const m = await api(`https://services.leadconnectorhq.com/conversations/${conv.id}/messages`);
    const msgs = m?.messages?.messages ?? m?.messages ?? [];
    for (const x of msgs) {
      // `userId` is present only when a HUMAN sent it — automations carry none, and an
      // automated blast must not earn a setter commission.
      if (x.direction !== "outbound" || !x.userId) continue;
      if (!/widget\/bookings/i.test(x.body ?? "")) continue;
      if (new Date(x.dateAdded).getTime() > bookedAt) continue;
      candidates.push(x);
    }
  }
  // LAST sender before the booking wins: if two reps sent links, they acted on the most recent.
  candidates.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
  linkSender = candidates[0]?.userId ?? null;
  if (linkSender) {
    results.push({ ev, userId: linkSender, tier: "link" });
    continue;
  }

  // Tier 3 — the contact's assigned owner.
  if (!contactOwnerCache.has(ev.contactId)) {
    const c = await api(`https://services.leadconnectorhq.com/contacts/${ev.contactId}`, "2021-07-28");
    contactOwnerCache.set(ev.contactId, c?.contact?.assignedTo ?? null);
  }
  const owner = contactOwnerCache.get(ev.contactId);
  results.push({ ev, userId: owner ?? null, tier: owner ? "owner" : "none (cold booking)" });
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────
const byTier = {}, byRep = {};
for (const r of results) {
  byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
  if (r.userId) {
    const n = nameFor.get(r.userId) ?? `unknown (${r.userId.slice(0, 8)})`;
    byRep[n] = (byRep[n] ?? 0) + 1;
  }
}
console.log(`\nHOW EACH WAS ATTRIBUTED`);
for (const [k, v] of Object.entries(byTier).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`);
console.log(`\nCALLS BOOKED BY`);
for (const [k, v] of Object.entries(byRep).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`);
console.log(`\nGHL API calls used: ${apiCalls}`);

if (!COMMIT) {
  console.log("\nDRY RUN — re-run with --commit to write.");
  process.exit(0);
}

// ── Write ───────────────────────────────────────────────────────────────────────────────────
// Matched on meet_conference_id, the dedup key the calls sync already uses for appointments.
let written = 0;
for (const r of results) {
  if (!r.userId) continue;
  // RETURNING is required — a bare UPDATE reports nothing, which made an earlier run print
  // "rows updated: 0" while it had in fact written every row.
  const res = await sql`
    UPDATE calls SET booked_by_ghl_user_id = ${r.userId}
    WHERE meet_conference_id = ${`ghlappt_${r.ev.id}`}
      AND booked_by_ghl_user_id IS DISTINCT FROM ${r.userId}
    RETURNING id`;
  written += res.length ?? 0;
}
console.log(`\n✔ attribution written. rows updated: ${written}`);
