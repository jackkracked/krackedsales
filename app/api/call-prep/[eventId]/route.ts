import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getCachedCallPrep } from "@/lib/call-prep";

export const dynamic = "force-dynamic";

/**
 * GET /api/call-prep/[eventId]
 * Returns cached call prep for a calendar event, or null if not generated yet.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;

  const prep = await getCachedCallPrep(eventId);

  if (!prep) {
    return NextResponse.json({ prep: null });
  }

  return NextResponse.json({ prep });
}
