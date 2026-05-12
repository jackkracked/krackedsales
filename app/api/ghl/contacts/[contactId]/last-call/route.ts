import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls, callInsights } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/ghl/contacts/[contactId]/last-call
 *
 * Returns the most recent call for a contact that has either transcriptText
 * or AI insights. Used by the opportunity modal "Last Call" section.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { contactId } = await params;
  const client = db();

  try {
    // Most recent call for this contact that has a transcript
    const [call] = await client
      .select()
      .from(calls)
      .where(
        and(
          eq(calls.contactId, contactId),
          isNotNull(calls.transcriptText)
        )
      )
      .orderBy(desc(calls.startedAt))
      .limit(1);

    if (!call) {
      // Fall back to any call, even without transcript
      const [anyCall] = await client
        .select()
        .from(calls)
        .where(eq(calls.contactId, contactId))
        .orderBy(desc(calls.startedAt))
        .limit(1);

      return NextResponse.json({ call: anyCall ?? null, insights: null });
    }

    // Fetch insights if they exist
    const [insights] = await client
      .select()
      .from(callInsights)
      .where(eq(callInsights.callId, call.id))
      .limit(1);

    return NextResponse.json({ call, insights: insights ?? null });
  } catch (err) {
    console.error(`[GET /api/ghl/contacts/${contactId}/last-call]`, err);
    return NextResponse.json({ error: "Failed to fetch last call" }, { status: 500 });
  }
}
