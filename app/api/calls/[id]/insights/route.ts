import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls, callInsights } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { generateAndStoreInsights } from "@/lib/ai/call-insights";

export const dynamic = "force-dynamic";

/**
 * GET /api/calls/[id]/insights
 *
 * Returns AI-extracted insights for a call.
 * If insights don't exist yet but the call has transcriptText stored,
 * generates them on-demand and returns the result.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const client = db();

  try {
    // Check for existing insights
    const [existing] = await client
      .select()
      .from(callInsights)
      .where(eq(callInsights.callId, id))
      .limit(1);

    if (existing) return NextResponse.json({ insights: existing });

    // No insights yet — check if we have transcript text to generate from
    const [call] = await client
      .select()
      .from(calls)
      .where(eq(calls.id, id))
      .limit(1);

    if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    if (!call.transcriptText) return NextResponse.json({ insights: null });

    const insights = await generateAndStoreInsights(id, call.contactId, call.transcriptText);
    return NextResponse.json({ insights });
  } catch (err) {
    console.error(`[GET /api/calls/${id}/insights]`, err);
    return NextResponse.json({ error: "Failed to fetch insights" }, { status: 500 });
  }
}
