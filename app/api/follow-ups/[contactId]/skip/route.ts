/**
 * POST /api/follow-ups/[contactId]/skip
 * Body: { oppId: string }
 *
 * Hides this contact from the NEEDS ACTION list for 24 hours.
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
    const skippedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await client
      .update(followupRecommendations)
      .set({ status: "skipped", skippedUntil })
      .where(
        and(
          eq(followupRecommendations.oppId, oppId),
          eq(followupRecommendations.ghlContactId, contactId)
        )
      );

    return NextResponse.json({ success: true, skippedUntil });
  } catch (err) {
    console.error("[POST /api/follow-ups/[contactId]/skip]", err);
    return NextResponse.json({ error: "Failed to skip" }, { status: 500 });
  }
}
