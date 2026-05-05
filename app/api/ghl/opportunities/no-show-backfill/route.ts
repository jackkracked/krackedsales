import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { pipelineStageEvents } from "@/lib/db/schema";
import { and, eq, gte } from "drizzle-orm";
import type { GHLOpportunity } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // up to 5 min — scanning many conversations

const PIPELINE_ID    = "JRvrpfcwAlAOM38mPAUJ"; // Email Design Demo Pipeline (AD FUNNEL)
const NO_SHOW_STAGE  = { id: "8ffee91a-402a-4591-84cd-2dcb0023fbaa", name: "Intro Call (No-Show)" };

// Activity message body text that indicates an opp was moved INTO the no-show stage.
// GHL doesn't document the exact format, so we match several common patterns.
const NO_SHOW_PATTERNS = [
  /intro call \(no-show\)/i,
  /no.show/i,
  /moved to.*no.show/i,
  /stage.*no.show/i,
];

interface GHLOppsResponse {
  opportunities: GHLOpportunity[];
  meta?: { total: number; currentPage: number; nextPage: number | null };
}

interface GHLConversationSearchResponse {
  conversations: Array<{ id: string; contactId: string }>;
}

interface GHLMessage {
  id: string;
  messageType: string;
  body: string;
  dateAdded: string;
}

interface GHLMessagesResponse {
  messages: { messages: GHLMessage[] };
}

function parseDate(val: string | undefined): number {
  if (!val) return 0;
  const n = Number(val);
  if (!isNaN(n) && String(n) === val) return n;
  return new Date(val).getTime();
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { since?: string; until?: string };
  const since = body.since ?? "2026-04-01";
  const until = body.until ?? new Date().toISOString().split("T")[0];

  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(`${until}T23:59:59Z`).getTime();

  const loc = locationId();
  const client = db();

  // ── Step 1: Fetch all opps in the AD FUNNEL pipeline ──────────────────────
  const allOpps: GHLOpportunity[] = [];
  let page = 1;
  while (true) {
    const res = await ghl.get<GHLOppsResponse>(
      `/opportunities/search?location_id=${loc}&pipeline_id=${PIPELINE_ID}&limit=100&page=${page}`
    );
    const batch = res.opportunities ?? [];
    allOpps.push(...batch);
    if (!res.meta?.nextPage || batch.length < 100) break;
    page++;
  }

  console.log(`[no-show-backfill] Total opps in pipeline: ${allOpps.length}`);

  // ── Step 2: Load already-recorded events so we skip duplicates ────────────
  const existingRecords = await client
    .select({ opportunityId: pipelineStageEvents.opportunityId, enteredAt: pipelineStageEvents.enteredAt })
    .from(pipelineStageEvents)
    .where(eq(pipelineStageEvents.stageId, NO_SHOW_STAGE.id));

  const existingOpps = new Set(existingRecords.map((r) => r.opportunityId));

  // ── Step 3: Seed opps CURRENTLY in the no-show stage ─────────────────────
  // Their updatedAt = the time they were moved to this stage (reliable when no
  // subsequent stage change has happened, which is true for leads still here).
  let seededFromStage = 0;
  const currentlyInNoShow = allOpps.filter((o) => o.pipelineStageId === NO_SHOW_STAGE.id);

  for (const opp of currentlyInNoShow) {
    if (existingOpps.has(opp.id)) continue;
    const enteredAt = new Date(parseDate(opp.updatedAt) || parseDate(opp.createdAt));
    // Only seed if within the requested date range
    const ts = enteredAt.getTime();
    if (ts < sinceMs || ts > untilMs) continue;

    await client.insert(pipelineStageEvents).values({
      opportunityId: opp.id,
      contactId:     opp.contact?.id ?? null,
      pipelineId:    PIPELINE_ID,
      stageId:       NO_SHOW_STAGE.id,
      stageName:     NO_SHOW_STAGE.name,
      enteredAt,
      source:        "backfill",
    });
    existingOpps.add(opp.id);
    seededFromStage++;
  }

  console.log(`[no-show-backfill] Seeded ${seededFromStage} opps from current stage`);

  // ── Step 4: Scan conversations for opps that PASSED THROUGH no-show ───────
  // Target: opps NOT currently in no-show, updated during the period
  // (means something happened to them in the period — could include a stage move)
  const candidateOpps = allOpps.filter((o) => {
    if (o.pipelineStageId === NO_SHOW_STAGE.id) return false; // already handled above
    if (existingOpps.has(o.id)) return false;
    const updatedMs = parseDate(o.updatedAt);
    return updatedMs >= sinceMs && updatedMs <= untilMs;
  });

  console.log(`[no-show-backfill] Scanning conversations for ${candidateOpps.length} candidate opps...`);

  let scannedConvs = 0;
  let foundViaActivity = 0;
  const errors: string[] = [];

  for (const opp of candidateOpps) {
    try {
      // Get the contact's conversation
      const contactId = opp.contact?.id;
      if (!contactId) continue;

      const convSearch = await ghl.get<GHLConversationSearchResponse>(
        `/conversations/search?locationId=${loc}&contactId=${contactId}&limit=1`
      );
      const conv = convSearch.conversations?.[0];
      if (!conv) continue;

      // Fetch TYPE_ACTIVITY_OPPORTUNITY messages only — these are stage change logs
      const msgRes = await ghl.get<GHLMessagesResponse>(
        `/conversations/${conv.id}/messages?type=TYPE_ACTIVITY_OPPORTUNITY&limit=100`
      );
      const messages = msgRes.messages?.messages ?? [];

      scannedConvs++;

      for (const msg of messages) {
        const msgTime = new Date(msg.dateAdded).getTime();
        if (msgTime < sinceMs || msgTime > untilMs) continue;

        const body = msg.body ?? "";
        const isNoShow = NO_SHOW_PATTERNS.some((p) => p.test(body));
        if (!isNoShow) continue;

        // Found a stage-change message for no-show within the period
        await client.insert(pipelineStageEvents).values({
          opportunityId: opp.id,
          contactId:     contactId,
          pipelineId:    PIPELINE_ID,
          stageId:       NO_SHOW_STAGE.id,
          stageName:     NO_SHOW_STAGE.name,
          enteredAt:     new Date(msg.dateAdded),
          source:        "backfill",
        });
        existingOpps.add(opp.id);
        foundViaActivity++;
        console.log(`[no-show-backfill] Found via activity: opp=${opp.id} msg="${body.slice(0, 80)}"`);
        break; // one entry per opp per pass
      }

      // Rate-limit: ~20 req/s to stay well within GHL limits
      await delay(50);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`opp=${opp.id}: ${msg}`);
      console.error(`[no-show-backfill] Error scanning opp ${opp.id}:`, err);
    }
  }

  const summary = {
    since, until,
    totalOppsInPipeline: allOpps.length,
    currentlyInNoShowStage: currentlyInNoShow.length,
    seededFromStage,
    candidatesScanned: candidateOpps.length,
    conversationsChecked: scannedConvs,
    foundViaActivityMessages: foundViaActivity,
    totalInserted: seededFromStage + foundViaActivity,
    errors: errors.slice(0, 10), // cap to avoid huge response
  };

  console.log("[no-show-backfill] Done:", summary);
  return NextResponse.json(summary);
}
