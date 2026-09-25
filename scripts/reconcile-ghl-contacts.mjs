#!/usr/bin/env node
/**
 * Two-way reconcile of local_contacts against GoHighLevel.
 *
 * Jack's requirement: if GHL has 1,001 contacts, we have 1,001 — not 1,000, not 1,002.
 *
 * Applies migration 0047 if needed, then:
 *   - GHOST-DELETES contacts that no longer exist in GHL (sets deleted_in_ghl_at). Reversible.
 *   - REPORTS contacts in GHL that we are missing. Those are pulled by the normal sync, which
 *     now runs newest-first (see app/api/ghl/sync/route.ts) — this script does not write them,
 *     because upsertContact() is the one place that knows how to shape a contact row.
 *
 * NOT a hard delete: local_opportunities, proposals, tasks, calls and activity all reference
 * contact ids. Deleting the rows would orphan real history for deals that happened.
 *
 *   node scripts/reconcile-ghl-contacts.mjs            # dry run
 *   node scripts/reconcile-ghl-contacts.mjs --apply
 *   node scripts/reconcile-ghl-contacts.mjs --restore --apply   # un-ghost everything
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

async function ghlSearch(body, tries = 0) {
  const r = await fetch("https://services.leadconnectorhq.com/contacts/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, Version: "2021-07-28", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // GHL's gateway 503s intermittently; retry 429 + 5xx with backoff (see tasks/lessons.md).
  if ((r.status === 429 || r.status >= 500) && tries < 5) {
    await new Promise((s) => setTimeout(s, 600 * (tries + 1)));
    return ghlSearch(body, tries + 1);
  }
  if (!r.ok) throw new Error(`GHL ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function ensureColumn() {
  const cols = await q(
    `select column_name from information_schema.columns
      where table_name='local_contacts' and column_name='deleted_in_ghl_at'`,
  );
  if (cols.length) return;
  console.log("▸ applying migration 0047 (deleted_in_ghl_at)…");
  if (!APPLY) { console.log("  DRY RUN — column missing; re-run with --apply."); process.exit(0); }
  const file = fs.readFileSync("db/migrations/0047_contacts_soft_delete.sql", "utf8");
  // Strip comment lines BEFORE splitting: a ";" inside a comment otherwise cuts a statement
  // in half and the tail of the sentence executes as SQL. See tasks/lessons.md, 0046.
  const statements = file.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    .split(";").map((s) => s.trim()).filter(Boolean);
  if (statements.length !== 2) { console.error(`✖ expected 2 statements, got ${statements.length}`); process.exit(1); }
  for (const s of statements) { console.log(`   ${s.slice(0, 60).replace(/\s+/g, " ")}…`); await q(s); }
}

async function main() {
  await ensureColumn();

  if (RESTORE) {
    const [{ n }] = await q(`select count(*)::int n from local_contacts where deleted_in_ghl_at is not null`);
    console.log(`${n} ghost-deleted contact(s).`);
    if (!APPLY) return console.log("DRY RUN — re-run with --apply to restore them.");
    const res = await q(`update local_contacts set deleted_in_ghl_at = null where deleted_in_ghl_at is not null returning id`);
    return console.log(`✔ restored ${res.length}.`);
  }

  // ── pull every GHL contact id, newest first ───────────────────────────────────────────
  const ghl = new Set();
  let after = null, pages = 0, total = null;
  while (true) {
    const body = { locationId: LOC, pageLimit: 100, sort: [{ field: "dateAdded", direction: "desc" }] };
    if (after) body.searchAfter = after;
    const j = await ghlSearch(body);
    total ??= j.total;
    const batch = j.contacts ?? [];
    if (!batch.length) break;
    for (const c of batch) ghl.add(c.id);
    after = batch[batch.length - 1].searchAfter;
    pages++;
    if (pages % 10 === 0) console.log(`  …${ghl.size}/${total}`);
    if (!after || ghl.size >= total) break;
    // A cursor that stops advancing would spin forever; 200 pages is 20,000 contacts.
    if (pages > 200) { console.error("✖ pagination did not terminate — aborting rather than guessing"); process.exit(1); }
  }

  // Refuse to act on a partial pull: ghost-deleting from a truncated list would wipe
  // thousands of live contacts. This is the guard that makes the script safe to re-run.
  if (ghl.size !== total) {
    console.error(`✖ pulled ${ghl.size} of ${total} GHL contacts. Refusing to reconcile on a partial list.`);
    process.exit(1);
  }
  console.log(`▸ GHL: ${ghl.size} contacts over ${pages} pages`);

  const ours = await q(`select id, full_name, email from local_contacts where deleted_in_ghl_at is null`);
  const ourIds = new Set(ours.map((r) => r.id));
  const stale = ours.filter((r) => !ghl.has(r.id));
  const missing = [...ghl].filter((id) => !ourIds.has(id));

  console.log(`\n── RECONCILIATION ─────────────────────────────────`);
  console.log(`  in GHL                 ${ghl.size}`);
  console.log(`  live in our system     ${ours.length}`);
  console.log(`  in ours, NOT in GHL    ${stale.length}   ← ghost delete`);
  console.log(`  in GHL, NOT in ours    ${missing.length}   ← the sync pulls these (newest-first)`);
  if (stale.length) {
    console.log(`\n  sample to ghost-delete:`);
    for (const s of stale.slice(0, 5)) console.log(`     ${s.full_name ?? "(no name)"} <${s.email ?? ""}>`);
  }

  if (!APPLY) return console.log(`\n  DRY RUN — nothing written. Re-run with --apply.`);
  if (!stale.length) return console.log(`\n✔ already in sync.`);

  const res = await q(
    `update local_contacts set deleted_in_ghl_at = now(), updated_at = now()
      where id = any($1::text[]) and deleted_in_ghl_at is null returning id`,
    [stale.map((s) => s.id)],
  );
  const [{ n: live }] = await q(`select count(*)::int n from local_contacts where deleted_in_ghl_at is null`);
  console.log(`\n✔ ghost-deleted ${res.length}.`);
  console.log(`  live contacts now ${live}, GHL has ${ghl.size} — ${live === ghl.size ? "EXACT MATCH" : "STILL OUT BY " + Math.abs(live - ghl.size)}`);
  console.log(`  Undo with: node scripts/reconcile-ghl-contacts.mjs --restore --apply`);
}

main().catch((e) => { console.error("\n✖", e.message ?? e); process.exit(1); });
