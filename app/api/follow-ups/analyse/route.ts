/**
 * POST /api/follow-ups/analyse
 *
 * Generates AI recommendations for all contacts currently in the follow-up queue
 * that don't already have a pending recommendation.
 *
 * Called by the nightly cron and by the "Refresh" button in the UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { followupSends, followupRecommendations } from "@/lib/db/schema";
import { and, eq, inArray, desc } from "drizzle-orm";
import type { GHLOpportunity, GHLPipeline, GHLConversation } from "@/lib/ghl/types";
import { generateFollowUpRecommendation } from "@/lib/ai/followup-engine";
import type { FollowUpZone } from "@/lib/ai/followup-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PIPELINE_ID = "JRvrpfcwAlAOM38mPAUJ";

function parseGHLDate(val: string | undefined | null): number {
  if (!val) return 0;
  const n = Number(val);
  if (!isNaN(n) && String(n) === val) return n;
  return new Date(val).getTime();
}

function determineZone(stageName: string, daysSince: number): FollowUpZone | null {
  const s = stageName.toLowerCase();
  if (s.includes("demo sent") || s.includes("completed demo")) return 1;
  if (s.includes("no-show") || s.includes("no show")) return 2;
  if (s.includes("sale in progress") || s.includes("proposal sent") || s.includes("proposal")) {
    return daysSince >= 10 || s.includes("unresponsive") ? 4 : 3;
  }
  return null;
}

function channelFromConvType(type: string): string {
  const t = type.toUpperCase();
  if (t.includes("SMS")) return "SMS";
  if (t.includes("EMAIL")) return "EMAIL";
  if (t.includes("INSTAGRAM")) return "INSTAGRAM";
  if (t.includes("FB") || t.includes("FACEBOOK")) return "FACEBOOK";
  return "EMAIL";
}

export async function POST(req: NextRequest) {
  // Allow cron or UI to trigger — check for optional secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    // Accept cron header OR no header (UI trigger)
    if (auth && auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const loc = locationId();
    const client = db();
    const nowMs = Date.now();

    // ── 1. Fetch pipeline stages ───────────────────────────────────────────────
    const pipelinesData = await ghl.get<{ pipelines: GHLPipeline[] }>(
      `/opportunities/pipelines?locationId=${loc}`
    );
    const pipeline = pipelinesData.pipelines?.find((p) => p.id === PIPELINE_ID);
    const stageMap: Record<string, string> = {};
    if (pipeline?.stages) {
      for (const s of pipeline.stages) stageMap[s.id] = s.name;
    }

    // ── 2. Fetch open opportunities ────────────────────────────────────────────
    const allOpps: GHLOpportunity[] = [];
    let page = 1;
    while (true) {
      const res = await ghl.get<{
        opportunities: GHLOpportunity[];
        meta?: { nextPage: number | null };
      }>(
        `/opportunities/search?location_id=${loc}&pipeline_id=${PIPELINE_ID}&status=open&limit=100&page=${page}`
      );
      const batch = res.opportunities ?? [];
      allOpps.push(...batch);
      if (!res.meta?.nextPage || batch.length < 100) break;
      page++;
    }

    // ── 3. Filter to follow-up stages ─────────────────────────────────────────
    const candidates: Array<{
      opp: GHLOpportunity;
      stageName: string;
      zone: FollowUpZone;
      daysSince: number;
      daysInStage: number;
    }> = [];

    for (const opp of allOpps) {
      const stageName = stageMap[opp.pipelineStageId] ?? "Unknown";
      const lastMs = parseGHLDate(opp.updatedAt) || parseGHLDate(opp.createdAt);
      const daysSince = Math.floor((nowMs - lastMs) / (1000 * 60 * 60 * 24));
      const daysInStage = daysSince;
      const zone = determineZone(stageName, daysSince);
      if (!zone) continue;
      candidates.push({ opp, stageName, zone, daysSince, daysInStage });
    }

    if (candidates.length === 0) {
      return NextResponse.json({ analysed: 0, skipped: 0 });
    }

    // ── 4. Find which opps already have pending recommendations ───────────────
    const oppIds = candidates.map((c) => c.opp.id);
    const existing = await client
      .select({ oppId: followupRecommendations.oppId })
      .from(followupRecommendations)
      .where(
        and(
          inArray(followupRecommendations.oppId, oppIds),
          inArray(followupRecommendations.status, ["pending", "skipped"])
        )
      );
    const existingOppIds = new Set(existing.map((r) => r.oppId));

    const toAnalyse = candidates.filter((c) => !existingOppIds.has(c.opp.id));

    // ── 5. Load send history for all candidates ────────────────────────────────
    const contactIds = toAnalyse
      .map((c) => c.opp.contact?.id)
      .filter(Boolean) as string[];

    const allSends =
      contactIds.length > 0
        ? await client
            .select({
              ghlContactId: followupSends.ghlContactId,
              messageText: followupSends.messageText,
              angle: followupSends.angle,
              sentAt: followupSends.sentAt,
              resultedInResponse: followupSends.resultedInResponse,
              channel: followupSends.channel,
            })
            .from(followupSends)
            .where(inArray(followupSends.ghlContactId, contactIds))
            .orderBy(desc(followupSends.sentAt))
        : [];

    const sendsMap = new Map<string, typeof allSends>();
    for (const s of allSends) {
      const arr = sendsMap.get(s.ghlContactId) ?? [];
      arr.push(s);
      sendsMap.set(s.ghlContactId, arr);
    }

    // ── 6. Fetch conversations for channel detection (batched) ─────────────────
    const convMap = new Map<string, string>(); // contactId → channel
    const CONV_BATCH = 5;
    for (let i = 0; i < contactIds.length; i += CONV_BATCH) {
      const batch = contactIds.slice(i, i + CONV_BATCH);
      await Promise.allSettled(
        batch.map(async (cid) => {
          try {
            const data = await ghl.get<{ conversations: GHLConversation[] }>(
              `/conversations/search?contactId=${cid}&location_id=${loc}&limit=1`
            );
            const conv = data.conversations?.[0];
            if (conv) convMap.set(cid, channelFromConvType(conv.type ?? ""));
          } catch {
            // non-fatal
          }
        })
      );
    }

    // ── 7. Generate AI recommendations ────────────────────────────────────────
    let analysed = 0;
    let skipped = 0;

    for (const { opp, stageName, zone, daysSince } of toAnalyse) {
      const contactId = opp.contact?.id;
      if (!contactId) { skipped++; continue; }

      const sends = sendsMap.get(contactId) ?? [];
      const hasEverReplied = sends.some((s) => s.resultedInResponse);
      const channel = convMap.get(contactId) ?? sends[0]?.channel ?? "EMAIL";

      try {
        const ctx = {
          contact: {
            name: opp.contact?.name ?? "there",
            firstName: (opp.contact?.name ?? "there").split(" ")[0],
            website: null as string | null,
            channel,
          },
          pipeline: {
            currentStage: stageName,
            zone,
            daysInStage: daysSince,
            daysSinceLastContact: daysSince,
            totalFollowUpsSent: sends.length,
          },
          history: {
            hasEverReplied,
            lastReplyText: null as string | null,
            messagesSent: sends.slice(0, 5).map((s) => ({
              daysAgo: Math.floor(
                (nowMs - s.sentAt.getTime()) / (1000 * 60 * 60 * 24)
              ),
              angle: s.angle,
              preview: s.messageText.slice(0, 80),
            })),
          },
        };

        const aiRec = await generateFollowUpRecommendation(ctx);

        await client.insert(followupRecommendations).values({
          ghlContactId: contactId,
          oppId: opp.id,
          stageName,
          type: aiRec.type,
          reasoning: aiRec.reasoning,
          messagesJson: aiRec.messages,
          status: "pending",
        });

        analysed++;
      } catch (e) {
        console.error(`[follow-ups/analyse] Failed for contact=${contactId}:`, e);
        skipped++;
      }
    }

    console.log(
      `[follow-ups/analyse] Done. candidates=${candidates.length} analysed=${analysed} skipped=${skipped} already_had_rec=${existingOppIds.size}`
    );

    return NextResponse.json({
      analysed,
      skipped,
      alreadyHadRecommendation: existingOppIds.size,
    });
  } catch (err) {
    console.error("[POST /api/follow-ups/analyse]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
