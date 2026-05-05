/**
 * POST /api/follow-ups/[contactId]/remove
 * Body: { oppId: string }
 *
 * Permanently dismisses a contact from the follow-up queue
 * (until they move to a new pipeline stage).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { followupRecommendations } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;
  const { oppId } = await req.json();

  if (!oppId) {
    return NextResponse.json({ error: "oppId is required" }, { status: 400 });
  }

  try {
    const client = db();

    // Mark existing recommendation as dismissed
    await client
      .update(followupRecommendations)
      .set({ status: "dismissed", actedOnAt: new Date() })
      .where(
        and(
          eq(followupRecommendations.oppId, oppId),
          eq(followupRecommendations.ghlContactId, contactId)
        )
      );

    // If no recommendation existed yet, insert a dismissed placeholder
    // so this opp doesn't reappear on the next load
    const existing = await client
      .select({ id: followupRecommendations.id })
      .from(followupRecommendations)
      .where(eq(followupRecommendations.oppId, oppId))
      .limit(1);

    if (existing.length === 0) {
      await client.insert(followupRecommendations).values({
        ghlContactId: contactId,
        oppId,
        stageName: "dismissed",
        type: "wait",
        reasoning: "Manually dismissed from queue",
        messagesJson: [],
        status: "dismissed",
        actedOnAt: new Date(),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/follow-ups/[contactId]/remove]", err);
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }
}
