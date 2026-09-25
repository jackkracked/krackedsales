#!/usr/bin/env node
/**
 * Attribute GHL calendar appointments to the rep who booked them.
 *
 * 104 rows in `calls` have a NULL `rep_email`, so 22% of calls never reach the rep
 * leaderboard. They are all `call_type: "meet"` / `source: "ghl"` — GHL calendar
 * appointments, not dialer calls. 94 sit on the "Kracked Retention - Intro Call" calendar,
 * whose `teamMembers` array is empty, so there is no calendar-level owner to fall back on.
 *
 * The appointment payload has NO `assignedUserId` and an empty `assignedResources`. What it
 * does carry is `createdBy`:
 *   { source: "contactdetails_page", userId: "…" }  → booked in GHL, ATTRIBUTABLE
 *   { source: "google_calendar" }                   → synced from Google, no rep at all
 *
 * So this recovers the GHL-booked ones and reports the rest honestly rather than guessing.
 * A wrong name on a call is worse than a blank one: it credits the wrong rep on a leaderboard.
 *
 *   node scripts/backfill-call-rep.mjs            # dry run
 *   node scripts/backfill-call-rep.mjs --apply
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  let v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));
const q = (t, p = []) => sql.query(t, p).then((r) => r.rows ?? r);
const APPLY = process.argv.includes("--apply");
const KEY = env("GHL_PRIVATE_TOKEN");

async function ghlGet(url, tries = 0) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}`, Version: "2021-04-15" } });
  if ((r.status === 429 || r.status >= 500) && tries < 4) {
    await new Promise((s) => setTimeout(s, 600 * (tries + 1)));
    return ghlGet(url, tries + 1);
  }
  if (r.status === 404) return null; // appointment deleted in GHL
  if (!r.ok) throw new Error(`GHL ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

async function main() {
  // Map GHL user id → our user, so an appointment's creator resolves to a rep we can credit.
  const users = await q(`select id, email, name, ghl_user_id from users where ghl_user_id is not null`);
  const byGhlId = new Map(users.map((u) => [u.ghl_user_id, u]));
  console.log(`mapped reps: ${users.map((u) => u.email).join(", ")}\n`);

  const rows = await q(
    `select id, contact_name, started_at, meet_conference_id
       from calls
      where rep_email is null and meet_conference_id is not null
      order by started_at desc`,
  );
  console.log(`${rows.length} unattributed appointments to check…\n`);

  const resolved = [];
  const bySource = new Map();
  let gone = 0;

  for (const [i, row] of rows.entries()) {
    const apptId = String(row.meet_conference_id).replace(/^ghlappt_/, "");
    let appt;
    try {
      const j = await ghlGet(`https://services.leadconnectorhq.com/calendars/events/appointments/${apptId}`);
      if (!j) { gone++; continue; }
      appt = j.appointment ?? j.event ?? j;
    } catch (e) {
      console.error(`  ! ${apptId}: ${e.message}`);
      continue;
    }
    const cb = appt.createdBy ?? {};
    const source = typeof cb === "object" ? cb.source ?? "(no source)" : String(cb);
    bySource.set(source, (bySource.get(source) ?? 0) + 1);

    const uid = typeof cb === "object" ? cb.userId ?? cb.id : cb;
    const user = uid ? byGhlId.get(uid) : null;
    if (user) resolved.push({ id: row.id, user, name: row.contact_name, at: row.started_at });

    if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${rows.length}`);
  }

  console.log(`\n── createdBy.source breakdown ───────────────────────`);
  for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`   ${String(s).padEnd(26)} ${n}`);
  if (gone) console.log(`   ${"(deleted in GHL)".padEnd(26)} ${gone}`);

  const perRep = new Map();
  for (const r of resolved) perRep.set(r.user.email, (perRep.get(r.user.email) ?? 0) + 1);
  console.log(`\n── ATTRIBUTABLE ─────────────────────────────────────`);
  console.log(`   ${resolved.length} of ${rows.length} recoverable`);
  for (const [e, n] of [...perRep].sort((a, b) => b[1] - a[1])) console.log(`     ${e.padEnd(34)} ${n}`);
  console.log(`   ${rows.length - resolved.length} carry no rep in GHL at all (Google-Calendar bookings) — left blank.`);

  if (!APPLY) return console.log(`\n  DRY RUN — nothing written. Re-run with --apply.`);
  if (!resolved.length) return console.log(`\n  nothing to write.`);

  let written = 0;
  for (const [email] of perRep) {
    const ids = resolved.filter((r) => r.user.email === email).map((r) => r.id);
    const u = resolved.find((r) => r.user.email === email).user;
    const res = await q(
      `update calls set rep_email = $1, rep_name = $2 where id = any($3::uuid[]) and rep_email is null returning id`,
      [u.email, u.name ?? u.email, ids],
    );
    written += res.length;
    console.log(`   ${email}: ${res.length}`);
  }
  const [{ n }] = await q(`select count(*)::int n from calls where rep_email is null`);
  console.log(`\n✔ attributed ${written}. Still unattributed: ${n}.`);
}

main().catch((e) => { console.error("\n✖", e.message ?? e); process.exit(1); });
