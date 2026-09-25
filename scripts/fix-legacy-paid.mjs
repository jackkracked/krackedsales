// Reconcile the legacy 90-day deals' instalment paid-state to their ACTUAL Stripe cleared cash,
// so the proposals list shows the right "$ paid" (e.g. Cheeky $1,200, not $0). Idempotent. DB only.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL_UNPOOLED);
const $ = (n) => "$" + Number(n || 0).toLocaleString();

const props = await sql`SELECT id, contact_name, total_amount FROM proposals WHERE is_legacy_manual = true ORDER BY contact_name`;
for (const p of props) {
  const inst = await sql`SELECT id, instalment_number, amount, status FROM proposal_instalments WHERE proposal_id = ${p.id} ORDER BY instalment_number`;
  if (!inst.length) { console.log(`${p.contact_name}: no instalments, skipped`); continue; }
  const cust = await sql`SELECT ltv_net, last_paid_at FROM customers WHERE name ILIKE ${"%" + p.contact_name + "%"} ORDER BY ltv_net DESC NULLS LAST LIMIT 1`;
  const ltv = cust[0] ? Number(cust[0].ltv_net) / 100 : 0;
  const paidAt = cust[0]?.last_paid_at ? new Date(cust[0].last_paid_at) : new Date();
  const monthly = Number(inst[0].amount) || 0;
  const paidMonths = monthly > 0 ? Math.min(inst.length, Math.max(0, Math.round(ltv / monthly))) : 0;
  // Mark the first `paidMonths` instalments paid, the rest pending — matching real cleared cash.
  for (let idx = 0; idx < inst.length; idx++) {
    const shouldBePaid = idx < paidMonths;
    const row = inst[idx];
    const want = shouldBePaid ? "paid" : "pending";
    if (row.status !== want) {
      await sql`UPDATE proposal_instalments SET status = ${want}, paid_at = ${shouldBePaid ? paidAt.toISOString() : null} WHERE id = ${row.id}`;
    } else if (shouldBePaid && row.status === "paid") {
      await sql`UPDATE proposal_instalments SET paid_at = COALESCE(paid_at, ${paidAt.toISOString()}) WHERE id = ${row.id}`;
    }
  }
  console.log(`${p.contact_name.padEnd(22)} cleared ${$(ltv)} / monthly ${$(monthly)} → ${paidMonths} of ${inst.length} instalment(s) paid = ${$(paidMonths * monthly)} shown`);
}
console.log("\nDONE (DB only, no Stripe).\n");
