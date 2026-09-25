#!/usr/bin/env node
/**
 * Import a Meta Leads Centre CSV export into `meta_leads` — the mirror that makes the app's
 * numbers EXACTLY Meta's.
 *
 * Supersedes scripts/import-meta-stages.mjs, which could only ever stage leads that already
 * existed as GHL contacts. That capped Intake at 9 against Meta's 16, because the other 7
 * (4 organic Messenger leads with no email or phone, Meta's own test@meta.com dummy, and 2
 * leads that had not yet reached GHL) are not GHL contacts and never will be. This writes
 * Meta's rows as Meta has them, and LINKS to a contact where one exists.
 *
 * Still true, and still the thing that must not go wrong: this sends NO Conversions API
 * events. Meta is the source of these stages. Pushing 465 not_qualified rows through
 * PATCH /api/leads/[id]/stage would fire 465 duplicate BAD events on traffic costing
 * $117-$337 per qualified lead.
 *
 * USAGE
 *   node scripts/import-meta-leads.mjs <export.csv> [...]              # dry run
 *   node scripts/import-meta-leads.mjs <export.csv> [...] --apply
 *   node scripts/import-meta-leads.mjs <export.csv> --stage=not_qualified --apply
 *   node scripts/import-meta-leads.mjs --wipe --apply                  # empty the mirror
 *
 * Re-running the SAME export is safe: row ids are a deterministic hash of the export's own
 * fields, so a re-import updates in place. Jack will re-export, so idempotency is the point.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

const ENV_FILE = ".env.production.vercel";
function env(key) {
  const raw = fs.readFileSync(ENV_FILE, "utf8");
  const m = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) throw new Error(`${key} missing from ${ENV_FILE}`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
}

const STAGES = ["intake", "need_more_info", "qualified", "disqualified", "converted", "lost", "not_qualified"];

function normaliseStage(value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return null;
  const alias = {
    intake: "intake", new: "intake",
    need_more_info: "need_more_info", needs_more_info: "need_more_info", more_info_needed: "need_more_info",
    qualified: "qualified", disqualified: "disqualified",
    converted: "converted", won: "converted", lost: "lost",
    not_qualified: "not_qualified", unqualified: "not_qualified",
  };
  return alias[key] ?? (STAGES.includes(key) ? key : undefined);
}

/** RFC4180. Handles BOM, CRLF, quoted fields with embedded delimiters/newlines, "" escapes. */
function parseCsv(text) {
  const s = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((v) => v !== "")) rows.push(row);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, records };
}

/** Meta's export carries BOTH `Stage` and `Status`; `Status` means "Complete form". */
const findStageCol = (h) =>
  h.find((x) => /^(lead[\s_-]*)?stage$/i.test(x.trim())) ??
  h.find((x) => /stage/i.test(x) && !/status/i.test(x)) ?? null;
const findCol = (h, re) => h.find((x) => re.test(x)) ?? null;

/** Rejects degenerate numbers — a live contact's phone ends in nine zeros. */
const phoneKey = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const k = d.slice(-9);
  return new Set(k).size >= 4 ? k : null;
};

/** Meta writes "08/07/2026 12:42am" (MM/DD/YYYY). Returns an ISO string or null. */
function parseCreated(v) {
  const m = String(v ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([ap]m))?/i);
  if (!m) return null;
  const [, mm, dd, yyyy, hh, mi, ap] = m;
  let hour = hh ? Number(hh) % 12 : 0;
  if (ap && /pm/i.test(ap)) hour += 12;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, hour, mi ? +mi : 0));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const WIPE = argv.includes("--wipe");
/** Never overwrite a stage already set: someone in two exports under two stages keeps the first. */
const ONLY_UNTRIAGED = argv.includes("--only-untriaged");

const files = [];
let pinned = null;
for (const a of argv) {
  if (["--apply", "--wipe", "--only-untriaged"].includes(a)) continue;
  const m = a.match(/^--stage=(.+)$/);
  if (m) {
    pinned = normaliseStage(m[1]);
    if (!pinned) { console.error(`✖ --stage=${m[1]} unknown. One of: ${STAGES.join(", ")}`); process.exit(1); }
    continue;
  }
  if (a.startsWith("--")) { console.error(`✖ unknown flag ${a}`); process.exit(1); }
  files.push({ file: a, pinned });
}

