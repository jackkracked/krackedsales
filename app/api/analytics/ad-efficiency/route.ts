import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { loadAdEfficiency } from "@/lib/analytics/ad-efficiency";

export const dynamic = "force-dynamic";

/**
 * Cohort ad efficiency by source, monthly, over a date range. Admin-only (money data).
 * Query: ?start=YYYY-MM-DD&end=YYYY-MM-DD (end exclusive). Defaults to the last 6 months.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const startParam = sp.get("start");
  const endParam = sp.get("end");

  let start: Date;
  let end: Date;
  if (startParam && endParam) {
    start = new Date(startParam + "T00:00:00.000Z");
    end = new Date(endParam + "T00:00:00.000Z");
  } else {
    const now = new Date();
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  }
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  try {
    const data = await loadAdEfficiency(start, end);
    return NextResponse.json(data);
  } catch (e) {
    console.error("[GET /api/analytics/ad-efficiency]", e);
    return NextResponse.json({ error: "Failed to load ad efficiency" }, { status: 500 });
  }
}
