/**
 * Prove the pipeline board matches GoHighLevel, stage by stage.
 *
 * Run:  node_modules/.bin/tsx --env-file=.env.verify scripts/audit-pipeline-parity.ts
 *
 * WHY THIS COMPARES THE RENDERED PATH, NOT THE COLUMNS
 * `lib/pipeline/mirror-source.ts` selects only `raw_data`, skips any row where it is null,
 * and takes each card's stage from `raw.pipelineStageId`. So an audit that compares the
 * `pipeline_stage_id` COLUMN can report 100% while the board draws something different, or
 * silently drops a deal. This calls the board's own data source and counts what it returns.
 *
 * It also mirrors the board's `status = 'open'` filter, because GHL's own board defaults to
 * the "Open opportunities" tab and that is the number on Jack's screen.
 */
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { localOpportunities } from "@/lib/db/schema";
import { isNull, sql } from "drizzle-orm";
import { getPipelineOpportunitiesFromMirror } from "@/lib/pipeline/mirror-source";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const loc = locationId();
  const pipes = (await ghl.getPatient<any>(`/opportunities/pipelines?locationId=${loc}`)).pipelines ?? [];
  const stageNm: Record<string, string> = {};
  const stageOrder: Record<string, string[]> = {};
  for (const p of pipes) {
    stageOrder[p.id] = (p.stages ?? []).map((s: any) => s.id);
    for (const s of p.stages ?? []) stageNm[s.id] = s.name;
  }

  // GHL truth, from the full feed.
  const ghlOpps = new Map<string, { pid: string | null; sid: string | null; status: string | null }>();
  let url: string | null = `/opportunities/search?location_id=${loc}&limit=100`;
  let reported = 0;
  while (url) {
    const pageUrl: string = url;
    const page: any = await ghl.getPatient(pageUrl);
    if (page.meta?.total != null) reported = page.meta.total;
    for (const o of page.opportunities ?? []) {
      ghlOpps.set(o.id, {
        pid: o.pipeline?.id ?? o.pipelineId ?? null,
        sid: o.pipelineStageId ?? null,
        status: o.status ?? null,
      });
    }
    const next = page.meta?.nextPageUrl ?? null;
    url = next ? next.replace(/^https:\/\/services\.leadconnectorhq\.com/, "") : null;
    await sleep(120);
  }

  // Integrity of the column the board depends on.
  const [raw] = await db().select({
    live: sql<number>`count(*)::int`,
    nullRaw: sql<number>`count(*) filter (where raw_data is null)::int`,
    stageDisagree: sql<number>`count(*) filter (where raw_data is not null and coalesce(raw_data->>'pipelineStageId','') <> coalesce(pipeline_stage_id,''))::int`,
  }).from(localOpportunities).where(isNull(localOpportunities.deletedInGhlAt));

  console.log(`GHL reported total     : ${reported}`);
  console.log(`GHL fetched            : ${ghlOpps.size}`);
  console.log(`mirror live rows       : ${raw.live}`);
  console.log(`rows with NULL raw_data: ${raw.nullRaw}   <- any of these are INVISIBLE on the board`);
  console.log(`column vs raw_data     : ${raw.stageDisagree} stage disagreements   <- cards drawn in the wrong column`);

  let problems = 0;
  console.log("\n" + "".padEnd(94, "="));
  for (const p of pipes) {
    // What the board will actually draw for this pipeline.
    const rendered = await getPipelineOpportunitiesFromMirror(p.id);
    const renderedByStage = new Map<string, number>();
    for (const o of rendered) {
      const sid = (o as any).pipelineStageId as string;
      renderedByStage.set(sid, (renderedByStage.get(sid) ?? 0) + 1);
    }
    // GHL's equivalent view: this pipeline, open only.
    const ghlOpen = [...ghlOpps.values()].filter((o) => o.pid === p.id && o.status === "open");
    const ghlByStage = new Map<string, number>();
    for (const o of ghlOpen) ghlByStage.set(o.sid ?? "", (ghlByStage.get(o.sid ?? "") ?? 0) + 1);

    const totalOk = rendered.length === ghlOpen.length;
    if (!totalOk) problems++;
    console.log(`\n${totalOk ? "OK " : "!! "}${p.name}   GHL open ${ghlOpen.length} | board ${rendered.length}`);

    const stageIds = new Set([...stageOrder[p.id], ...renderedByStage.keys()]);
    for (const sid of stageIds) {
      const g = ghlByStage.get(sid) ?? 0;
      const b = renderedByStage.get(sid) ?? 0;
      if (g === 0 && b === 0) continue;
      if (g !== b) problems++;
      console.log(`${g === b ? "   ok " : "   !! "}${(stageNm[sid] ?? sid).slice(0, 52).padEnd(54)} GHL ${String(g).padStart(5)} | board ${String(b).padStart(5)}`);
    }
  }

  const clean = problems === 0 && raw.nullRaw === 0 && raw.stageDisagree === 0;
  console.log(`\nVERDICT: ${clean ? "100% PARITY — every stage of every pipeline, as rendered" : `${problems} stage/total mismatches`}`);
  process.exit(clean ? 0 : 1);
})();
