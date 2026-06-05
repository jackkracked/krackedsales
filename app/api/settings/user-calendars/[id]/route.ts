import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userCalendars } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: {
    repName?: string;
    repEmail?: string;
    ghlCalendarId?: string;
    color?: string;
    isActive?: boolean;
    conflictCalendarId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { repName, repEmail, ghlCalendarId, color, isActive, conflictCalendarId } = body;

  // Build only the fields that were provided
  const updates: Partial<typeof userCalendars.$inferInsert> = {};
  if (repName !== undefined) updates.repName = repName;
  if (repEmail !== undefined) updates.repEmail = repEmail;
  if (ghlCalendarId !== undefined) updates.ghlCalendarId = ghlCalendarId;
  if (color !== undefined) updates.color = color;
  if (isActive !== undefined) updates.isActive = isActive;
  if (conflictCalendarId !== undefined) updates.conflictCalendarId = conflictCalendarId;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
  }

  try {
    const [updated] = await db()
      .update(userCalendars)
      .set(updates)
      .where(eq(userCalendars.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "User calendar not found" }, { status: 404 });
    }

    return NextResponse.json({ userCalendar: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[settings/user-calendars/[id]] PUT failed:", message);
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
      .delete(userCalendars)
      .where(eq(userCalendars.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "User calendar not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[settings/user-calendars/[id]] DELETE failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
