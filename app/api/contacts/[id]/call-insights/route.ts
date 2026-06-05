import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { callInsights } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/contacts/[id]/call-insights
 *
 * Returns the most recent AI call insights for a contact.
 * Used by the outcome modal to pre-fill suggested outcome and notes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: contactId } = await params;
  const client = db();

  try {
    const [latest] = await client
      .select({
        suggestedOutcome: callInsights.suggestedOutcome,
        suggestedNotes: callInsights.suggestedNotes,
      })
      .from(callInsights)
      .where(eq(callInsights.contactId, contactId))
      .orderBy(desc(callInsights.analyzedAt))
      .limit(1);

    return NextResponse.json({ insights: latest ?? null });
  } catch (err) {
    console.error(`[GET /api/contacts/${contactId}/call-insights]`, err);
    return NextResponse.json({ error: "Failed to fetch insights" }, { status: 500 });
  }
}
