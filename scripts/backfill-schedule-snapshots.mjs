#!/usr/bin/env node
/**
 * Freeze the payment schedule for every proposal a client has ALREADY been sent.
 *
 * MUST run after scripts/apply-0049-schedule-snapshot.mjs and BEFORE deploying the corrected
 * date logic. Deploying first would re-render already-sent proposals with different dates.
 *
 * It deliberately reproduces the OLD, BUGGY algorithm, because the goal is to preserve what the
 * client actually saw, not what they should have seen:
 *   - addPeriod's `count && count > 0 ? count : 1` turned an explicit 0 into 1, so row 1 rendered
 *     one day AFTER the start date (10 Aug start -> "11 Aug").
 *   - rows 2 and 3 used fixed +30 / +60 offsets from the anchor, ignoring any split portions.
 * Do not "fix" the maths in this file. It is a historical record.
 *
 * Only touches rows where schedule_snapshot IS NULL and the proposal has left draft. Idempotent:
 * re-running skips anything already frozen. Pass --commit to write; default is a dry run.
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const COMMIT = process.argv.includes("--commit");
const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MANAGEMENT_TERM_MONTHS = 3;

/** The OLD addPeriod: an explicit 0 fell through to 1. Preserved on purpose. */
function legacyAddDays(date, n) {
  const out = new Date(date);
  const count = n && n > 0 ? n : 1; // <- the bug, reproduced verbatim
  out.setUTCDate(out.getUTCDate() + count);
  return out;
}
function fmtDay(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The OLD managementSchedule, byte-for-byte in behaviour. */
function legacySchedule(row) {
  if (row.payment_structure === "instalment") return null;
  if (row.type !== "management") return null;
  if (row.management_option !== "spread") return null;

  const monthly = row.total_amount;
  const startRaw = row.contract_start_at ?? row.start_date ?? null;
  const start = startRaw ? new Date(startRaw) : null;
  const valid = start && !Number.isNaN(start.getTime()) ? start : null;
  const whenAt = (off, fallback) => (valid ? (fmtDay(legacyAddDays(valid, off)) ?? fallback) : fallback);

  let split = row.first_payment_split;
  if (typeof split === "string") { try { split = JSON.parse(split); } catch { split = null; } }
  split = Array.isArray(split) && split.length > 1 ? split : null;

  const rows = [];
  if (split) {
    split.forEach((portion, i) => rows.push({
      label: i === 0 ? "First payment" : `Portion ${i + 1}`,
      when: whenAt(i === 0 ? 0 : portion.offsetDays ?? 0, i === 0 ? "At signup" : `+${portion.offsetDays ?? 0} days`),
      amount: portion.amount,
    }));
    rows.push({ label: "Month 2", when: whenAt(30, "Day 30"), amount: monthly });
    rows.push({ label: "Month 3", when: whenAt(60, "Day 60"), amount: monthly });
  } else {
    for (let n = 1; n <= MANAGEMENT_TERM_MONTHS; n++) {
      rows.push({
        label: `Payment ${n} of ${MANAGEMENT_TERM_MONTHS}`,
        when: whenAt((n - 1) * 30, n === 1 ? "At signup" : `Day ${(n - 1) * 30}`),
        amount: monthly,
      });
    }
  }
  return rows;
}

const candidates = await sql`
  SELECT id, contact_name, type, payment_structure, management_option, total_amount,
         start_date, contract_start_at, first_payment_split, status
  FROM proposals
  WHERE schedule_snapshot IS NULL
    AND status <> 'draft'
  ORDER BY created_at`;

console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — ${candidates.length} non-draft proposals without a snapshot\n`);

let frozen = 0, skipped = 0;
for (const row of candidates) {
  const rows = legacySchedule(row);
  if (!rows) { skipped++; continue; }
  console.log(`${row.contact_name} (${row.status})`);
  for (const r of rows) console.log(`   ${r.label.padEnd(16)} ${String(r.when).padEnd(14)} $${r.amount}`);
  if (COMMIT) {
    await sql`UPDATE proposals
              SET schedule_snapshot = ${JSON.stringify(rows)}::jsonb, schedule_snapshot_at = now()
              WHERE id = ${row.id} AND schedule_snapshot IS NULL`;
  }
  frozen++;
}

console.log(`\n${COMMIT ? "✔ froze" : "would freeze"} ${frozen}; skipped ${skipped} (no spread schedule to freeze).`);
if (!COMMIT) console.log("Re-run with --commit to write.");
