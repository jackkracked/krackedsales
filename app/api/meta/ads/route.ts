import { NextRequest, NextResponse } from "next/server";
import { meta } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

interface MetaAction {
  action_type: string;
  value: string;
}

interface MetaInsightsData {
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  actions?: MetaAction[];
  date_start?: string;
  date_stop?: string;
}

interface MetaInsightsResponse {
  data: MetaInsightsData[];
}

export async function GET(req: NextRequest) {
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!adAccountId) {
    console.error("[Meta /ads] META_AD_ACCOUNT_ID is not set");
    return NextResponse.json(zeroMetrics());
  }

  const since = req.nextUrl.searchParams.get("since");
  const until = req.nextUrl.searchParams.get("until");

  // Build query params — prefer explicit date range, fall back to last_30d
  const queryParams: Record<string, string> = {
    fields: "spend,impressions,clicks,reach,actions,date_start,date_stop",
  };
  if (since && until) {
    queryParams.time_range = JSON.stringify({ since, until });
  } else {
    queryParams.date_preset = "last_30d";
  }
  console.log("[Meta /ads] querying", { since, until, queryParams });

  try {
    const res = await meta.get<MetaInsightsResponse>(
      `/${adAccountId}/insights`,
      queryParams
    );

    const row = res.data?.[0];
    console.log("[Meta /ads] response date_start:", row?.date_start, "date_stop:", row?.date_stop, "spend:", row?.spend);
    if (!row) {
      return NextResponse.json(zeroMetrics());
    }

    const spend = parseFloat(row.spend ?? "0");
    const impressions = parseInt(row.impressions ?? "0", 10);
    const clicks = parseInt(row.clicks ?? "0", 10);
    const reach = parseInt(row.reach ?? "0", 10);

    // Extract lead count from the actions array
    const leadAction = row.actions?.find((a) => a.action_type === "lead");
    const leads = leadAction ? parseInt(leadAction.value, 10) : 0;

    const cpl = leads > 0 ? parseFloat((spend / leads).toFixed(2)) : null;

    return NextResponse.json({ spend, impressions, clicks, reach, leads, cpl, dateRange: { since: row.date_start, until: row.date_stop } });
  } catch (err) {
    console.error("[Meta /ads] Failed to fetch ad insights:", err);
    return NextResponse.json(zeroMetrics());
  }
}

function zeroMetrics() {
  return { spend: 0, impressions: 0, clicks: 0, reach: 0, leads: 0, cpl: null };
}
