// Migration — quick_messages: team-shared canned replies for the inbox composer.
// Additive + idempotent: creates the table if absent. Safe to re-run.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.verify", "utf8");
const url = env.split("\n").find((l) => l.startsWith("DATABASE_URL_UNPOOLED="))
  ?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL_UNPOOLED not found in .env.verify");
const sql = neon(url);

await sql.query(`
  CREATE TABLE IF NOT EXISTS quick_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text,
    body text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_by text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
`);

const [{ count }] = await sql.query(`SELECT count(*)::int AS count FROM quick_messages`);
console.log(`✅ quick_messages ready. Existing rows: ${count}`);
