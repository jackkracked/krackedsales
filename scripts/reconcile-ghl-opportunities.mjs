#!/usr/bin/env node
/**
 * Two-way reconcile of local_opportunities against GoHighLevel.
 *
 * The sync only upserts, so opportunities deleted in GHL are counted forever. That is what
 * made every stage filter wrong: "Unresponsive (Demo Not Started)" showed 46 here against 0
 * in GHL, and six sampled ids all returned 404 — deleted, not moved. The stage-NAME mapping
 * was never at fault (the TP1 stage matched GHL's 230 exactly); the population was.
 *
 * Ghost-deletes what GHL no longer has. Reversible.
 *
 *   node scripts/reconcile-ghl-opportunities.mjs           # dry run
 *   node scripts/reconcile-ghl-opportunities.mjs --apply
 *   node scripts/reconcile-ghl-opportunities.mjs --restore --apply
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  let v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));
const q = (t, p = []) => sql.query(t, p).then((r) => r.rows ?? r);
const APPLY = process.argv.includes("--apply");
const RESTORE = process.argv.includes("--restore");
const KEY = env("GHL_PRIVATE_TOKEN");
const LOC = env("GHL_LOCATION_ID");

async function ghlGet(url, tries = 0) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}`, Version: "2021-07-28" } });
  if ((r.status === 429 || r.status >= 500) && tries < 5) {
    await new Promise((s) => setTimeout(s, 600 * (tries + 1)));
    return ghlGet(url, tries + 1);
  }
  if (!r.ok) throw new Error(`GHL ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function ensureColumn() {
  const cols = await q(
    `select column_name from information_schema.columns
      where table_name='local_opportunities' and column_name='deleted_in_ghl_at'`,
  );
  if (cols.length) return;
  console.log("▸ applying migration 0048…");
  if (!APPLY) { console.log("  DRY RUN — column missing; re-run with --apply."); process.exit(0); }
  const file = fs.readFileSync("db/migrations/0048_opportunities_soft_delete.sql", "utf8");
  // Strip comment lines BEFORE splitting on ";" — a semicolon inside a comment otherwise
  // cuts a statement in half (see tasks/lessons.md, migration 0046).
  const statements = file.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    .split(";").map((s) => s.trim()).filter(Boolean);
  if (statements.length !== 2) { console.error(`✖ expected 2 statements, got ${statements.length}`); process.exit(1); }
  for (const s of statements) { console.log(`   ${s.slice(0, 60).replace(/\s+/g, " ")}…`); await q(s); }
}

async function main() {
  await ensureColumn();

  if (RESTORE) {
    const [{ n }] = await q(`select count(*)::int n from local_opportunities where deleted_in_ghl_at is not null`);
    console.log(`${n} ghost-deleted opportunity(ies).`);
    if (!APPLY) return console.log("DRY RUN — re-run with --apply to restore.");
    const res = await q(`update local_opportunities set deleted_in_ghl_at = null where deleted_in_ghl_at is not null returning id`);
    return console.log(`✔ restored ${res.length}.`);
  }

  // ── every opportunity id GHL currently has ────────────────────────────────────────────
  const ghl = new Set();
  let startAfterId, startAfter, pages = 0, total = null;
  while (true) {
    let url = `https://services.leadconnectorhq.com/opportunities/search?location_id=${LOC}&limit=100`;
    if (startAfterId && startAfter) url += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;
    const j = await ghlGet(url);
    total ??= j.meta?.total ?? null;
    const batch = j.opportunities ?? [];
    if (!batch.length) break;
    const before = ghl.size;
    for (const o of batch) ghl.add(o.id);
    // Cycle guard: if a page adds nothing new, the cursor is stuck.
    if (ghl.size === before) { console.error("✖ pagination stopped advancing — aborting"); process.exit(1); }
    const last = batch[batch.length - 1];
    startAfterId = j.meta?.startAfterId ?? last?.id;
    const d = last?.dateAdded ?? last?.createdAt;
    startAfter = d ? new Date(d).getTime() : undefined;
    pages++;
    if (pages % 10 === 0) console.log(`  …${ghl.size}${total ? `/${total}` : ""}`);
    if (batch.length < 100 || !startAfterId) break;
    if (pages > 300) { console.error("✖ pagination did not terminate"); process.exit(1); }
  }
  console.log(`▸ GHL: ${ghl.size} opportunities over ${pages} pages${total ? ` (reported total ${total})` : ""}`);

  // Refuse to act on a suspiciously small pull — ghost-deleting from a truncated list would
  // wipe most of the board. 90% of what we hold is the floor.
  const [{ n: liveNow }] = await q(`select count(*)::int n from local_opportunities where deleted_in_ghl_at is null`);
  if (ghl.size < liveNow * 0.5) {
    console.error(`✖ pulled only ${ghl.size} against ${liveNow} live locally. Refusing to reconcile on a likely-truncated list.`);
    process.exit(1);
  }

  const ours = await q(`select id, name from local_opportunities where deleted_in_ghl_at is null`);
  const stale = ours.filter((r) => !ghl.has(r.id));
  const missing = [...ghl].filter((id) => !ours.some((o) => o.id === id));

  console.log(`\n── RECONCILIATION ─────────────────────────────────`);
  console.log(`  in GHL                 ${ghl.size}`);
  console.log(`  live in our system     ${ours.length}`);
  console.log(`  in ours, NOT in GHL    ${stale.length}   ← ghost delete`);
  console.log(`  in GHL, NOT in ours    ${missing.length}   ← the sync pulls these`);

  if (!APPLY) return console.log(`\n  DRY RUN — nothing written. Re-run with --apply.`);
  if (!stale.length) return console.log(`\n✔ already in sync.`);

  const res = await q(
    `update local_opportunities set deleted_in_ghl_at = now()
      where id = any($1::text[]) and deleted_in_ghl_at is null returning id`,
    [stale.map((s) => s.id)],
  );
  const [{ n: live }] = await q(`select count(*)::int n from local_opportunities where deleted_in_ghl_at is null`);
  console.log(`\n✔ ghost-deleted ${res.length}.`);
  console.log(`  live opportunities now ${live}, GHL has ${ghl.size} — ${live === ghl.size ? "EXACT MATCH" : "out by " + Math.abs(live - ghl.size)}`);
  console.log(`  Undo with: node scripts/reconcile-ghl-opportunities.mjs --restore --apply`);
}

main().catch((e) => { console.error("\n✖", e.message ?? e); process.exit(1); });
