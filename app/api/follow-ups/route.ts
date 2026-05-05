import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { followupSends, followupRecommendations } from "@/lib/db/schema";
import { and, inArray, sql } from "drizzle-orm";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// All pipelines with email design demo follow-ups
const FOLLOW_UP_PIPELINE_IDS = [
  "JRvrpfcwAlAOM38mPAUJ", // Email Design Demo Pipeline (AD FUNNEL)
  "uEefctNze07YOCaGOSNE", // Email Design Demo Pipeline (ORGANIC FUNNEL)
  "tZ2jrSx9nurGp08CWxWU", // Taylor's Tiktok Pipeline
  "B3eM3fhikGULYPkb0DmV", // Alice's Pipeline
];

// Urgency thresholds per zone (days since last contact)
const URGENCY_THRESHOLDS: Record<number, { overdue: number; due: number }> = {
  1: { overdue: 7, due: 3 },  // Demo Sent / Needs Time
  2: { overdue: 5, due: 2 },  // No-Show
  3: { overdue: 10, due: 5 }, // Sale In Progress (Active)
  4: { overdue: 10, due: 7 }, // Sale In Progress (Unresponsive)
};

function parseGHLDate(val: string | undefined | null): number {
  if (!val) return 0;
  const n = Number(val);
  if (!isNaN(n) && String(n) === val) return n;
  return new Date(val).getTime();
}

function getFirstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
}

/**
 * Determine which follow-up zone a stage belongs to.
 * Returns null if the stage should NOT appear in the follow-up queue.
 */
function determineZone(
  stageName: string,
  daysSinceLastContact: number
): 1 | 2 | 3 | 4 | null {
  const s = stageName.toLowerCase();

  // Zone 1: Demo sent — needs to book intro call
  if (s.includes("demo sent") || s.includes("completed demo")) return 1;

  // Zone 1: Needs time / re-engagement (they asked to be followed up later)
  if (s.includes("needs time") && s.includes("follow")) return 1;

  // Zone 2: No-show — needs to reschedule
  if (s.includes("no-show") || s.includes("no show")) return 2;

  // Zone 3/4: Sale in progress / proposal
  if (
    s.includes("sale in progress") ||
    s.includes("proposal sent") ||
    (s.includes("proposal") && !s.includes("booked"))
  ) {
    if (daysSinceLastContact >= 10 || s.includes("unresponsive")) return 4;
    return 3;
  }

  return null;
}

function getUrgency(
  zone: 1 | 2 | 3 | 4,
  daysSince: number
): "overdue" | "due" | "upcoming" {
  const t = URGENCY_THRESHOLDS[zone];
  if (daysSince >= t.overdue) return "overdue";
  if (daysSince >= t.due) return "due";
  return "upcoming";
}

interface EnrichedOpp extends GHLOpportunity {
  stageName: string;
  pipelineName: string;
}

