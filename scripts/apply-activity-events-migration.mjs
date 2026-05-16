import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

// Load .env.local manually (no dotenv dependency needed)
try {
  const env = readFileSync(".env.local", "utf8");
  for (const line of env.split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
} catch { /* file may not exist in CI */ }

const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_name TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
  )
`;

await sql`CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_events(entity_type, entity_id, created_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_events(user_id, created_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_events(action, created_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at DESC)`;

console.log("✓ activity_events table and indexes created");
