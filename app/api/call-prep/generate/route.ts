import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { orchestrateCallPrep } from "@/lib/call-prep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/call-prep/generate
 * Triggers call prep generation for a calendar event.
 * Body: { calendarEventId, contactId, contactName? }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { calendarEventId, contactId, contactName } = body;

  if (!calendarEventId || !contactId) {
    return NextResponse.json(
      { error: "calendarEventId and contactId are required" },
      { status: 400 }
    );
  }

  try {
    const prep = await orchestrateCallPrep({
      calendarEventId,
      contactId,
      contactName,
    });

    return NextResponse.json({ prep });
  } catch (err) {
    console.error("[call-prep/generate] Failed:", err);
    return NextResponse.json(
      { error: "Call prep generation failed" },
      { status: 500 }
    );
  }
}
