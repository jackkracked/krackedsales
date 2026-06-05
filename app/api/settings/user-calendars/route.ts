import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userCalendars } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db()
      .select()
      .from(userCalendars)
      .orderBy(asc(userCalendars.repName));

    return NextResponse.json({ userCalendars: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[settings/user-calendars] GET failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: {
    repName: string;
    repEmail: string;
    ghlCalendarId?: string;
    color?: string;
    conflictCalendarId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { repName, repEmail, ghlCalendarId, color, conflictCalendarId } = body;

  if (!repName || !repEmail) {
    return NextResponse.json(
      { error: "Missing required fields: repName, repEmail" },
      { status: 400 }
    );
  }

  try {
    const [created] = await db()
      .insert(userCalendars)
      .values({
        repName,
        repEmail,
        ...(ghlCalendarId ? { ghlCalendarId } : {}),
        ...(color ? { color } : {}),
        conflictCalendarId: conflictCalendarId || "primary",
      })
      .returning();

    return NextResponse.json({ userCalendar: created }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[settings/user-calendars] POST failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
