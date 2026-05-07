import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookingAutomationRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: {
    ghlCalendarId?: string;
    calendarName?: string;
    trigger?: string;
    pipelineId?: string;
    stageId?: string;
    stageName?: string;
    isActive?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { ghlCalendarId, calendarName, trigger, pipelineId, stageId, stageName, isActive } = body;

  // Build only the fields that were provided
  const updates: Partial<typeof bookingAutomationRules.$inferInsert> = {};
  if (ghlCalendarId !== undefined) updates.ghlCalendarId = ghlCalendarId;
  if (calendarName !== undefined) updates.calendarName = calendarName;
  if (trigger !== undefined) updates.trigger = trigger;
  if (pipelineId !== undefined) updates.pipelineId = pipelineId;
  if (stageId !== undefined) updates.stageId = stageId;
  if (stageName !== undefined) updates.stageName = stageName;
  if (isActive !== undefined) updates.isActive = isActive;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
  }

  try {
    const [updated] = await db()
      .update(bookingAutomationRules)
      .set(updates)
      .where(eq(bookingAutomationRules.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Booking rule not found" }, { status: 404 });
    }

    return NextResponse.json({ bookingRule: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[settings/booking-rules/[id]] PUT failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [deleted] = await db()
      .delete(bookingAutomationRules)
      .where(eq(bookingAutomationRules.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Booking rule not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[settings/booking-rules/[id]] DELETE failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
