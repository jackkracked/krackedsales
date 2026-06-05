import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { calendarClient, isGoogleConfigured } from "@/lib/google/client";
import { db } from "@/lib/db";
import { userCalendars } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** GET /api/calendar/conflicts — Google Calendar busy blocks for conflict detection */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const repEmail = searchParams.get("repEmail");
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  if (!repEmail || !since || !until) {
    return NextResponse.json(
      { error: "Missing required query params: repEmail, since, until" },
      { status: 400 }
    );
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json({ busyBlocks: [] });
  }

  // Look up the rep's conflict calendar ID (default "primary")
  let conflictCalendarId = "primary";
  try {
    const [repCal] = await db()
      .select({ conflictCalendarId: userCalendars.conflictCalendarId })
      .from(userCalendars)
      .where(eq(userCalendars.repEmail, repEmail))
      .limit(1);

    if (repCal?.conflictCalendarId) {
      conflictCalendarId = repCal.conflictCalendarId;
    }
  } catch (err) {
    console.error("[conflicts] Failed to look up conflict calendar:", err);
    // Fall through with "primary"
  }

  try {
    const cal = await calendarClient(repEmail);
    const res = await cal.freebusy.query({
      requestBody: {
        timeMin: since,
        timeMax: until,
        items: [{ id: conflictCalendarId }],
      },
    });

    const busy = res.data.calendars?.[conflictCalendarId]?.busy ?? [];
    const busyBlocks = busy.map((b) => ({
      start: b.start ?? "",
      end: b.end ?? "",
    }));

    return NextResponse.json({ busyBlocks });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[conflicts] Failed to fetch freebusy for ${repEmail}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
