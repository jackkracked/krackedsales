/**
 * POST /api/follow-ups/[contactId]/regenerate
 * Body: { oppId, stageName, daysSince, contactName, website, channel, hint? }
 *
 * Marks the current recommendation as replaced and generates a fresh one.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { followupSends, followupRecommendations } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { generateFollowUpRecommendation } from "@/lib/ai/followup-engine";
import type { FollowUpZone } from "@/lib/ai/followup-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function determineZone(stageName: string, daysSince: number): FollowUpZone {
  const s = stageName.toLowerCase();
  if (s.includes("demo sent") || s.includes("completed demo")) return 1;
  if (s.includes("no-show") || s.includes("no show")) return 2;
  if (s.includes("sale in progress") || s.includes("proposal")) {
    return daysSince >= 10 || s.includes("unresponsive") ? 4 : 3;
  }
  return 1;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;

  const {
    oppId,
    stageName = "Unknown",
    daysSince = 0,
    contactName = "there",
    website = null,
    channel = "EMAIL",
    hint,
  }: {
    oppId: string;
    stageName?: string;
    daysSince?: number;
    contactName?: string;
    website?: string | null;
    channel?: string;
    hint?: string;
  } = await req.json();

  if (!oppId) {
    return NextResponse.json({ error: "oppId is required" }, { status: 400 });
  }

  try {
    const client = db();
    const nowMs = Date.now();

    // ── 1. Mark current recommendation as replaced ─────────────────────────────
    await client
      .update(followupRecommendations)
      .set({ status: "replaced", actedOnAt: new Date() })
      .where(
        and(
          eq(followupRecommendations.oppId, oppId),
          eq(followupRecommendations.status, "pending")
        )
      );

    // ── 2. Load send history for context ──────────────────────────────────────
    const sendHistory = await client
      .select({
        messageText: followupSends.messageText,
        angle: followupSends.angle,
        sentAt: followupSends.sentAt,
        resultedInResponse: followupSends.resultedInResponse,
      })
      .from(followupSends)
      .where(eq(followupSends.ghlContactId, contactId))
      .orderBy(desc(followupSends.sentAt))
      .limit(10);

    const hasEverReplied = sendHistory.some((s) => s.resultedInResponse);

    // ── 3. Generate new recommendation ────────────────────────────────────────
    const ctx = {
      contact: {
        name: contactName,
        firstName: contactName.split(" ")[0],
        website,
        channel,
      },
      pipeline: {
        currentStage: stageName,
        zone: determineZone(stageName, daysSince),
        daysInStage: daysSince,
        daysSinceLastContact: daysSince,
        totalFollowUpsSent: sendHistory.length,
      },
      history: {
        hasEverReplied,
        lastReplyText: null,
        messagesSent: sendHistory.slice(0, 5).map((s) => ({
          daysAgo: Math.floor(
            (nowMs - s.sentAt.getTime()) / (1000 * 60 * 60 * 24)
          ),
          angle: s.angle,
          preview: s.messageText.slice(0, 80),
        })),
      },
      notes: hint
        ? `User requested a different angle: ${hint}`
        : "User requested a fresh recommendation — try a different approach than previous messages",
    };

    const aiRec = await generateFollowUpRecommendation(ctx);

    // ── 4. Insert new recommendation ──────────────────────────────────────────
    const [inserted] = await client
      .insert(followupRecommendations)
      .values({
        ghlContactId: contactId,
        oppId,
        stageName,
        type: aiRec.type,
        reasoning: aiRec.reasoning,
        messagesJson: aiRec.messages,
        status: "pending",
      })
      .returning();

    return NextResponse.json({
      recommendation: {
        id: inserted.id,
        type: inserted.type,
        reasoning: inserted.reasoning,
        messages: inserted.messagesJson,
        status: inserted.status,
      },
    });
  } catch (err) {
    console.error("[POST /api/follow-ups/[contactId]/regenerate]", err);
    return NextResponse.json(
      { error: "Failed to regenerate recommendation" },
      { status: 500 }
    );
  }
}
