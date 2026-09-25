import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { callSettings } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { ghl, locationId } from "@/lib/ghl/client";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * The calendars a rep may send a booking link for.
 *
 * ORDERED BY REAL USE, NOT FILTERED. Jack, 2026-09-22: "they should be able to pick a
 * calendar" — so every active calendar stays available. But this location has 16 of them,
 * including "Test Calender", someone's personal calendar, two copies of Taylor's and one
 * named "Email Design Demo | Intro Call old". An alphabetical list buries the two that
 * matter, and picking the wrong one sends a prospect to a dead calendar.
 *
 * So they are ranked by how often calls were actually booked on them in the last 90 days,
 * read from our own `calls` table: Email Design Demo Intro Call (98) and Kracked Retention
 * Intro Call (68) rise to the top, the unused ones sink. Free — no extra GoHighLevel calls.
 *
 * `call_settings.allowed_calendar_ids` still narrows the list when an admin sets it, so the
 * option to lock it down later exists without a second competing setting.
 */
export async function GET() {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [settings] = await db().select().from(callSettings).limit(1);
    const allowed = (settings?.allowedCalendarIds as string[] | null) ?? [];

    const res = await ghl.get<{ calendars?: Array<{ id: string; name: string; isActive?: boolean }> }>(
      `/calendars/?locationId=${locationId()}`,
    );
    const active = (res.calendars ?? []).filter((c) => c.isActive !== false);

    // An admin allow-list narrows it; otherwise every active calendar is offered.
    const offered = allowed.length ? active.filter((c) => allowed.includes(c.id)) : active;

    // How often each was actually booked recently. Our own data, so this costs nothing.
    const usage = await db().execute<{ calendar_id: string; n: number }>(sql`
      SELECT calendar_id, count(*)::int AS n
        FROM calls
       WHERE calendar_id IS NOT NULL AND started_at > now() - interval '90 days'
       GROUP BY calendar_id
    `).catch(() => ({ rows: [] as Array<{ calendar_id: string; n: number }> }));
    const rank = new Map((usage.rows ?? []).map((r) => [r.calendar_id, Number(r.n)]));

    const calendars = [...offered]
      .sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0) || a.name.localeCompare(b.name))
      .map((c) => ({ id: c.id, name: c.name, recentBookings: rank.get(c.id) ?? 0 }));

    return NextResponse.json({ calendars });
  } catch (err) {
    console.error("[GET /api/booking-links/calendars]", err);
    return NextResponse.json({ error: "Could not load calendars" }, { status: 500 });
  }
}
