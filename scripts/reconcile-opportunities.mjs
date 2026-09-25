#!/usr/bin/env node
/**
 * Make `local_opportunities` SET-EQUAL to GoHighLevel.
 *
 * WHY THIS EXISTS
 * The nightly sync is upsert-only: it inserts and updates, but nothing ever removes. Proven
 * 2026-08-13 — six opportunities sitting in "Invalid or missing URL" on the board all returned
 * 404 from GHL. They had been deleted there weeks earlier and the mirror kept them forever.
 * Meanwhile five opportunities that GHL had in "Demo In Progress" were absent from the mirror
 * entirely. So the board over-counts in some stages and under-counts in others at the same time,
 * and no display filter can fix either.
 *
 * WHAT IT DOES
 * Fetches EVERY opportunity for the location from GHL (all statuses, all pipelines) and makes the
 * mirror match exactly:
 *   - in GHL, missing from mirror        -> INSERT
 *   - in both, fields differ             -> UPDATE
 *   - in mirror, absent from GHL         -> mark deleted_in_ghl_at  (the missing behaviour)
 *   - previously flagged, back in GHL    -> un-delete (GHL restores do happen)
 *
 * Location-wide on purpose. Reconciling one stage at a time would mark an opportunity "deleted"
 * simply because it MOVED to another stage or pipeline. Only the full set can tell deletion apart
 * from movement.
 *
 * It also backfills pipeline_name / stage_name, which the sync leaves NULL on every row, so the
 * mirror can be audited against GHL without a join.
 *
 * READ-ONLY against GHL. Writes only to our own database. Sends nothing.
 *
 * Usage:
 *   node scripts/reconcile-opportunities.mjs            # dry run, prints the plan
 *   node scripts/reconcile-opportunities.mjs --commit   # applies it
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const COMMIT = process.argv.includes("--commit");
const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));
const TOKEN = env("GHL_PRIVATE_TOKEN");
const LOC = env("GHL_LOCATION_ID");
const H = { Authorization: `Bearer ${TOKEN}`, Version: "2021-07-28", Accept: "application/json" };

const j = async (url) => {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: H });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 90)}`);
    return res.json();
  }
  throw new Error(`rate limited after retries: ${url.slice(0, 90)}`);
};

// ── 1. Pipeline/stage names, so the mirror becomes auditable ────────────────────────────────
const pipelines = (await j(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${LOC}`)).pipelines ?? [];
const pipeName = {}, stageName = {};
for (const p of pipelines) {
  pipeName[p.id] = p.name;
  for (const s of p.stages ?? []) stageName[s.id] = s.name;
}
console.log(`pipelines: ${pipelines.length}`);

// ── 2. The authoritative set: every opportunity GHL has for this location ───────────────────
const ghl = new Map();
let url = `https://services.leadconnectorhq.com/opportunities/search?location_id=${LOC}&limit=100`;
let pages = 0;
while (url) {
  const page = await j(url);
  for (const o of page.opportunities ?? []) ghl.set(o.id, o);
  pages++;
  url = page?.meta?.nextPageUrl ?? null;
}
console.log(`GHL opportunities: ${ghl.size} (in ${pages} pages)`);

// ── 3. The mirror ───────────────────────────────────────────────────────────────────────────
const mirrorRows = await sql`SELECT id, pipeline_id, pipeline_stage_id, status, deleted_in_ghl_at FROM local_opportunities`;
const mirror = new Map(mirrorRows.map((r) => [r.id, r]));
console.log(`mirror rows: ${mirror.size}\n`);

// ── 4. Diff ─────────────────────────────────────────────────────────────────────────────────
const toInsert = [], toUpdate = [], toDelete = [], toRestore = [];
for (const [id, o] of ghl) {
  const m = mirror.get(id);
  if (!m) { toInsert.push(o); continue; }
  if (m.deleted_in_ghl_at) { toRestore.push(o); continue; }
  const stage = o.pipelineStageId ?? null;
  const pid = o.pipeline?.id ?? o.pipelineId ?? null;
  if (m.pipeline_stage_id !== stage || m.status !== (o.status ?? null) || m.pipeline_id !== pid) toUpdate.push(o);
}
for (const [id, m] of mirror) {
  if (!ghl.has(id) && !m.deleted_in_ghl_at) toDelete.push(id);
}

console.log(`${COMMIT ? "COMMIT" : "DRY RUN"}`);
console.log(`  insert (in GHL, absent from mirror) : ${toInsert.length}`);
console.log(`  update (stage/status/pipeline drift): ${toUpdate.length}`);
console.log(`  mark deleted (gone from GHL)        : ${toDelete.length}`);
console.log(`  restore (flagged, but back in GHL)  : ${toRestore.length}`);

const row = (o) => ({
  id: o.id,
  contactId: o.contact?.id ?? null,
  pipelineId: o.pipeline?.id ?? o.pipelineId ?? null,
  pipelineStageId: o.pipelineStageId ?? null,
  pipelineName: pipeName[o.pipeline?.id ?? o.pipelineId] ?? null,
  stageName: stageName[o.pipelineStageId] ?? null,
  name: o.name ?? null,
  status: o.status ?? null,
  monetaryValue: o.monetaryValue ?? null,
  assignedTo: o.assignedTo ?? null,
  source: o.source ?? null,
  contactName: o.contact?.name ?? null,
  contactEmail: o.contact?.email ?? null,
  contactPhone: o.contact?.phone ?? null,
  contactCompanyName: o.contact?.companyName ?? null,
  lastStageChangeAt: o.lastStageChangeAt ? new Date(o.lastStageChangeAt) : null,
  createdAtGhl: o.dateAdded ? new Date(o.dateAdded) : o.createdAt ? new Date(o.createdAt) : null,
  updatedAtGhl: o.dateUpdated ? new Date(o.dateUpdated) : o.updatedAt ? new Date(o.updatedAt) : null,
});

if (!COMMIT) {
  if (toDelete.length) {
    const sample = await sql`SELECT id, contact_name, pipeline_stage_id FROM local_opportunities WHERE id = ANY(${toDelete.slice(0, 10)})`;
    console.log(`\n  would mark deleted (first ${sample.length}):`);
    for (const s of sample) console.log(`    ${String(s.contact_name ?? "-").slice(0, 30).padEnd(30)} ${stageName[s.pipeline_stage_id] ?? s.pipeline_stage_id}`);
  }
  console.log("\nRe-run with --commit to apply.");
  process.exit(0);
}

// ── 5. Apply ────────────────────────────────────────────────────────────────────────────────
for (const o of [...toInsert, ...toUpdate, ...toRestore]) {
  const r = row(o);
  await sql`
    INSERT INTO local_opportunities (
      id, contact_id, pipeline_id, pipeline_stage_id, pipeline_name, stage_name, name, status,
      monetary_value, assigned_to, source, contact_name, contact_email, contact_phone,
      contact_company_name, last_stage_change_at, created_at_ghl, updated_at_ghl,
      raw_data, synced_at, deleted_in_ghl_at
    ) VALUES (
      ${r.id}, ${r.contactId}, ${r.pipelineId}, ${r.pipelineStageId}, ${r.pipelineName},
      ${r.stageName}, ${r.name}, ${r.status}, ${r.monetaryValue}, ${r.assignedTo}, ${r.source},
      ${r.contactName}, ${r.contactEmail}, ${r.contactPhone}, ${r.contactCompanyName},
      ${r.lastStageChangeAt}, ${r.createdAtGhl}, ${r.updatedAtGhl},
      ${JSON.stringify(o)}::jsonb, now(), NULL
    )
    ON CONFLICT (id) DO UPDATE SET
      contact_id = EXCLUDED.contact_id, pipeline_id = EXCLUDED.pipeline_id,
      pipeline_stage_id = EXCLUDED.pipeline_stage_id, pipeline_name = EXCLUDED.pipeline_name,
      stage_name = EXCLUDED.stage_name, name = EXCLUDED.name, status = EXCLUDED.status,
      monetary_value = EXCLUDED.monetary_value, assigned_to = EXCLUDED.assigned_to,
      source = EXCLUDED.source, contact_name = EXCLUDED.contact_name,
      contact_email = EXCLUDED.contact_email, contact_phone = EXCLUDED.contact_phone,
      contact_company_name = EXCLUDED.contact_company_name,
      last_stage_change_at = EXCLUDED.last_stage_change_at,
      created_at_ghl = EXCLUDED.created_at_ghl, updated_at_ghl = EXCLUDED.updated_at_ghl,
      raw_data = EXCLUDED.raw_data, synced_at = now(), deleted_in_ghl_at = NULL`;
}
// Soft delete, never a hard DELETE: history, KPIs and audits still reference these rows.
for (let i = 0; i < toDelete.length; i += 200) {
  await sql`UPDATE local_opportunities SET deleted_in_ghl_at = now(), synced_at = now()
            WHERE id = ANY(${toDelete.slice(i, i + 200)})`;
}
console.log(`\n✔ applied. mirror is now set-equal to GHL.`);
