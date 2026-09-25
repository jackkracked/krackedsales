import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { ghl } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

/**
 * Real open slots on a calendar, for booking a prospect in while you have them on the phone.
 *
 * WHY DIRECT BOOKING EXISTS ALONGSIDE THE LINK
 * Jack, 2026-09-22, thinking it through: "getting them to book actually helps conversion,
 * doesn't it?" — true when you are NOT talking to them. In a DM, negotiating a time takes six
 * messages and dies, and a slot they picked themselves shows up better. But on a live call,
 * "I'll send you a link" converts a warm human into a cold task in their inbox. Kelsey is
 * predominantly outbound calls, so that is her main moment. Two paths for two moments.
 *
 * It also makes attribution exact rather than inferred: an appointment we created is
 * unambiguously the work of the person who created it.
 *
 * This is a live read — availability changes by the minute and a stale slot means a double
 * booking — so it is NOT cached beyond the short window below. One calendar, one week: a
 * single GoHighLevel call per open of the picker.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.isActive) return NextResponse.json({ error: "Account is deactivated" }, { status: 403 });

  const calendarId = req.nextUrl.searchParams.get("calendarId");
  if (!calendarId) return NextResponse.json({ error: "calendarId is required" }, { status: 400 });

  // The rep's own timezone, so the times on screen are the times they will say out loud.
  const timezone = req.nextUrl.searchParams.get("timezone") || user.timezone || "UTC";
  const daysAhead = Math.min(Number(req.nextUrl.searchParams.get("days") ?? 14), 30);

  try {
    const start = Date.now();
    const end = start + daysAhead * 86_400_000;
    const raw = await ghl.get<Record<string, unknown>>(
      `/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}&timezone=${encodeURIComponent(timezone)}`,
    );

    // GHL returns an object keyed by date, plus some non-date metadata keys alongside.
    const days = Object.entries(raw)
      .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k))
      .map(([date, value]) => ({
        date,
        slots: ((value as { slots?: string[] })?.slots ?? []).filter(Boolean),
      }))
      .filter((d) => d.slots.length > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ days, timezone });
  } catch (err) {
    console.error("[GET /api/booking-links/slots]", err);
    return NextResponse.json({ error: "Could not read availability" }, { status: 502 });
  }
}