export async function GET(_req: NextRequest) {
  try {
    const loc = locationId();
    const client = db();
    const nowMs = Date.now();

    // ── 1. Fetch all pipelines + build stage maps ──────────────────────────────
    const pipelinesData = await ghl.get<{ pipelines: GHLPipeline[] }>(
      `/opportunities/pipelines?locationId=${loc}`
    );

    // Map pipelineId → { stageName by stageId, pipelineName }
    const pipelineMeta = new Map<
      string,
      { name: string; stageMap: Record<string, string>; followUpStageIds: string[] }
    >();

    for (const p of pipelinesData.pipelines ?? []) {
      if (!FOLLOW_UP_PIPELINE_IDS.includes(p.id)) continue;

      const stageMap: Record<string, string> = {};
      const followUpStageIds: string[] = [];

      for (const s of p.stages ?? []) {
        stageMap[s.id] = s.name;

        // Pre-identify follow-up stages so we can query them directly
        // (pass daysSince=99 to catch all unresponsive variants)
        if (determineZone(s.name, 99) !== null) {
          followUpStageIds.push(s.id);
        }
      }

      pipelineMeta.set(p.id, { name: p.name, stageMap, followUpStageIds });
    }

    // ── 2. Fetch opportunities — only from follow-up stages per pipeline ───────
    // Query by stage ID directly (far more efficient than fetching all opps)
    const allOpps: EnrichedOpp[] = [];

    for (const [pipelineId, meta] of pipelineMeta.entries()) {
      if (meta.followUpStageIds.length === 0) continue;

      for (const stageId of meta.followUpStageIds) {
        let page = 1;
        while (true) {
          const res = await ghl.get<{
            opportunities: GHLOpportunity[];
            meta?: { nextPage: number | null };
          }>(
            `/opportunities/search?location_id=${loc}&pipeline_id=${pipelineId}&pipeline_stage_id=${stageId}&status=open&limit=100&page=${page}`
          );
          const batch = res.opportunities ?? [];

          for (const opp of batch) {
            allOpps.push({
              ...opp,
              stageName: meta.stageMap[opp.pipelineStageId] ?? "Unknown",
              pipelineName: meta.name,
            });
          }

          if (!res.meta?.nextPage || batch.length < 100) break;
          page++;
        }
      }
    }

    if (allOpps.length === 0) {
      return NextResponse.json({ groups: { needsAction: [], waiting: [] } });
    }

    // ── 3. Gather contact IDs for DB lookups ───────────────────────────────────
    const contactIds = [
      ...new Set(
        allOpps.map((o) => o.contact?.id).filter(Boolean) as string[]
      ),
    ];
    const oppIds = allOpps.map((o) => o.id);

    // ── 4. Load follow-up sends from DB ───────────────────────────────────────
    type SendRow = {
      ghlContactId: string;
      oppId: string | null;
      channel: string;
      sentAt: Date;
      angle: string | null;
      messageText: string;
      resultedInResponse: boolean;
    };

    const sendsRows: SendRow[] =
      contactIds.length > 0
        ? await client
            .select({
              ghlContactId: followupSends.ghlContactId,
              oppId: followupSends.oppId,
              channel: followupSends.channel,
              sentAt: followupSends.sentAt,
              angle: followupSends.angle,
              messageText: followupSends.messageText,
              resultedInResponse: followupSends.resultedInResponse,
            })
            .from(followupSends)
            .where(inArray(followupSends.ghlContactId, contactIds))
            .orderBy(sql`${followupSends.sentAt} DESC`)
        : [];

    const sendsMap = new Map<string, SendRow[]>();
    for (const row of sendsRows) {
      const existing = sendsMap.get(row.ghlContactId) ?? [];
      existing.push(row);
      sendsMap.set(row.ghlContactId, existing);
    }

    // ── 5. Load cached recommendations from DB ─────────────────────────────────
    type RecRow = {
      id: string;
      ghlContactId: string;
      oppId: string;
      type: string;
      reasoning: string;
      messagesJson: unknown;
      status: string;
      skippedUntil: Date | null;
    };

    const recRows: RecRow[] =
      oppIds.length > 0
        ? await client
            .select({
              id: followupRecommendations.id,
              ghlContactId: followupRecommendations.ghlContactId,
              oppId: followupRecommendations.oppId,
              type: followupRecommendations.type,
              reasoning: followupRecommendations.reasoning,
              messagesJson: followupRecommendations.messagesJson,
              status: followupRecommendations.status,
              skippedUntil: followupRecommendations.skippedUntil,
            })
            .from(followupRecommendations)
            .where(
              and(
                inArray(followupRecommendations.oppId, oppIds),
                inArray(followupRecommendations.status, ["pending", "skipped"])
              )
            )
        : [];

    const now = new Date();
    const recMap = new Map<string, RecRow>();
    for (const row of recRows) {
      if (
        row.status === "skipped" &&
        row.skippedUntil &&
        row.skippedUntil > now
      ) {
        continue;
      }
      recMap.set(row.oppId, row);
    }

    // ── 6. Build follow-up items ───────────────────────────────────────────────
    const needsAction: unknown[] = [];
    const waiting: unknown[] = [];

    for (const opp of allOpps) {
      const contactId = opp.contact?.id;
      if (!contactId) continue;

      const sends = sendsMap.get(contactId) ?? [];
      const lastSend = sends[0];
      const hasEverReplied = sends.some((s) => s.resultedInResponse);

      const lastContactMs = lastSend
        ? lastSend.sentAt.getTime()
        : parseGHLDate(opp.updatedAt) || parseGHLDate(opp.createdAt);
      const daysSinceLastContact = Math.floor(
        (nowMs - lastContactMs) / (1000 * 60 * 60 * 24)
      );

      const stageEnteredMs =
        parseGHLDate(opp.updatedAt) || parseGHLDate(opp.createdAt);
      const daysInStage = Math.floor(
        (nowMs - stageEnteredMs) / (1000 * 60 * 60 * 24)
      );

      const zone = determineZone(opp.stageName, daysSinceLastContact);
      if (zone === null) continue;

      // Skip contacts who replied recently — they're warm
      if (hasEverReplied && daysSinceLastContact < 7) continue;

      const urgency = getUrgency(zone, daysSinceLastContact);
      const rec = recMap.get(opp.id) ?? null;
      const channel = lastSend?.channel ?? "EMAIL";

      const item = {
        oppId: opp.id,
        contactId,
        contactName: opp.contact?.name ?? opp.name ?? "Unknown",
        firstName: getFirstName(opp.contact?.name ?? opp.name ?? "Unknown"),
        stageName: opp.stageName,
        pipelineName: opp.pipelineName,
        zone,
        daysInStage,
        daysSinceLastContact,
        totalFollowUpsSent: sends.length,
        hasEverReplied,
        urgency,
        channel,
        recommendation: rec
          ? {
              id: rec.id,
              type: rec.type,
              reasoning: rec.reasoning,
              messages: rec.messagesJson,
              status: rec.status,
            }
          : null,
      };

      if (urgency === "upcoming") {
        waiting.push(item);
      } else {
        needsAction.push(item);
      }
    }

    // Sort: overdue first, then by days since DESC
    (needsAction as Array<{ urgency: string; daysSinceLastContact: number }>).sort(
      (a, b) => {
        if (a.urgency === "overdue" && b.urgency !== "overdue") return -1;
        if (b.urgency === "overdue" && a.urgency !== "overdue") return 1;
        return b.daysSinceLastContact - a.daysSinceLastContact;
      }
    );

    console.log(
      `[GET /api/follow-ups] opps=${allOpps.length} needsAction=${needsAction.length} waiting=${waiting.length}`
    );

    return NextResponse.json({ groups: { needsAction, waiting } });
  } catch (err) {
    console.error("[GET /api/follow-ups]", err);
    return NextResponse.json(
      { groups: { needsAction: [], waiting: [] } },
      { status: 500 }
    );
  }
}
