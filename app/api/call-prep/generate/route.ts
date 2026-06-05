import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { orchestrateCallPrep } from "@/lib/call-prep";

export const dynamic = "force-dynamic";
// Deep research (multi-page fetch + grounded Gemini 2.5 Pro + structuring call)
// runs ~20-40s; 60s would kill it mid-flight. 300s is available on this plan.
export const maxDuration = 300;

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
  const { calendarEventId, contactId, contactName, force } = body;

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
      force: force === true,
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
