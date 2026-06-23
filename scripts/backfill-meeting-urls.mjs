import { neon } from "@neondatabase/serverless";

const TOKEN = process.env.GHL_PRIVATE_TOKEN;
const LOC = process.env.GHL_LOCATION_ID;
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
const BASE = "https://services.leadconnectorhq.com";
const H = { Authorization: `Bearer ${TOKEN}`, Version: "2021-07-28", "Content-Type": "application/json" };

async function ghl(path) {
  const r = await fetch(`${BASE}${path}`, { headers: H });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

// 1. Ensure the column exists
await sql`ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "meeting_url" text`;
await sql`CREATE INDEX IF NOT EXISTS "calls_meeting_url_idx" ON "calls" ("meeting_url")`;

// 2. Map ghlappt_<id> → address (Meet link) from calendar events
const now = Date.now();
const startMs = now - 180 * 24 * 60 * 60 * 1000;
const endMs = now + 30 * 24 * 60 * 60 * 1000;
const { calendars = [] } = await ghl(`/calendars/?locationId=${LOC}`);
const urlByAppt = new Map();
for (const cal of calendars) {
  if (!cal.id) continue;
  try {
    const { events = [] } = await ghl(`/calendars/events?locationId=${LOC}&calendarId=${cal.id}&startTime=${startMs}&endTime=${endMs}`);
    for (const ev of events) {
      if (ev.id && ev.address) urlByAppt.set(`ghlappt_${ev.id}`, ev.address);
    }
  } catch (e) { console.error("cal fail", cal.id, e.message); }
}
console.log(`Collected ${urlByAppt.size} Meet links from GHL.`);

// 3. Update calls
const targets = await sql`select meet_conference_id from calls where call_type='meet' and meeting_url is null and meet_conference_id like 'ghlappt_%'`;
let updated = 0;
for (const row of targets) {
  const url = urlByAppt.get(row.meet_conference_id);
  if (!url) continue;
  await sql`update calls set meeting_url = ${url} where meet_conference_id = ${row.meet_conference_id}`;
  updated++;
}
const after = await sql`select count(*)::int total, count(meeting_url)::int with_url from calls where call_type='meet'`;
console.log(`Updated ${updated} calls with Meet links. Coverage:`, JSON.stringify(after[0]));
