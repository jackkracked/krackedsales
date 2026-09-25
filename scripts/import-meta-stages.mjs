#!/usr/bin/env node
/**
 * One-time Meta Leads Centre stage import (the cutover).
 *
 * WHY THIS SCRIPT EXISTS
 * Meta's Graph API cannot READ a lead's Leads Centre stage. Probed exhaustively on 2026-08-07
 * against lead 1558338666033016: 30+ candidate field names (lead_status, crm_status, stage,
 * lead_stage, qualification_status, leads_center_status, ...) all return "(#100) nonexisting
 * field"; the /crm, /stages, /leads_center, /crm_leads edges do not exist on the lead, page OR
 * business node; and this holds on v17 through v25. The complete lead node is:
 *   id, created_time, ad_id/name, adset_*, campaign_*, form_id, field_data,
 *   partner_name, is_organic, platform, post, retailer_item_id, vehicle,
 *   custom_disclaimer_responses
 * The WRITE direction was already known closed (see app/api/leads/[id]/stage/route.ts).
 * So the ONLY path to stage parity is a CSV export from the Leads Centre UI. This imports it.
 *
 * ── THE THING THAT MUST NOT GO WRONG ──────────────────────────────────────────────────────
 * This writes meta_lead_stage DIRECTLY, deliberately bypassing PATCH /api/leads/[id]/stage.
 * That route fires a Conversions API event on qualified / converted / not_qualified. Meta
 * ALREADY has these qualifications — they are what Gage set in Leads Centre in the first
 * place. Pushing ~143 not_qualified rows through the route would send Facebook 143 duplicate
 * BAD events and teach the optimiser that good leads are bad, on traffic costing $117-$337
 * per qualified lead. So: no route, no CAPI, no GHL write-back. Silent by design, and the
 * silence is RECORDED (capi_status = 'imported') rather than left as an unexplained NULL.
 *
 * USAGE
 *   Dry run (default — writes nothing, prints the full reconciliation):
 *     node scripts/import-meta-stages.mjs ~/Downloads/*.csv
 *
 *   Apply:
 *     node scripts/import-meta-stages.mjs ~/Downloads/*.csv --apply
 *
 *   When the CSV has no Stage column (you filtered Leads Centre to one stage, then exported),
 *   name the stage explicitly. It applies to every file listed after it:
 *     node scripts/import-meta-stages.mjs qualified.csv --stage=qualified --apply
 *   ...or just name the file after the stage — `qualified.csv`, `not-qualified.csv` — and it
 *   is inferred.
 *
 *   Undo the whole import (only ever touches rows this script wrote):
 *     node scripts/import-meta-stages.mjs --revert --apply
 */

import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

// ── env ─────────────────────────────────────────────────────────────────────────────────
// .env.production.vercel, NOT .env.local — the latter only carries VERCEL_OIDC_TOKEN.
// Values are dotenv-quoted with escapes, so JSON.parse them; a quote-strip regex silently
// returns a value that is off by a character (this has cost real time before).
const ENV_FILE = ".env.production.vercel";
function env(key) {
  const raw = fs.readFileSync(ENV_FILE, "utf8");
  const m = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) throw new Error(`${key} missing from ${ENV_FILE}`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
}

// ── stage vocabulary ────────────────────────────────────────────────────────────────────
/** Our enum, in Meta's own funnel order. Must stay in step with META_LEAD_STAGES. */
const STAGES = ["intake", "need_more_info", "qualified", "disqualified", "converted", "lost", "not_qualified"];

