import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { slackSettings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function base() { return process.env.NEXT_PUBLIC_APP_URL ?? "https://kracked-sales.vercel.app"; }
function ih() { return { "x-internal-secret": process.env.CRON_SECRET ?? "" }; }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`, { headers: ih() });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

function fmt(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Returns the date string (YYYY-MM-DD) for "yesterday in Eastern time".
 * Subtracts 24 hours so it works even if Vercel fires the cron a few minutes
 * after midnight — "1 minute ago" would still be today, but "24 hours ago"
 * is always safely within yesterday.
 */
function easternYesterday(): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(yesterday);
  const p = Object.fromEntries(parts.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The day that just ended in Eastern time
  const date = easternYesterday(); // e.g. "2026-04-26"
  const monthStart = `${date.slice(0, 7)}-01`; // e.g. "2026-04-01"

  const dayLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });

  const rows = await db()
    .select({ botToken: slackSettings.botToken, channelId: slackSettings.channelId, enabled: slackSettings.enabled })
    .from(slackSettings).limit(1);
  const settings = rows[0];
  if (!settings?.enabled || !settings.botToken || !settings.channelId) {
    return NextResponse.json({ skipped: "Slack not configured or disabled" });
  }

  // Fetch daily and monthly data in parallel
  const [
    dailyAds, monthlyAds,
    dailyComments, monthlyComments,
    dailyBooked, dailyNoShows,
    demosMonth,
  ] = await Promise.allSettled([
    get<{ spend: number; leads: number; cpl: number | null }>(`/api/meta/ads?since=${date}&until=${date}`),
    get<{ spend: number; leads: number; cpl: number | null }>(`/api/meta/ads?since=${monthStart}&until=${date}`),
    get<{ count: number }>(`/api/comment-leads/count?since=${date}&until=${date}`),
    get<{ count: number }>(`/api/comment-leads/count?since=${monthStart}&until=${date}`),
    get<{ count: number }>(`/api/ghl/opportunities/booked-calls?since=${date}&until=${date}`),
    get<{ count: number }>(`/api/ghl/opportunities/no-show-calls?since=${date}&until=${date}`),
    get<{ count: number }>(`/api/clickup/demos/count?since=${monthStart}&until=${date}`),
  ]);

  const dAds    = dailyAds.status    === "fulfilled" ? dailyAds.value    : null;
  const mAds    = monthlyAds.status  === "fulfilled" ? monthlyAds.value  : null;
  const dCom    = dailyComments.status === "fulfilled" ? dailyComments.value : null;
  const mCom    = monthlyComments.status === "fulfilled" ? monthlyComments.value : null;
  const booked  = dailyBooked.status === "fulfilled" ? dailyBooked.value : null;
  const noShow  = dailyNoShows.status === "fulfilled" ? dailyNoShows.value : null;
  const demos   = demosMonth.status  === "fulfilled" ? demosMonth.value  : null;

  // Daily figures
  const daySpend     = dAds?.spend ?? 0;
  const dayLeads     = (dAds?.leads ?? 0) + (dCom?.count ?? 0);
  const dayCPL       = daySpend > 0 && dayLeads > 0 ? daySpend / dayLeads : null;
  const bookedCount  = booked?.count ?? 0;
  const noShowCount  = noShow?.count ?? 0;
  const showRate     = bookedCount > 0 ? Math.round(((bookedCount - noShowCount) / bookedCount) * 100) : null;

  // Monthly figures
  const monthSpend   = mAds?.spend ?? 0;
  const monthLeads   = (mAds?.leads ?? 0) + (mCom?.count ?? 0);
  const monthCPL     = monthSpend > 0 && monthLeads > 0 ? monthSpend / monthLeads : null;
  const monthName    = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  const lines: string[] = [
    `*Daily Summary — ${dayLabel}*`,
    "",
    `*Yesterday's Ad Spend:* ${fmt(daySpend)}   *Leads Yesterday:* ${dayLeads}${dayCPL ? `   *CPL:* ${fmt(dayCPL)}` : ""}`,
    `*${monthName} Spend So Far:* ${fmt(monthSpend)}   *Leads This Month:* ${monthLeads}${monthCPL ? `   *Month CPL:* ${fmt(monthCPL)}` : ""}`,
    "",
    `*Booked Calls:* ${bookedCount}   *No-Shows:* ${noShowCount}${showRate !== null ? `   *Show Rate:* ${showRate}%` : ""}`,
    `*Demos This Month:* ${demos?.count ?? "—"}`,
  ];

  const text = lines.join("\n");

  const postRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: settings.channelId, text }),
  });
  const postData = await postRes.json();
  if (!postData.ok) {
    console.error("[daily-summary] Slack post failed:", postData.error);
    return NextResponse.json({ error: postData.error }, { status: 502 });
  }

  console.log(`[daily-summary] Posted for ${date}`);
  return NextResponse.json({ ok: true, date });
}
