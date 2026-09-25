// READ-ONLY: inspect the legacy 90-day deals' instalment paid-state vs actual Stripe cleared cash.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL_UNPOOLED);
const $ = (n) => "$" + Number(n || 0).toLocaleString();

const props = await sql`SELECT id, contact_name, total_amount, payment_structure FROM proposals WHERE is_legacy_manual = true ORDER BY contact_name`;
for (const p of props) {
  const inst = await sql`SELECT instalment_number, amount, status, paid_at FROM proposal_instalments WHERE proposal_id = ${p.id} ORDER BY instalment_number`;
  const cust = await sql`SELECT ltv_net, last_paid_at, payments_count FROM customers WHERE name ILIKE ${"%" + p.contact_name + "%"} ORDER BY ltv_net DESC NULLS LAST LIMIT 1`;
  const ltv = cust[0] ? Number(cust[0].ltv_net) / 100 : 0;
  const paidInst = inst.filter((i) => i.status === "paid").reduce((a, i) => a + Number(i.amount), 0);
  const monthly = inst[0] ? Number(inst[0].amount) : 0;
  console.log(`\n${p.contact_name} (${p.payment_structure}) total ${$(p.total_amount)}`);
  console.log(`  instalments: ${inst.map((i) => `#${i.instalment_number} ${$(i.amount)} [${i.status}]`).join(", ") || "none"}`);
  console.log(`  paidSoFar(now)=${$(paidInst)}  |  Stripe cleared=${$(ltv)} (${cust[0]?.payments_count || 0} pmts)  |  monthly=${$(monthly)}  → should mark ${monthly ? Math.round(ltv / monthly) : 0} instalment(s) paid`);
}
console.log("\n(READ-ONLY)\n");
