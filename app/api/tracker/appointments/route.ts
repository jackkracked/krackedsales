import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ghlAppointments } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracker/appointments?contactId=<ghl contact id>
 *
 * The booked-call appointments on one contact, for "Add a booking". Picking the real appointment
 * (instead of typing a date) is what lets a cancellation or a no-show follow the row, so the add
 * flow always offers these first. Returns times and calendars only: no pay data.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin" && !(await can(user.id, user.role, "view_tracker"))) {
    return NextResponse.json({ error: "The pay tracker is not switched on for you yet" }, { status: 403 });
  }
  const contactId = req.nextUrl.searchParams.get("contactId");
  if (!contactId || contactId.length > 64) return NextResponse.json({ error: "contactId is required" }, { status: 400 });

  const rows = await db()
    .select({
      id: ghlAppointments.id, calendarName: ghlAppointments.calendarName, startTime: ghlAppointments.startTime,
      dateAdded: ghlAppointments.dateAdded, status: ghlAppointments.status, deletedAt: ghlAppointments.deletedAt,
    })
    .from(ghlAppointments)
    .where(and(eq(ghlAppointments.contactId, contactId)))
    .orderBy(asc(ghlAppointments.startTime));
  return NextResponse.json({
    appointments: rows.map((r) => ({
      id: r.id, calendarName: r.calendarName, startTime: r.startTime, dateAdded: r.dateAdded,
      status: r.deletedAt ? "deleted" : r.status,
    })),
  });
}
