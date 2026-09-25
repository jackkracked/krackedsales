/**
 * Make `local_opportunities` SET-EQUAL to GoHighLevel, safely enough to run unattended.
 *
 * WHY THIS EXISTS
 * `lib/ghl/sync.ts` is upsert-only: it inserts and updates, and has no mechanism to remove
 * anything. So when something disappears from GHL the mirror keeps it forever and the pipeline
 * board over-counts. Measured 2026-08-25: 23 ghosts location-wide. Every single one traced to a
 * deleted CONTACT (GHL cascades the delete to that contact's opportunities), not a deleted
 * opportunity, which is why the team could truthfully say they had deleted nothing.
 *
 * WHY IT IS A LIBRARY AND NOT THE OLD SCRIPT
 * `scripts/reconcile-opportunities.mjs` computes the right diff but has NO protection against a
 * short read. Its fetch loop stops on `nextPageUrl: null`, which is indistinguishable from GHL
 * truncating the feed, and it then marks everything absent as deleted. Cut off at page 5 of 38
 * and it soft-deletes ~3,100 live deals. Since `sync.ts` never clears `deleted_in_ghl_at`, that
 * damage would have been permanent and silent. Four guards below exist specifically for that.
 *
 * READ-ONLY against GHL. Writes only to our own database. Sends nothing to anyone.
 */
