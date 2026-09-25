// READ-ONLY: cross-reference the 13 candidate deals against the Stripe-derived customers table,
// which is the source of truth for who is actually paying. Writes NOTHING.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL_UNPOOLED);
const money = (c) => "$" + Number(c || 0).toLocaleString("en-US");

const names = [
  "Rossi Mckee", "Brittany Reid", "NO CAP SODA", "Tofu Go Snacks", "Buck Wild Branding",
  "Hope Roza", "Greenhouse Girls THC", "Roots Apothecary", "Three Spoiled Dogs", "Cheeky",
  "Eat Meat Media",
];
console.log("\n=== 13 candidates vs Stripe customers (source of truth for 'actually paying') ===");
for (const n of names) {
  const rows = await sql`
    SELECT name, email, status, subscription_status, type, is_test, current_mrr, ltv_net, payments_count, last_paid_at
    FROM customers WHERE name ILIKE ${"%" + n + "%"}
    ORDER BY ltv_net DESC NULLS LAST LIMIT 3`;
  if (!rows.length) { console.log(`  ✗ ${n.padEnd(22)} — NO Stripe customer match`); continue; }
  for (const r of rows) {
    console.log(`  ${r.status === "active" ? "🟢" : "⚪"} ${n.padEnd(22)} → ${(r.name || r.email || "?").slice(0, 22).padEnd(22)} | ${String(r.status).padEnd(8)} | sub ${String(r.subscription_status || "—").padEnd(9)} | MRR ${money(r.current_mrr).padStart(7)} | LTV ${money(r.ltv_net).padStart(9)} | ${r.payments_count || 0} pmts | last ${r.last_paid_at ? new Date(r.last_paid_at).toISOString().slice(0, 10) : "—"}${r.is_test ? " [TEST]" : ""}`);
  }
}
console.log("\n(READ-ONLY — nothing changed.)\n");
