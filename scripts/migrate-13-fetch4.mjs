import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL_UNPOOLED);
const prefixes = ["99ff4b11", "f9ca98e6", "ca9448f8", "9c1d5f9a"];
for (const p of prefixes) {
  const rows = await sql`
    SELECT p.id, p.contact_name, p.ghl_contact_id, p.type, p.status,
      (SELECT COALESCE(SUM(amount),0)/3 FROM proposal_instalments WHERE proposal_id = p.id) AS monthly
    FROM proposals p WHERE p.id::text LIKE ${p + "%"} LIMIT 1`;
  const r = rows[0];
  const cust = await sql`SELECT MIN(last_paid_at) AS pay FROM customers WHERE name ILIKE ${"%" + r.contact_name + "%"}`;
  console.log(`${r.id} | ${r.contact_name} | ghl=${r.ghl_contact_id || "—"} | ${r.type}/${r.status} | $${r.monthly}/mo | paid ${cust[0].pay ? new Date(cust[0].pay).toISOString().slice(0, 10) : "—"}`);
}
