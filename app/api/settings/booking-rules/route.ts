import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookingAutomationRules } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db()
      .select()
      .from(bookingAutomationRules)
      .orderBy(asc(bookingAutomationRules.calendarName));

    return NextResponse.json({ bookingRules: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[settings/booking-rules] GET failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: {
    ghlCalendarId: string;
    calendarName: string;
    trigger: string;
    pipelineId: string;
    stageId: string;
    stageName: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { ghlCalendarId, calendarName, trigger, pipelineId, stageId, stageName } = body;

  if (!ghlCalendarId || !calendarName || !trigger || !pipelineId || !stageId || !stageName) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: ghlCalendarId, calendarName, trigger, pipelineId, stageId, stageName",
      },
      { status: 400 }
    );
  }

  try {
    const [created] = await db()
      .insert(bookingAutomationRules)
      .values({ ghlCalendarId, calendarName, trigger, pipelineId, stageId, stageName })
      .returning();

    return NextResponse.json({ bookingRule: created }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[settings/booking-rules] POST failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