/** Meta writes these labels; we store snake_case. Unknown labels are a hard error, never a guess. */
function normaliseStage(value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return null;
  const alias = {
    intake: "intake",
    new: "intake",
    need_more_info: "need_more_info",
    needs_more_info: "need_more_info",
    more_info_needed: "need_more_info",
    qualified: "qualified",
    disqualified: "disqualified",
    converted: "converted",
    won: "converted",
    lost: "lost",
    not_qualified: "not_qualified",
    unqualified: "not_qualified",
  };
  return alias[key] ?? (STAGES.includes(key) ? key : undefined); // undefined = unrecognised
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────
/**
 * RFC4180 parser. Hand-rolled because the project has no CSV dependency and this runs once.
 * Handles BOM, CRLF, quoted fields containing the delimiter or a newline, and "" escapes.
 */
function parseCsv(text) {
  let s = text.replace(/^﻿/, "");
  // Sniff the delimiter on the header line only, ignoring anything inside quotes.
  const headerLine = s.slice(0, s.search(/\r?\n/) === -1 ? s.length : s.search(/\r?\n/));
  const outside = headerLine.replace(/"[^"]*"/g, "");
  const delim = [",", "\t", ";"]
    .map((d) => [d, outside.split(d).length])
    .sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delim) { row.push(field); field = ""; continue; }
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
  const records = rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
  return { headers, records, delim };
}

/**
 * Find the STAGE column.
 *
 * Deliberately excludes anything called "status": Meta's Leads Centre export carries a
 * `Status` column whose values are "Complete form" / "Incomplete", which is the FORM
 * completion state, NOT the pipeline stage. Treating it as the stage would import garbage
 * into every row and look entirely plausible doing it.
 */
function findStageColumn(headers) {
  return headers.find((h) => /^(lead[\s_-]*)?stage$/i.test(h.trim()))
      ?? headers.find((h) => /stage/i.test(h) && !/status/i.test(h))
      ?? null;
}
const findCol = (headers, re) => headers.find((h) => re.test(h)) ?? null;

/**
 * Last 9 digits — tolerates +44 / 0044 / 0-prefix variants between Meta and GHL.
 *
 * Rejects DEGENERATE numbers, which is not paranoia: a live contact in this database
 * (parreech1969@gmail.com) has a phone whose last nine digits are 000000000. Matching on that
 * filed a completely unrelated lead under the wrong stage in testing, silently and plausibly.
 * Placeholder numbers are common in form data, so a key needs real entropy to be trusted.
 */
const phoneKey = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const k = d.slice(-9);
  return new Set(k).size >= 4 ? k : null;
};

// ── args ────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const REVERT = argv.includes("--revert");
/**
 * --only-untriaged: never overwrite a stage that is already set.
 *
 * Needed because Meta's Leads Centre holds one row per SUBMISSION while we hold one row per
 * PERSON, so someone who filled the form twice can sit in two different stages at once. Three
 * people are in both the "All" and the "Not qualified" exports — two Converted, one Qualified.
 * Importing the second file without this flag would demote a converted customer to
 * not_qualified, which is the single worst write in the app: it is the row that fires BAD.
 * With the flag, the stage imported first stands and later files only fill blanks.
 */
const ONLY_UNTRIAGED = argv.includes("--only-untriaged");

// --stage=X applies to every file that follows it on the command line.
const files = [];
let pinned = null;
for (const a of argv) {
  if (a === "--apply" || a === "--revert") continue;
  const m = a.match(/^--stage=(.+)$/);
  if (a === "--only-untriaged") continue;
  if (m) {
    pinned = normaliseStage(m[1]);
    if (!pinned) { console.error(`✖ --stage=${m[1]} is not a stage. One of: ${STAGES.join(", ")}`); process.exit(1); }
    continue;
  }
  if (a.startsWith("--")) { console.error(`✖ unknown flag ${a}`); process.exit(1); }
  files.push({ file: a, pinned });
}

const sql = neon(env("DATABASE_URL"));
const q = (text, params = []) => sql.query(text, params).then((r) => r.rows ?? r);

/** The app's own definition of a Meta lead. Kept identical to app/api/leads/route.ts. */
const META_FILTER = `raw_data::text ILIKE '%"utmAdId"%'`;

