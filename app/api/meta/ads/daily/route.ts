import { NextRequest, NextResponse } from "next/server";
import { meta } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

interface MetaAction { action_type: string; value: string; }
interface MetaDailyRow {
  date_start: string;
  spend?: string;
  actions?: MetaAction[];
}
interface MetaDailyResponse { data: MetaDailyRow[]; }

/**
 * Returns daily spend + leads breakdown for the given date range.
 * Used to drive sparkline charts on the KPIs cards.
 * Response: [{ date, spend, leads }]
 */
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  const until = req.nextUrl.searchParams.get("until");

  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!adAccountId || !since || !until) {
    return NextResponse.json({ days: [] });
  }

  try {
    const res = await meta.get<MetaDailyResponse>(`/${adAccountId}/insights`, {
      fields: "date_start,spend,actions",
      time_range: JSON.stringify({ since, until }),
      time_increment: "1", // one row per day
      limit: "90",
    });

    const days = (res.data ?? []).map((row) => {
      const spend = parseFloat(row.spend ?? "0");
      const leadAction = row.actions?.find((a) => a.action_type === "lead");
      const leads = leadAction ? parseInt(leadAction.value, 10) : 0;
      return { date: row.date_start, spend, leads };
    });

    return NextResponse.json({ days });
  } catch (err) {
    console.error("[Meta /ads/daily]", err);
    return NextResponse.json({ days: [] });
  }
}
