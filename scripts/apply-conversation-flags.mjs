// Migration — conversation_flags: per-conversation user intent (starred / read-state / soft-delete)
// for the inbox, kept SEPARATE from local_conversations so the GHL mirror sync can never clobber it.
// Additive + idempotent: creates the table if absent, then backfills any existing starred=true rows
// from local_conversations (those were being reset by sync anyway, so this preserves what it can).
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.verify", "utf8");
const url = env.split("\n").find((l) => l.startsWith("DATABASE_URL_UNPOOLED="))
  ?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL_UNPOOLED not found in .env.verify");
const sql = neon(url);

await sql.query(`
  CREATE TABLE IF NOT EXISTS conversation_flags (
    conversation_id text PRIMARY KEY,
    starred boolean NOT NULL DEFAULT false,
    read_state text,
    deleted_at timestamp,
    updated_at timestamp NOT NULL DEFAULT now(),
    updated_by text
  )
`);

// Backfill existing stars (best-effort; local_conversations.starred is unreliable due to sync clobber).
const backfill = await sql.query(`
  INSERT INTO conversation_flags (conversation_id, starred, updated_at)
  SELECT id, true, now() FROM local_conversations WHERE starred = true
  ON CONFLICT (conversation_id) DO UPDATE SET starred = true, updated_at = now()
`);

const [{ count }] = await sql.query(`SELECT count(*)::int AS count FROM conversation_flags`);
console.log(`✅ conversation_flags ready. Backfilled stars; total rows: ${count}`);