async function main() {
  if (REVERT) return revert();
  if (!files.length) {
    console.error("Usage: node scripts/import-meta-stages.mjs <export.csv> [...] [--stage=qualified] [--apply]");
    process.exit(1);
  }

  // ── read the exports ──────────────────────────────────────────────────────────────────
  /**
   * identity -> one person from the exports.
   *
   * Keyed by ONE canonical identity (email, else phone, else name) rather than by all three,
   * so a single person is a single record. Indexing by every key produced duplicate records
   * for the same human and made the unmatched count meaningless.
   */
  const people = new Map();
  const conflicts = [];
  let totalRows = 0;

  for (const { file, pinned: pin } of files) {
    if (!fs.existsSync(file)) { console.error(`✖ no such file: ${file}`); process.exit(1); }
    if (/\.xlsx?$/i.test(file)) {
      console.error(`✖ ${path.basename(file)} is a spreadsheet. Re-export as CSV (Meta's download dialog offers it).`);
      process.exit(1);
    }
    const { headers, records } = parseCsv(fs.readFileSync(file, "utf8"));
    const stageCol = findStageColumn(headers);
    const emailCol = findCol(headers, /e-?mail/i);
    const phoneCol = findCol(headers, /phone|mobile|tel/i);
    const nameCol  = findCol(headers, /^(full[\s_-]*name|name)$/i) ?? findCol(headers, /name/i);

    // Stage from the column, else the --stage flag, else the filename ("not-qualified.csv").
    const fromName = normaliseStage(path.basename(file).replace(/\.csv$/i, "").replace(/[^a-z_-]/gi, ""));
    const fileStage = pin ?? (stageCol ? null : fromName);

    if (!stageCol && !fileStage) {
      console.error(
        `✖ ${path.basename(file)} has no Stage column and no stage was given.\n` +
        `   Columns found: ${headers.join(" | ")}\n` +
        `   Either re-export with the Stage column, pass --stage=<stage>, or name the file after the stage.`,
      );
      process.exit(1);
    }
    if (!emailCol && !phoneCol) {
      console.error(`✖ ${path.basename(file)} has neither an email nor a phone column — nothing to match on.\n   Columns: ${headers.join(" | ")}`);
      process.exit(1);
    }

    console.log(`\n▸ ${path.basename(file)}  (${records.length} rows)`);
    console.log(`  stage from : ${stageCol ? `column "${stageCol}"` : `${pin ? "--stage flag" : "filename"} → ${fileStage}`}`);
    console.log(`  matching on: ${[emailCol && `email "${emailCol}"`, phoneCol && `phone "${phoneCol}"`].filter(Boolean).join(", ")}`);

    const unknown = new Map();
    for (const rec of records) {
      totalRows++;
      const rawStage = stageCol ? rec[stageCol] : fileStage;
      const stage = stageCol ? normaliseStage(rawStage) : fileStage;
      if (stage === undefined) { unknown.set(rawStage, (unknown.get(rawStage) ?? 0) + 1); continue; }
      if (!stage) continue; // blank stage cell = untriaged in Meta too; leave it NULL here

      const email = emailCol && rec[emailCol] ? rec[emailCol].trim().toLowerCase() : null;
      const phone = phoneCol ? phoneKey(rec[phoneCol]) : null;
      const name  = nameCol && rec[nameCol] ? rec[nameCol].trim().toLowerCase() : null;
      const identity = email ? `e:${email}` : phone ? `p:${phone}` : name ? `n:${name}` : null;
      if (!identity) continue;

      const prev = people.get(identity);
      if (prev && prev.stage !== stage) {
        conflicts.push({ key: identity, a: prev, b: { stage, file: path.basename(file) } });
      }
      // Later file wins on a tie, but the conflict is always REPORTED, never silent.
      people.set(identity, { stage, file: path.basename(file), email, phone, name });
    }

    if (unknown.size) {
      console.error(`\n✖ ${path.basename(file)} contains stage values I do not recognise:`);
      for (const [v, n] of unknown) console.error(`     "${v}" × ${n}`);
      console.error(`   Known: ${STAGES.join(", ")}. Add an alias in normaliseStage() rather than guessing.`);
      process.exit(1);
    }
  }

  if (conflicts.length) {
    console.log(`\n⚠  ${conflicts.length} conflict(s) — the same person appears under two stages:`);
    for (const c of conflicts.slice(0, 15)) {
      console.log(`     ${c.key}  ${c.a.stage} (${c.a.file})  vs  ${c.b.stage} (${c.b.file})`);
    }
    if (conflicts.length > 15) console.log(`     ... and ${conflicts.length - 15} more`);
    console.log(`   Last file listed wins. Re-order the files on the command line to change that.`);
  }

  // ── match against the app's leads ─────────────────────────────────────────────────────
  const contacts = await q(
    `select id, lower(email) email, phone, lower(full_name) name, meta_lead_stage
       from local_contacts where ${META_FILTER}`,
  );
  console.log(`\n▸ ${contacts.length} Meta-attributed leads in the app`);

  const updates = new Map(); // contactId -> stage
  const matchedBy = { email: 0, phone: 0, name: 0 };

  /**
   * Three ordered passes, strongest key first, with BOTH sides claimed.
   *
   * A person from the export can be claimed by at most one lead, and a lead matches at most
   * one person. Doing it in one loop per contact let a weak phone match on a later contact
   * steal a person a stronger email match had already identified, which inflated the match
   * count above the number of rows in the file — the count looked fine, the assignment did not.
   */
  const claimed = new Set(); // identities from `people` already taken
  const byEmail = new Map(), byPhone = new Map(), byName = new Map();
  for (const [id, p] of people) {
    if (p.email) byEmail.set(p.email, id);
    if (p.phone && !byPhone.has(p.phone)) byPhone.set(p.phone, id);
    if (p.name && !byName.has(p.name)) byName.set(p.name, id);
  }

  // Only match on a name that is unique on BOTH sides — two different Chris Bryans exist here.
  const nameCounts = new Map();
  for (const c of contacts) if (c.name) nameCounts.set(c.name, (nameCounts.get(c.name) ?? 0) + 1);
  const exportNameCounts = new Map();
  for (const p of people.values()) if (p.name) exportNameCounts.set(p.name, (exportNameCounts.get(p.name) ?? 0) + 1);

  const passes = [
    ["email", byEmail, (c) => c.email],
    ["phone", byPhone, (c) => phoneKey(c.phone)],
    ["name",  byName,  (c) => (c.name && nameCounts.get(c.name) === 1 && exportNameCounts.get(c.name) === 1 ? c.name : null)],
  ];

  const protectedByFlag = [];
  for (const [how, index, keyOf] of passes) {
    for (const c of contacts) {
      if (updates.has(c.id)) continue;
      const k = keyOf(c);
      if (!k) continue;
      const identity = index.get(k);
      if (!identity || claimed.has(identity)) continue;
      const next = people.get(identity).stage;
      // Claim the person either way, so they are not reported as "not in the app".
      claimed.add(identity);
      if (ONLY_UNTRIAGED && c.meta_lead_stage && c.meta_lead_stage !== next) {
        protectedByFlag.push({ email: c.email, keep: c.meta_lead_stage, skipped: next });
        continue;
      }
      updates.set(c.id, next);
      matchedBy[how]++;
    }
  }

  if (protectedByFlag.length) {
    console.log(`\n⚠  --only-untriaged kept ${protectedByFlag.length} existing stage(s) rather than overwriting:`);
    for (const p of protectedByFlag) console.log(`     ${p.email}: kept "${p.keep}", did NOT apply "${p.skipped}"`);
    console.log(`   These people are in Meta twice (one row per submission) under two stages.`);
  }

  // People in the export that no lead claimed. Visible, not assumed away.
  const unmatched = [];
  for (const [identity, p] of people) {
    if (claimed.has(identity)) continue;
    unmatched.push({ who: p.email ?? p.phone ?? p.name ?? identity, stage: p.stage, file: p.file });
  }

  // ── report ────────────────────────────────────────────────────────────────────────────
  const dist = {};
  for (const s of updates.values()) dist[s] = (dist[s] ?? 0) + 1;

  console.log(`\n── RECONCILIATION ───────────────────────────────────────────`);
  console.log(`  CSV rows read           ${totalRows}`);
  console.log(`  distinct people         ${people.size}`);
  console.log(`  matched to a lead       ${updates.size}   (email ${matchedBy.email} · phone ${matchedBy.phone} · name ${matchedBy.name})`);
  console.log(`  in CSV, not in the app  ${unmatched.length}   ← Meta shows Organic/Messenger leads we do not treat as Meta-attributed`);
  console.log(`  in the app, not in CSV  ${contacts.length - updates.size}   ← stay Untriaged`);
  console.log(`\n  resulting stage distribution:`);
  for (const s of STAGES) console.log(`     ${s.padEnd(16)} ${String(dist[s] ?? 0).padStart(5)}`);
  console.log(`     ${"(untriaged)".padEnd(16)} ${String(contacts.length - updates.size).padStart(5)}`);
  console.log(`  Compare each line to Meta's Leads Centre rail. They should agree.`);

  if (unmatched.length) {
    const out = path.resolve(`meta-stage-import-unmatched.csv`);
    fs.writeFileSync(out, "who,stage,file\n" + unmatched.map((u) => `${u.who},${u.stage},${u.file}`).join("\n"));
    console.log(`\n  unmatched rows written to ${out}`);
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply once the numbers above match Meta.`);
    return;
  }

  // ── apply ─────────────────────────────────────────────────────────────────────────────
  // One UPDATE per stage. capi_status='imported' is the audit trail: it records that we
  // deliberately did NOT tell Meta (Meta is where this came from), so the Signal column can
  // say so rather than showing an unexplained blank, and the stage route can tell an
  // imported stage apart from a send that failed and needs retrying.
  console.log(`\n▸ applying…`);
  let written = 0;
  for (const s of STAGES) {
    const ids = [...updates.entries()].filter(([, v]) => v === s).map(([id]) => id);
    if (!ids.length) continue;
    const res = await q(
      `update local_contacts
          set meta_lead_stage = $1,
              meta_lead_stage_at = now(),
              meta_lead_stage_by = null,
              capi_status = 'imported',
              capi_error = 'Imported from Meta Leads Centre at cutover — Meta already has this signal, so none was sent',
              updated_at = now()
        where id = any($2::text[])
        returning id`,
      [s, ids],
    );
    written += res.length;
    console.log(`     ${s.padEnd(16)} ${String(res.length).padStart(5)}`);
  }
  console.log(`\n✔ ${written} leads staged. No Conversions API events were sent.`);
  console.log(`  Undo with: node scripts/import-meta-stages.mjs --revert --apply`);
}

/** Clears ONLY what this script wrote. A hand-set stage has capi_status 'sent'/'failed'/'skipped'. */
async function revert() {
  const [{ n }] = await q(
    `select count(*)::int n from local_contacts where capi_status = 'imported' and meta_lead_stage is not null`,
  );
  console.log(`${n} imported stage(s) found.`);
  if (!n) return;
  if (!APPLY) return console.log("DRY RUN — re-run with --apply to clear them.");
  const res = await q(
    `update local_contacts
        set meta_lead_stage = null, meta_lead_stage_at = null,
            capi_status = null, capi_error = null, updated_at = now()
      where capi_status = 'imported' and meta_lead_stage is not null
      returning id`,
  );
  console.log(`✔ reverted ${res.length}.`);
}

main().catch((e) => { console.error("\n✖", e.message ?? e); process.exit(1); });
