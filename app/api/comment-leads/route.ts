import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { commentLeads } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { subDays, startOfDay, startOfWeek, startOfMonth, startOfQuarter } from "date-fns";

export const dynamic = "force-dynamic";

type Period = "today" | "week" | "month" | "quarter";

function getPeriodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case "today":
      return startOfDay(now);
    case "week":
      return startOfWeek(now, { weekStartsOn: 1 });
    case "month":
      return startOfMonth(now);
    case "quarter":
      return startOfQuarter(now);
  }
}

function getBarDays(period: Period): number {
  return { today: 1, week: 7, month: 30, quarter: 90 }[period];
}

export async function GET(req: NextRequest) {
  const period = (req.nextUrl.searchParams.get("period") ?? "week") as Period;

  const periodStart = getPeriodStart(period);
  const barDays = getBarDays(period);

  try {
    const client = await db();

    // All leads in the period
    const rows = await client
      .select()
      .from(commentLeads)
      .where(gte(commentLeads.createdAt, periodStart));

    const facebook = rows.filter((r) => r.platform === "facebook");
    const instagram = rows.filter((r) => r.platform === "instagram");

    // Build day-by-day chart data
    const chartData = Array.from({ length: barDays }).map((_, i) => {
      const day = subDays(new Date(), barDays - 1 - i);
      const ds = startOfDay(day).getTime();
      const de = ds + 86_400_000; // next day start

      const fb = rows.filter(
        (r) => r.platform === "facebook" && new Date(r.createdAt).getTime() >= ds && new Date(r.createdAt).getTime() < de
      ).length;

      const ig = rows.filter(
        (r) => r.platform === "instagram" && new Date(r.createdAt).getTime() >= ds && new Date(r.createdAt).getTime() < de
      ).length;

      const label =
        barDays <= 7
          ? day.toLocaleDateString("en-GB", { weekday: "short" })
          : barDays <= 31
          ? day.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
          : day.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });

      return { label, facebook: fb, instagram: ig, total: fb + ig };
    });

    // Top keywords in period
    const keywordCounts: Record<string, number> = {};
    for (const row of rows) {
      keywordCounts[row.keyword] = (keywordCounts[row.keyword] ?? 0) + 1;
    }
    const topKeywords = Object.entries(keywordCounts)
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return NextResponse.json({
      total: rows.length,
      facebook: facebook.length,
      instagram: instagram.length,
      chartData,
      topKeywords,
    });
  } catch (err) {
    console.error("[/api/comment-leads] Failed:", err);
    return NextResponse.json({ error: "Failed to fetch comment leads" }, { status: 500 });
  }
}
