/**
 * GET /api/follow-ups/[contactId]/context?oppId=xxx
 *
 * Returns the full workspace context for a follow-up contact:
 * - GHL conversation ID + channel
 * - Message history (our sends from DB + recent GHL messages)
 * - Active recommendation (from DB, or freshly generated if none exists)
 */

import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { followupSends, followupRecommendations } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import type { GHLConversation, GHLMessage } from "@/lib/ghl/types";
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

function channelFromConvType(type: string): string {
  const t = type.toUpperCase();
  if (t.includes("SMS")) return "SMS";
  if (t.includes("EMAIL")) return "EMAIL";
  if (t.includes("INSTAGRAM")) return "INSTAGRAM";
  if (t.includes("FB") || t.includes("FACEBOOK")) return "FACEBOOK";
  return "EMAIL";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;
  const oppId = req.nextUrl.searchParams.get("oppId");
  const stageName = req.nextUrl.searchParams.get("stageName") ?? "Unknown";
  const daysSince = parseInt(req.nextUrl.searchParams.get("daysSince") ?? "0");

  if (!oppId) {
    return NextResponse.json({ error: "oppId is required" }, { status: 400 });
  }

  try {
    const loc = locationId();
    const client = db();

    // ── 1. Fetch GHL conversation for this contact ──────────────────────────────
    let conversationId: string | null = null;
    let channel = "EMAIL";

    try {
      const convData = await ghl.get<{ conversations: GHLConversation[] }>(
        `/conversations/search?contactId=${contactId}&location_id=${loc}&limit=1`
      );
      const conv = convData.conversations?.[0];
      if (conv) {
        conversationId = conv.id;
        channel = channelFromConvType(conv.type ?? "");
      }
    } catch (e) {
      console.warn("[follow-ups/context] conversation fetch failed:", e);
    }

    // ── 2. Load recent GHL messages (last 5) ───────────────────────────────────
    interface RawMsgEnvelope {
      messages?: { messages?: GHLMessage[] };
    }
    let recentGHLMessages: GHLMessage[] = [];
    if (conversationId) {
      try {
        const msgData = await ghl.get<RawMsgEnvelope>(
          `/conversations/${conversationId}/messages?limit=20`
        );
        const msgs = msgData.messages?.messages ?? [];
        // Filter out GHL system activity messages, keep real messages.
        // NOTE: automated/workflow emails often have an empty body but do have a subject —
        // we keep them as long as they are not pure activity entries.
        recentGHLMessages = msgs
          .filter(
            (m) =>
              !m.messageType?.startsWith("TYPE_ACTIVITY") &&
              // Keep if there's a body OR an email subject (workflow emails have subject only)
              (m.body?.trim() || m.meta?.email?.subject?.trim())
          )
          .slice(0, 15);
      } catch (e) {
        console.warn("[follow-ups/context] messages fetch failed:", e);
      }
    }

    // ── 3. Load our send history from DB ───────────────────────────────────────
    const sendHistory = await client
      .select({
        id: followupSends.id,
        messageText: followupSends.messageText,
        channel: followupSends.channel,
        angle: followupSends.angle,
        sentAt: followupSends.sentAt,
        resultedInResponse: followupSends.resultedInResponse,
      })
      .from(followupSends)
      .where(eq(followupSends.ghlContactId, contactId))
      .orderBy(desc(followupSends.sentAt))
      .limit(10);

    const nowMs = Date.now();
    const hasEverReplied = sendHistory.some((s) => s.resultedInResponse);
    const lastReply = recentGHLMessages.find((m) => m.direction === "inbound");

    // ── 4. Load or generate AI recommendation ─────────────────────────────────
    const existingRec = await client
      .select()
      .from(followupRecommendations)
      .where(
        and(
          eq(followupRecommendations.oppId, oppId),
          eq(followupRecommendations.status, "pending")
        )
      )
      .limit(1);

    let recommendation = existingRec[0] ?? null;

    if (!recommendation) {
      // Generate fresh recommendation
      const ctx = {
        contact: {
          name: req.nextUrl.searchParams.get("contactName") ?? "there",
          firstName: (req.nextUrl.searchParams.get("contactName") ?? "there").split(" ")[0],
          website: req.nextUrl.searchParams.get("website") ?? null,
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
          lastReplyText: lastReply?.body ?? null,
          // Sends tracked by this system
          messagesSent: sendHistory.slice(0, 5).map((s) => ({
            daysAgo: Math.floor((nowMs - s.sentAt.getTime()) / (1000 * 60 * 60 * 24)),
            angle: s.angle,
            preview: s.messageText.slice(0, 80),
          })),
          // Previous emails sent via GHL (automated sequences etc.) — subject lines only
          previousGHLEmails: recentGHLMessages
            .filter((m) => m.direction !== "inbound")
            .slice(0, 8)
            .map((m) => ({
              daysAgo: Math.floor((nowMs - new Date(m.dateAdded).getTime()) / (1000 * 60 * 60 * 24)),
              subject: m.meta?.email?.subject ?? null,
              preview: m.body?.trim()?.slice(0, 80) ?? null,
            })),
        },
      };

      try {
        const aiRec = await generateFollowUpRecommendation(ctx);

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

        recommendation = inserted;
      } catch (e) {
        console.error("[follow-ups/context] AI generation failed:", e);
      }
    }

    // ── 5. Build message history for display ───────────────────────────────────
    // Collect contact IDs of DB sends so we can de-dupe against GHL history
    const dbSendPreviews = new Set(
      sendHistory.slice(0, 5).map((s) => s.messageText.slice(0, 60))
    );

    const messageHistory = [
      // Our DB sends (outbound, tracked by this system)
      ...sendHistory.slice(0, 5).map((s) => ({
        source: "db" as const,
        direction: "outbound" as const,
        daysAgo: Math.floor((nowMs - s.sentAt.getTime()) / (1000 * 60 * 60 * 24)),
        preview: s.messageText.slice(0, 120),
        angle: s.angle,
        channel: s.channel,
      })),
      // All GHL messages (both inbound replies and outbound messages not tracked by DB)
      ...recentGHLMessages
        .filter((m) => {
          // Skip GHL outbound messages that we already have in DB sends (avoid duplicates)
          if (m.direction === "outbound") {
            const preview = (m.body ?? "").slice(0, 60);
            return !dbSendPreviews.has(preview);
          }
          return true;
        })
        .slice(0, 10)
        .map((m) => {
          // For automated emails the body is often empty — fall back to the subject line
          const emailSubject = m.meta?.email?.subject;
          const rawBody = m.body?.trim();
          const preview = rawBody
            ? rawBody.slice(0, 120)
            : emailSubject
              ? `[Email] ${emailSubject}`
              : "(no preview)";

          return {
            source: "ghl" as const,
            direction: (m.direction === "inbound" ? "inbound" : "outbound") as "inbound" | "outbound",
            daysAgo: Math.floor(
              (nowMs - new Date(m.dateAdded).getTime()) / (1000 * 60 * 60 * 24)
            ),
            preview,
            angle: null,
            channel,
          };
        }),
    ].sort((a, b) => b.daysAgo - a.daysAgo); // most recent last (chronological)

    return NextResponse.json({
      conversationId,
      channel,
      hasEverReplied,
      messageHistory,
      recommendation: recommendation
        ? {
            id: recommendation.id,
            type: recommendation.type,
            reasoning: recommendation.reasoning,
            messages: recommendation.messagesJson,
            status: recommendation.status,
          }
        : null,
    });
  } catch (err) {
    console.error("[GET /api/follow-ups/[contactId]/context]", err);
    return NextResponse.json(
      { conversationId: null, channel: "EMAIL", hasEverReplied: false, messageHistory: [], recommendation: null },
      { status: 500 }
    );
  }
}
