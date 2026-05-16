import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

try {
  const env = readFileSync(".env.local", "utf8");
  for (const line of env.split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
} catch { /* no .env.local in CI */ }

const sql = neon(process.env.DATABASE_URL);

await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS opportunity_name TEXT`;
await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)`;
await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_name TEXT`;
await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium'`;

await sql`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, completed, due_date)`;

console.log("✓ tasks table updated: opportunity_name, user_id, user_name, priority columns added");