const sql = neon(env("DATABASE_URL"));
const q = (t, p = []) => sql.query(t, p).then((r) => r.rows ?? r);
const META_FILTER = `raw_data::text ILIKE '%"utmAdId"%'`;

async function main() {
  if (WIPE) {
    const [{ n }] = await q(`select count(*)::int n from meta_leads`);
    console.log(`meta_leads holds ${n} rows.`);
    if (!APPLY) return console.log("DRY RUN — re-run with --apply to empty it.");
    await q(`delete from meta_leads`);
    return console.log("✔ emptied.");
  }
  if (!files.length) {
    console.error("Usage: node scripts/import-meta-leads.mjs <export.csv> [...] [--stage=X] [--only-untriaged] [--apply]");
    process.exit(1);
  }

  /** id -> row, so the same person from the same export collapses to one row. */
  const rows = new Map();

  for (const { file, pinned: pin } of files) {
    if (!fs.existsSync(file)) { console.error(`✖ no such file: ${file}`); process.exit(1); }
    const { headers, records } = parseCsv(fs.readFileSync(file, "utf8"));
    const stageCol = findStageCol(headers);
    const emailCol = findCol(headers, /e-?mail/i);
    const phoneCol = headers.find((h) => /phone|mobile|tel/i.test(h) && !/secondary|whatsapp/i.test(h)) ?? null;
    const nameCol  = findCol(headers, /^(full[\s_-]*name|name)$/i) ?? findCol(headers, /name/i);
    const createdCol = findCol(headers, /created|date/i);
    const sourceCol = findCol(headers, /^source$/i);
    const formCol = findCol(headers, /^form$/i);
    const chanCol = findCol(headers, /^channel$/i);
    const ownerCol = findCol(headers, /^owner$|assigned/i);
    const labelCol = findCol(headers, /^labels?$/i);

    const base = path.basename(file);
    const fromName = normaliseStage(base.replace(/\.csv$/i, "").replace(/[^a-z_-]/gi, ""));
    const fileStage = pin ?? (stageCol ? null : fromName);
    if (!stageCol && !fileStage) {
      console.error(`✖ ${base}: no Stage column and no stage given.\n   Columns: ${headers.join(" | ")}`);
      process.exit(1);
    }

    console.log(`\n▸ ${base} (${records.length} rows)`);
    console.log(`  stage from : ${stageCol ? `column "${stageCol}"` : `${pin ? "--stage" : "filename"} → ${fileStage}`}`);

    const unknown = new Map();
    for (const rec of records) {
      const rawStage = stageCol ? rec[stageCol] : fileStage;
      const stage = stageCol ? normaliseStage(rawStage) : fileStage;
      if (stage === undefined) { unknown.set(rawStage, (unknown.get(rawStage) ?? 0) + 1); continue; }
      if (!stage) continue;

      const email = emailCol && rec[emailCol] ? rec[emailCol].trim() : null;
      const name = nameCol ? rec[nameCol]?.trim() ?? null : null;
      const created = createdCol ? parseCreated(rec[createdCol]) : null;
      const form = formCol ? rec[formCol]?.trim() ?? null : null;

      // Deterministic id. Includes `created` and `form` so a person who submitted the SAME
      // form twice at different times stays two rows — Meta counts them twice, and the whole
      // point of this table is to agree with Meta.
      const id = crypto.createHash("sha1")
        .update([(email ?? "").toLowerCase(), (name ?? "").toLowerCase(), created ?? "", form ?? ""].join("|"))
        .digest("hex").slice(0, 32);

      rows.set(id, {
        id, created, name, email,
        phone: phoneCol ? rec[phoneCol]?.trim() ?? null : null,
        source: sourceCol ? rec[sourceCol]?.trim() ?? null : null,
        form, channel: chanCol ? rec[chanCol]?.trim() ?? null : null,
        stage,
        owner: ownerCol ? rec[ownerCol]?.trim() ?? null : null,
        labels: labelCol ? rec[labelCol]?.trim() ?? null : null,
        file: base,
      });
    }
    if (unknown.size) {
      console.error(`\n✖ ${base}: unrecognised stage values:`);
      for (const [v, n] of unknown) console.error(`     "${v}" × ${n}`);
      console.error(`   Known: ${STAGES.join(", ")}. Add an alias rather than guessing.`);
      process.exit(1);
    }
  }

  // ── link each Meta row to a CRM contact where we can ────────────────────────────────────
  const contacts = await q(
    `select id, lower(email) email, phone, lower(full_name) name from local_contacts where ${META_FILTER}`,
  );
  const byEmail = new Map(), byPhone = new Map(), nameCount = new Map();
  for (const c of contacts) {
    if (c.email) byEmail.set(c.email, c.id);
    const pk = phoneKey(c.phone);
    if (pk && !byPhone.has(pk)) byPhone.set(pk, c.id);
    if (c.name) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
  }
  const byName = new Map();
  for (const c of contacts) if (c.name && nameCount.get(c.name) === 1) byName.set(c.name, c.id);

  let linked = 0;
  for (const r of rows.values()) {
    const k = r.email?.toLowerCase();
    r.contact_id =
      (k && byEmail.get(k)) ||
      (phoneKey(r.phone) && byPhone.get(phoneKey(r.phone))) ||
      (r.name && byName.get(r.name.toLowerCase())) ||
      null;
    if (r.contact_id) linked++;
  }

  // ── report ──────────────────────────────────────────────────────────────────────────────
  const dist = {};
  for (const r of rows.values()) dist[r.stage] = (dist[r.stage] ?? 0) + 1;
  console.log(`\n── META LEADS MIRROR ────────────────────────────────────────`);
  console.log(`  rows to write           ${rows.size}`);
  console.log(`  linked to a CRM contact ${linked}`);
  console.log(`  Meta-only (no contact)  ${rows.size - linked}`);
  console.log(`\n  stage distribution — compare to Meta's rail:`);
  for (const s of STAGES) if (dist[s]) console.log(`     ${s.padEnd(16)} ${String(dist[s]).padStart(5)}`);

  if (!APPLY) return console.log(`\n  DRY RUN — nothing written. Re-run with --apply.`);

  // ── write the mirror ────────────────────────────────────────────────────────────────────
  const list = [...rows.values()];
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < list.length; i += CHUNK) {
    const batch = list.slice(i, i + CHUNK);
    const vals = [], params = [];
    batch.forEach((r, j) => {
      const b = j * 13;
      vals.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13})`);
      params.push(r.id, r.created, r.name, r.email, r.phone, r.source, r.form, r.channel, r.stage, r.owner, r.labels, r.contact_id, r.file);
    });
    const res = await q(
      `insert into meta_leads
         (id, created_meta, full_name, email, phone, source, form_name, channel, stage, owner, labels, contact_id, export_file)
       values ${vals.join(",")}
       on conflict (id) do update set
         stage = excluded.stage, contact_id = excluded.contact_id, owner = excluded.owner,
         labels = excluded.labels, export_file = excluded.export_file, updated_at = now()
       returning id`,
      params,
    );
    written += res.length;
  }
  console.log(`\n✔ ${written} rows in the mirror.`);

  // ── keep local_contacts.meta_lead_stage in step, for the drawer and the stage control ───
  // Same guard as before: never demote a lead that another export already staged higher.
  let staged = 0, protectedCount = 0;
  for (const s of STAGES) {
    const ids = [...new Set(list.filter((r) => r.stage === s && r.contact_id).map((r) => r.contact_id))];
    if (!ids.length) continue;
    const guard = ONLY_UNTRIAGED ? `and (meta_lead_stage is null or meta_lead_stage = $1)` : ``;
    const res = await q(
      `update local_contacts
          set meta_lead_stage = $1, meta_lead_stage_at = now(),
              capi_status = 'imported',
              capi_error = 'Imported from Meta Leads Centre at cutover — Meta already has this signal, so none was sent',
              updated_at = now()
        where id = any($2::text[]) ${guard}
        returning id`,
      [s, ids],
    );
    staged += res.length;
    protectedCount += ids.length - res.length;
  }
  console.log(`✔ ${staged} CRM contacts staged${protectedCount ? `, ${protectedCount} left alone (already staged)` : ""}.`);
  console.log(`  No Conversions API events were sent.`);
}

main().catch((e) => { console.error("\n✖", e.message ?? e); process.exit(1); });
