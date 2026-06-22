import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";
import { getBoardByToken } from "@/lib/demo-boards/queries";
import { resolveBoardCalendar } from "@/lib/demo-boards/booking-routing";

export const dynamic = "force-dynamic";

/**
 * GET /api/boards/public/[token]/slots?tz=America/Chicago
 * Free slots for the board's routed rep over the next two weeks, grouped by day.
 * Public (the prospect calls it from the booking panel). Returns an empty list —
 * never an error page — when no calendar is wired, so the UI degrades gracefully.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const tz = req.nextUrl.searchParams.get("tz") || "America/Chicago";

    const board = await getBoardByToken(token);
    if (!board) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const cal = await resolveBoardCalendar(board.id);
    if (!cal) return NextResponse.json({ days: [], rep: null, configured: false });

    // Two-week window starting tomorrow.
    const now = Date.now();
    const startDate = now + 12 * 60 * 60 * 1000;
    const endDate = now + 14 * 24 * 60 * 60 * 1000;

    let raw: Record<string, unknown> = {};
    try {
      raw = await ghl.get<Record<string, unknown>>(
        `/calendars/${cal.ghlCalendarId}/free-slots?startDate=${startDate}&endDate=${endDate}&timezone=${encodeURIComponent(tz)}`,
      );
    } catch (err) {
      console.error("[boards slots] GHL free-slots failed", err);
      return NextResponse.json({ days: [], rep: cal.repName, configured: true, unavailable: true });
    }

    // GHL keys the response by date ("2026-06-15": { slots: [...] }); skip meta keys.
    const days: { date: string; slots: string[] }[] = [];
    for (const [key, val] of Object.entries(raw)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const slots = (val as { slots?: string[] })?.slots;
      if (Array.isArray(slots) && slots.length) days.push({ date: key, slots });
    }
    days.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ days, rep: cal.repName, color: cal.color, configured: true });
  } catch (err) {
    console.error("[GET /api/boards/public/[token]/slots]", err);
    return NextResponse.json({ days: [], configured: false });
  }
}
