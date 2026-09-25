// READ-ONLY dry-run: identify the mislabeled Management deals sitting under type='project'
// with instalments, and show the exact before/after + Management-MRR impact for Jack's approval.
// Writes NOTHING. Run: node scripts/migrate-13-dryrun.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
const sql = neon(env.DATABASE_URL_UNPOOLED);

const rows = await sql`
  SELECT p.id, p.contact_name, p.status, p.total_amount, p.paid_at, p.created_at,
         p.type, p.payment_structure, p.management_option, p.is_legacy_manual,
         COUNT(i.id)::int AS instalment_count,
         COALESCE(SUM(i.amount), 0) AS instalment_sum,
         MIN(i.due_date) AS first_due, MAX(i.due_date) AS last_due,
         ARRAY_AGG(i.amount ORDER BY i.due_date) AS instalment_amounts,
         ARRAY_AGG(i.paid_at IS NOT NULL ORDER BY i.due_date) AS instalment_paid
  FROM proposals p
  JOIN proposal_instalments i ON i.proposal_id = p.id
  WHERE p.type = 'project'
  GROUP BY p.id
  ORDER BY COUNT(i.id) DESC, p.created_at ASC
`;

const three = rows.filter((r) => r.instalment_count === 3);
const two = rows.filter((r) => r.instalment_count === 2);
const other = rows.filter((r) => r.instalment_count !== 2 && r.instalment_count !== 3);

// total_amount / instalment amount are doublePrecision stored in DOLLARS (Stripe path x100).
const money = (c) => "$" + Number(c).toLocaleString("en-US", { minimumFractionDigits: 0 });
const hasPayment = (r) =>
  r.paid_at != null || r.status === "paid" || (r.instalment_paid || []).some(Boolean);

console.log(`\n=== PROJECT proposals WITH instalments: ${rows.length} total ===`);
console.log(`  3-instalment (candidate → 90-Day Management): ${three.length}`);
console.log(`  2-instalment (LEAVE as project): ${two.length}`);
console.log(`  other instalment counts: ${other.length}`);

console.log(`\n=== THE 3-INSTALMENT DEALS (reclassify candidates) ===`);
let mrrAddPaying = 0;
const paying = [], notPaying = [];
for (const r of three) {
  const amts = (r.instalment_amounts || []).map(money).join(" / ");
  const paid = (r.instalment_paid || []).map((p) => (p ? "✓" : "·")).join("");
  const monthly = Math.round(Number(r.instalment_sum) / 3);
  const pays = hasPayment(r);
  (pays ? paying : notPaying).push(r);
  if (pays) mrrAddPaying += monthly;
  console.log(
    `  ${pays ? "💰" : "  "} ${r.id.slice(0, 8)} | ${(r.contact_name || "?").padEnd(22).slice(0, 22)} | ${String(r.status).padEnd(7)} | total ${money(r.total_amount).padStart(8)} | inst ${amts} paid[${paid}] | mrr/mo ${money(monthly)}`
  );
}
console.log(`\n  DISPLAY fix (type project→management) applies to all ${three.length}.`);
console.log(`  ACTUAL payment evidence (paid_at / a paid instalment): ${paying.length} of ${three.length} deals.`);
console.log(`    → paying: ${paying.map((r) => (r.contact_name || "?").slice(0, 16)).join(", ")}`);
console.log(`    → NO payment (unsigned 'sent' / 'lost' — should NOT enter MRR): ${notPaying.length}`);
console.log(`  Management MRR to ADD if we count ONLY deals with real payments: ${money(mrrAddPaying)}/mo`);

console.log(`\n=== THE 2-INSTALMENT DEALS (stay project, untouched) ===`);
for (const r of two) {
  console.log(`  ${r.id.slice(0, 8)} | ${(r.contact_name || "?").padEnd(24).slice(0, 24)} | ${String(r.status).padEnd(7)} | total ${money(r.total_amount).padStart(9)}`);
}

if (other.length) {
  console.log(`\n=== OTHER (need eyes) ===`);
  for (const r of other) console.log(`  ${r.id.slice(0, 8)} | ${r.contact_name} | ${r.instalment_count} inst | ${r.status}`);
}
console.log("\n(READ-ONLY — nothing was changed.)\n");