import { and, inArray, isNull, lt, sql } from "drizzle-orm";
import { GHLError, ghl, isRateLimit, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { localOpportunities } from "@/lib/db/schema";

interface GhlOpp {
  id: string;
  name?: string;
  status?: string;
  source?: string;
  monetaryValue?: number;
  assignedTo?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  pipeline?: { id?: string };
  lastStageChangeAt?: string;
  createdAt?: string;
  dateAdded?: string;
  updatedAt?: string;
  dateUpdated?: string;
  contact?: { id?: string; name?: string; email?: string; phone?: string; companyName?: string };
}

export interface ReconcileResult {
  ok: boolean;
  /** Set when a GUARD refused to act. The mirror is untouched in that case. */
  abortedReason?: string;
  /**
   * Set when the sweep BROKE rather than refused — usually GHL rate-limiting the walk.
   * Kept separate from `abortedReason` because reporting a crash as a deliberate refusal
   * is exactly the lie that made 2026-09-12 expensive to diagnose.
   */
  failed?: boolean;
  failureReason?: string;
  /** True when the cause was a 429, which is worth retrying later rather than alarming about. */
  rateLimited?: boolean;
  ghlTotal: number;
  fetched: number;
  pages: number;
  mirrorLive: number;
  inserted: number;
  updated: number;
  markedDeleted: number;
  restored: number;
  dryRun: boolean;
  /** A sample of what would be / was removed, for the dry-run report. */
  deleteSample: Array<{ id: string; name: string | null }>;
  durationMs: number;
}

/** Never remove more than this share of the live mirror in a single pass. */
const MAX_DELETE_FRACTION = 0.02;
/** ...but always allow a small absolute number, so a tiny mirror is not permanently stuck. */
const MAX_DELETE_FLOOR = 50;
/** 3,633 opportunities is 38 pages today. 100 is generous headroom; beyond it something is wrong. */
const MAX_PAGES = 100;

/** Stay inside GHL's burst window. 39 pages costs ~4s of politeness. */
const PAGE_GAP_MS = 100;

/**
 * Give up before the platform does.
 *
 * The route's maxDuration is 300s. One patient call can burn up to ~188s on its own (6
 * attempts x the 20s attempt timeout, plus the 68s backoff ladder), so two slow calls
 * anywhere in the walk blow the budget. Being killed by Vercel is the worst outcome
 * available: no JSON body, so the client cannot tell a crash from a refusal, which is the
 * exact confusion this whole change exists to remove. Stopping ourselves means a real 503
 * with a real reason.
 */
const TIME_BUDGET_MS = 240_000;

/**
 * Run a sweep, and never throw.
 *
 * Every caller of this used to have to guess whether an exception meant "a guard stopped
 * me" or "GHL fell over", and the pipeline banner guessed wrong. A failure is now a value.
 */
export async function reconcileOpportunities(
  opts: { dryRun?: boolean } = {},
): Promise<ReconcileResult> {
  const t0 = Date.now();
  try {
    return await runReconcile(opts);
  } catch (err) {
    const rateLimited = isRateLimit(err);
    // Log the real error; return a classified one. `GHLError.message` embeds the request path
    // (including location_id) and GHL's raw response body, none of which belongs in a browser.
    console.error("[reconcile] sweep failed", err);
    return {
      ok: false,
      failed: true,
      rateLimited,
      failureReason: rateLimited
        ? "GoHighLevel is rate-limiting us. It will try again shortly."
        : err instanceof GHLError
          ? "GoHighLevel did not respond in time."
          : "The check could not complete.",
      ghlTotal: 0, fetched: 0, pages: 0, mirrorLive: 0,
      inserted: 0, updated: 0, markedDeleted: 0, restored: 0,
      dryRun: !!opts.dryRun, deleteSample: [],
      durationMs: Date.now() - t0,
    };
  }
}

async function runReconcile(
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<ReconcileResult> {
  const startedAt = new Date();
  const t0 = Date.now();
  const loc = locationId();

  const empty = {
    ghlTotal: 0, fetched: 0, pages: 0, mirrorLive: 0,
    inserted: 0, updated: 0, markedDeleted: 0, restored: 0,
    dryRun, deleteSample: [] as Array<{ id: string; name: string | null }>,
  };

  // ── 0. Snapshot the mirror FIRST ───────────────────────────────────────────────────────────
  // Deliberately before the GHL fetch, which takes ~25s. A row created during that window is
  // absent from the frozen GHL snapshot but present in the mirror, and reading the mirror last
  // would mark it deleted. Reading first means it simply is not a candidate this pass.
  const mirrorRows = await db()
    .select({
      id: localOpportunities.id,
      pipelineId: localOpportunities.pipelineId,
      pipelineStageId: localOpportunities.pipelineStageId,
      status: localOpportunities.status,
      deletedInGhlAt: localOpportunities.deletedInGhlAt,
      name: localOpportunities.name,
    })
    .from(localOpportunities);
  const mirror = new Map(mirrorRows.map((r) => [r.id, r]));
  const mirrorLive = mirrorRows.filter((r) => !r.deletedInGhlAt).length;

  // ── 1. Pipeline + stage names, so the mirror is auditable without a join ───────────────────
  const pipelines = (await ghl.getPatient<{ pipelines?: Array<{ id: string; name: string; stages?: Array<{ id: string; name: string }> }> }>(
    `/opportunities/pipelines?locationId=${loc}`,
  )).pipelines ?? [];
  const pipeName: Record<string, string> = {};
  const stageName: Record<string, string> = {};
  for (const p of pipelines) {
    pipeName[p.id] = p.name;
    for (const s of p.stages ?? []) stageName[s.id] = s.name;
  }

  // ── 2. The authoritative set, with guards on the read itself ──────────────────────────────
  const fetched = new Map<string, GhlOpp>();
  let ghlTotal = 0;
  let pages = 0;
  let url: string | null = `/opportunities/search?location_id=${loc}&limit=100`;

  while (url) {
    // Sequential AND spaced. The walk is ~39 requests; firing them back to back is what
    // trips GHL's per-location burst limit and kills the sweep mid-flight.
    if (pages > 0) await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
    const page: { opportunities?: GhlOpp[]; meta?: { total?: number; nextPageUrl?: string | null } } =
      await ghl.getPatient(url);
    // GHL states the true total on every page. It is the only independent check we have that
    // the feed did not stop early, so capture it and verify against it below.
    if (page.meta?.total != null) ghlTotal = page.meta.total;

    const before = fetched.size;
    for (const o of page.opportunities ?? []) fetched.set(o.id, o);
    pages++;

    // GUARD: a page that adds nothing while claiming there is more means we are looping.
    if (fetched.size === before && page.meta?.nextPageUrl) {
      return { ok: false, abortedReason: `page ${pages} added no new records but claimed more; refusing to delete on a suspect read`, ...empty, ghlTotal, fetched: fetched.size, pages, mirrorLive, durationMs: Date.now() - t0 };
    }
    // GUARD: out of time. Stop cleanly rather than being killed mid-walk.
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      return { ok: false, failed: true, failureReason: "GoHighLevel is responding too slowly to finish the check.", ...empty, ghlTotal, fetched: fetched.size, pages, mirrorLive, durationMs: Date.now() - t0 };
    }
    // GUARD: runaway pagination.
    if (pages > MAX_PAGES) {
      return { ok: false, abortedReason: `exceeded ${MAX_PAGES} pages; refusing to act`, ...empty, ghlTotal, fetched: fetched.size, pages, mirrorLive, durationMs: Date.now() - t0 };
    }

    const next = page.meta?.nextPageUrl ?? null;
    url = next ? next.replace(/^https:\/\/services\.leadconnectorhq\.com/, "") : null;
  }

  // GUARD, THE IMPORTANT ONE: only trust a complete read. `nextPageUrl: null` looks identical
  // whether the feed ended or GHL truncated it, so we verify against the total GHL itself
  // reported rather than assuming the walk finished.
  if (ghlTotal > 0 && fetched.size < ghlTotal) {
    return { ok: false, abortedReason: `short read: fetched ${fetched.size} of ${ghlTotal} reported by GHL; refusing to delete anything`, ...empty, ghlTotal, fetched: fetched.size, pages, mirrorLive, durationMs: Date.now() - t0 };
  }

  // ── 3. Diff ───────────────────────────────────────────────────────────────────────────────
  const toInsert: GhlOpp[] = [];
  const toUpdate: GhlOpp[] = [];
  const toRestore: GhlOpp[] = [];
  const toDelete: string[] = [];

  for (const [id, o] of fetched) {
    const m = mirror.get(id);
    if (!m) { toInsert.push(o); continue; }
    if (m.deletedInGhlAt) { toRestore.push(o); continue; }
    const stage = o.pipelineStageId ?? null;
    const pid = o.pipeline?.id ?? o.pipelineId ?? null;
    if (m.pipelineStageId !== stage || m.status !== (o.status ?? null) || m.pipelineId !== pid) {
      toUpdate.push(o);
    }
  }
  for (const [id, m] of mirror) {
    if (!fetched.has(id) && !m.deletedInGhlAt) toDelete.push(id);
  }

  // GUARD: blast radius. Real drift is single digits to low tens. An order of magnitude more is
  // a bug in the read, not a business event, and it should stop and be looked at by a human.
  const deleteCap = Math.max(MAX_DELETE_FLOOR, Math.floor(mirrorLive * MAX_DELETE_FRACTION));
  if (toDelete.length > deleteCap) {
    return {
      ok: false,
      abortedReason: `would mark ${toDelete.length} deleted, over the ${deleteCap} cap (${Math.round(MAX_DELETE_FRACTION * 100)}% of ${mirrorLive}); refusing`,
      ...empty, ghlTotal, fetched: fetched.size, pages, mirrorLive,
      deleteSample: toDelete.slice(0, 10).map((id) => ({ id, name: mirror.get(id)?.name ?? null })),
      durationMs: Date.now() - t0,
    };
  }

  // GUARD, THE LAST ONE BEFORE WE REMOVE ANYTHING: ask GHL about each id directly.
  //
  // Absence from the search feed is NOT proof of deletion. This repo already records that
  // `/opportunities/search` "omits open opps" (app/api/ghl/opportunities/route.ts). An
  // omitted deal is missing from the walk AND from the `meta.total` the short-read guard
  // checks against, so that guard passes and the deal is soft-deleted. Nothing ever clears
  // `deleted_in_ghl_at` except a later walk that would have to include the row it
  // structurally omits, and `sync.ts` never clears it — so that loss is permanent, silent,
  // and visible on the board. The blast-radius cap does not help: it stops a catastrophe of
  // 3,100, not a quiet loss of 8.
  //
  // A per-id 404 is proof. That is exactly how the 17 ghosts were verified by hand on
  // 2026-09-12 before anything was written, and it costs one cheap call per candidate.
  const confirmedDeleted: string[] = [];
  const feedLied: Array<{ id: string; name: string | null }> = [];
  for (const id of toDelete) {
    // Confirming is worth nothing if we are killed before applying it. Bail with what we
    // have rather than spending the remaining budget on checks we cannot act on.
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      return { ok: false, failed: true, failureReason: "GoHighLevel is responding too slowly to finish the check.", ...empty, ghlTotal, fetched: fetched.size, pages, mirrorLive, durationMs: Date.now() - t0 };
    }
    try {
      await ghl.getPatient<unknown>(`/opportunities/${id}`);
      // 200 means it is alive and the feed simply did not list it. Keep the row.
      feedLied.push({ id, name: mirror.get(id)?.name ?? null });
    } catch (err) {
      if (err instanceof GHLError && err.status === 404) {
        confirmedDeleted.push(id);
      } else {
        // Could not tell. Never delete on "could not tell".
        feedLied.push({ id, name: mirror.get(id)?.name ?? null });
      }
    }
  }
  if (feedLied.length) {
    // Direct evidence the feed is lossy. Worth knowing on its own.
    console.error(
      `[pipeline/reconcile] ${feedLied.length} of ${toDelete.length} delete candidates were NOT confirmed gone; keeping them`,
      feedLied.slice(0, 10),
    );
  }

  const deleteSample = confirmedDeleted.slice(0, 10).map((id) => ({ id, name: mirror.get(id)?.name ?? null }));

  if (dryRun) {
    return {
      ok: true, ghlTotal, fetched: fetched.size, pages, mirrorLive,
      inserted: toInsert.length, updated: toUpdate.length,
      markedDeleted: confirmedDeleted.length, restored: toRestore.length,
      dryRun: true, deleteSample, durationMs: Date.now() - t0,
    };
  }

  // ── 4. Apply ──────────────────────────────────────────────────────────────────────────────
  const row = (o: GhlOpp) => ({
    id: o.id,
    contactId: o.contact?.id ?? null,
    pipelineId: o.pipeline?.id ?? o.pipelineId ?? null,
    pipelineStageId: o.pipelineStageId ?? null,
    pipelineName: pipeName[o.pipeline?.id ?? o.pipelineId ?? ""] ?? null,
    stageName: stageName[o.pipelineStageId ?? ""] ?? null,
    name: o.name ?? null,
    status: o.status ?? null,
    monetaryValue: o.monetaryValue ?? null,
    assignedTo: o.assignedTo ?? null,
    source: o.source ?? null,
    contactName: o.contact?.name ?? null,
    contactEmail: o.contact?.email ?? null,
    contactPhone: o.contact?.phone ?? null,
    contactCompanyName: o.contact?.companyName ?? null,
    // THE BOARD RENDERS FROM THIS COLUMN, NOT FROM THE ONES ABOVE.
    // `lib/pipeline/mirror-source.ts` selects only `raw_data` and skips any row where it is
    // null (`if (!raw || !raw.id) continue`), drawing each card's stage from
    // `raw.pipelineStageId`. Omitting it here meant an inserted deal was invisible on the
    // board, and a stage change updated a column nobody reads while the card stayed put.
    // `lib/ghl/sync.ts` has always written it; this writer did not. Found in review, 2026-09-12.
    rawData: o as unknown as Record<string, unknown>,
    lastStageChangeAt: o.lastStageChangeAt ? new Date(o.lastStageChangeAt) : null,
    createdAtGhl: o.dateAdded ? new Date(o.dateAdded) : o.createdAt ? new Date(o.createdAt) : null,
    updatedAtGhl: o.dateUpdated ? new Date(o.dateUpdated) : o.updatedAt ? new Date(o.updatedAt) : null,
    deletedInGhlAt: null,
    syncedAt: new Date(),
  });

  const database = db();
  const writes = [...toInsert, ...toUpdate, ...toRestore].map(row);
  for (let i = 0; i < writes.length; i += 100) {
    const chunk = writes.slice(i, i + 100);
    await database
      .insert(localOpportunities)
      .values(chunk)
      .onConflictDoUpdate({
        target: localOpportunities.id,
        set: {
          // Refreshed on update as well as insert: an opportunity reassigned to a different
          // contact in GHL would otherwise stay joined to the old one until the next
          // sync.ts pass. sync.ts refreshes it; this writer did not.
          contactId: sql`excluded.contact_id`,
          updatedAt: sql`now()`,
          pipelineId: sql`excluded.pipeline_id`,
          pipelineStageId: sql`excluded.pipeline_stage_id`,
          pipelineName: sql`excluded.pipeline_name`,
          stageName: sql`excluded.stage_name`,
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          monetaryValue: sql`excluded.monetary_value`,
          assignedTo: sql`excluded.assigned_to`,
          source: sql`excluded.source`,
          contactName: sql`excluded.contact_name`,
          contactEmail: sql`excluded.contact_email`,
          contactPhone: sql`excluded.contact_phone`,
          contactCompanyName: sql`excluded.contact_company_name`,
          rawData: sql`excluded.raw_data`,
          lastStageChangeAt: sql`excluded.last_stage_change_at`,
          createdAtGhl: sql`excluded.created_at_ghl`,
          updatedAtGhl: sql`excluded.updated_at_ghl`,
          // Present in GHL means not deleted. This is what makes any false positive self-healing.
          deletedInGhlAt: sql`NULL`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }

  // Only rows that existed BEFORE we snapshotted GHL are eligible for deletion, so anything
  // created mid-run by a concurrent sync or webhook is never caught in the sweep.
  let markedDeleted = 0;
  if (confirmedDeleted.length) {
    for (let i = 0; i < confirmedDeleted.length; i += 200) {
      const chunk = confirmedDeleted.slice(i, i + 200);
      const res = await database
        .update(localOpportunities)
        .set({ deletedInGhlAt: new Date() })
        .where(and(
          inArray(localOpportunities.id, chunk),
          lt(localOpportunities.syncedAt, startedAt),
        ))
        .returning({ id: localOpportunities.id });
      markedDeleted += res.length;
    }
  }

  return {
    ok: true, ghlTotal, fetched: fetched.size, pages, mirrorLive,
    inserted: toInsert.length, updated: toUpdate.length,
    markedDeleted, restored: toRestore.length,
    dryRun: false, deleteSample, durationMs: Date.now() - t0,
  };
}

/**
 * The cheap drift check: ONE request. GHL reports its own total, we count ours, and the two
 * either agree or they do not. ~350ms, so it is affordable on every page load.
 *
 * It cannot catch a compensating pair (one wrongly present AND one wrongly missing cancel out),
 * which is why a full sweep still runs on a schedule.
 */
export async function checkOpportunityDrift(): Promise<{
  inSync: boolean; ghlTotal: number; mirrorTotal: number; drift: number;
}> {
  const loc = locationId();
  const [res, counted] = await Promise.all([
    ghl.get<{ meta?: { total?: number } }>(`/opportunities/search?location_id=${loc}&limit=1`),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(localOpportunities)
      .where(isNull(localOpportunities.deletedInGhlAt)),
  ]);
  // A missing total must NOT read as zero. `?? 0` turned an unparseable response into
  // "GHL has no opportunities", which looks like drift of the entire mirror (~3,772) and
  // sends the hook straight into a full sweep for no reason.
  if (res.meta?.total == null) {
    throw new Error("GoHighLevel did not report a total; cannot compare");
  }
  const ghlTotal = res.meta.total;
  const mirrorTotal = Number(counted[0]?.n ?? 0);
  return { inSync: ghlTotal === mirrorTotal, ghlTotal, mirrorTotal, drift: mirrorTotal - ghlTotal };
}
