/**
 * POST /api/follow-ups/[contactId]/send
 *
 * Sends a follow-up message via GHL and records it in the DB.
 */

import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { followupSends, followupRecommendations } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { GHLConversation } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

function channelToGHLType(channel: string): string {
  // GHL send API type strings. SMS routes through Blooio Custom channel.
  const map: Record<string, string> = {
    SMS: "Custom",
    EMAIL: "Email",
    INSTAGRAM: "IG",
    FACEBOOK: "FB",
  };
  return map[channel.toUpperCase()] ?? "Email";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;

  const body = await req.json();
  const {
    oppId,
    messageText,
    channel = "EMAIL",
    angle,
    subject,
    stageName,
    recommendationId,
    conversationId: providedConversationId,
  }: {
    oppId: string;
    messageText: string;
    channel?: string;
    angle?: string;
    subject?: string;
    stageName?: string;
    recommendationId?: string;
    conversationId?: string;
  } = body;

  if (!oppId || !messageText?.trim()) {
    return NextResponse.json(
      { error: "oppId and messageText are required" },
      { status: 400 }
    );
  }

  try {
    const loc = locationId();
    const client = db();

    // ── 1. Resolve conversation ID ─────────────────────────────────────────────
    let conversationId = providedConversationId;

    if (!conversationId) {
      const convData = await ghl.get<{ conversations: GHLConversation[] }>(
        `/conversations/search?contactId=${contactId}&location_id=${loc}&limit=1`
      );
      conversationId = convData.conversations?.[0]?.id;
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: "Could not find a GHL conversation for this contact" },
        { status: 404 }
      );
    }

    // ── 2. Send via GHL ────────────────────────────────────────────────────────
    const ghlPayload: Record<string, unknown> = {
      type: channelToGHLType(channel),
      conversationId,
      contactId,
      message: messageText.trim(),
    };

    // Email requires subject
    if (channel.toUpperCase() === "EMAIL" && subject) {
      ghlPayload.subject = subject;
    }

    const sendResult = await ghl.post<{ messageId?: string; id?: string }>(
      "/conversations/messages",
      ghlPayload
    );

    const ghlMessageId = sendResult.messageId ?? sendResult.id ?? null;

    // ── 3. Record to DB ────────────────────────────────────────────────────────
    await client.insert(followupSends).values({
      ghlContactId: contactId,
      oppId,
      ghlMessageId,
      messageText: messageText.trim(),
      channel: channel.toUpperCase(),
      stageName: stageName ?? null,
      angle: angle ?? null,
      sentAtActual: new Date(),
    });

    // ── 4. Mark recommendation as approved ────────────────────────────────────
    if (recommendationId) {
      await client
        .update(followupRecommendations)
        .set({ status: "approved", actedOnAt: new Date() })
        .where(
          and(
            eq(followupRecommendations.id, recommendationId),
            eq(followupRecommendations.ghlContactId, contactId)
          )
        );
    } else {
      // Mark any pending rec for this opp as approved
      await client
        .update(followupRecommendations)
        .set({ status: "approved", actedOnAt: new Date() })
        .where(
          and(
            eq(followupRecommendations.oppId, oppId),
            eq(followupRecommendations.status, "pending")
          )
        );
    }

    console.log(
      `[follow-ups/send] Sent to contact=${contactId} opp=${oppId} channel=${channel} angle=${angle}`
    );

    return NextResponse.json({ success: true, ghlMessageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/follow-ups/[contactId]/send]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
