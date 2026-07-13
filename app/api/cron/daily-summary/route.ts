import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { slackSettings, callDispositions } from "@/lib/db/schema";
import { and, eq, gte, lt, count } from "drizzle-orm";

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

/**
 * No-shows so far this month, tallied by CALL OUTCOMES (call_dispositions.outcome
 * = "no_show") rather than by a pipeline stage. `monthStart` and `endDate` are
 * YYYY-MM-DD strings; `endDate` is inclusive (the day that just ended).
 */
async function monthlyNoShowCount(monthStart: string, endDate: string): Promise<number> {
  const lower = new Date(`${monthStart}T00:00:00.000Z`);
  const upper = new Date(`${endDate}T00:00:00.000Z`);
  upper.setUTCDate(upper.getUTCDate() + 1); // make endDate inclusive
  const [row] = await db()
    .select({ n: count() })
    .from(callDispositions)
    .where(
      and(
        eq(callDispositions.outcome, "no_show"),
        gte(callDispositions.dispositionedAt, lower),
        lt(callDispositions.dispositionedAt, upper),
      ),
    );
  return Number(row?.n ?? 0);
}

interface MetricSet {
  daySpend: number; dayLeads: number; monthSpend: number; monthLeads: number;
  bookedCount: number | null; noShowCount: number | null; demosCount: number | null;
  adsOk: boolean; bookedOk: boolean; noShowOk: boolean; demosOk: boolean;
}

/**
 * The pre-post "reviewer": deterministic scrutiny of every metric BEFORE the summary posts.
 * Returns a list of human-readable problems. Two kinds: (1) a source that didn't respond
 * (so we must NOT invent a 0), and (2) cross-metric contradictions that are impossible if the
 * numbers are real — e.g. the exact failure that shipped today: Booked = 0 while no-shows and
 * demos are non-zero. If this returns anything, the summary flags those numbers as unverified
 * instead of presenting them as fact.
 */
function validateSummary(m: MetricSet): string[] {
  const issues: string[] = [];

  // (1) Source availability — a dead source must never render as a real number.
  if (!m.adsOk) issues.push("Ad spend / leads source did not respond.");
  if (!m.bookedOk) issues.push("Booked-calls source (GHL calendars) did not respond.");
  if (!m.noShowOk) issues.push("No-shows source did not respond.");
  if (!m.demosOk) issues.push("Demos source did not respond.");

  // (2) Cross-metric consistency — impossible combinations mean a source is wrong.
  if (m.bookedOk && m.bookedCount === 0 && ((m.noShowCount ?? 0) > 0 || (m.demosCount ?? 0) > 0)) {
    issues.push(`Booked = 0 but there are ${m.noShowCount ?? 0} no-shows and ${m.demosCount ?? 0} demos — impossible; the booked-calls source is likely broken.`);
  }
  if (m.bookedOk && m.noShowOk && m.bookedCount != null && m.noShowCount != null && m.noShowCount > m.bookedCount) {
    issues.push(`No-shows (${m.noShowCount}) exceed booked calls (${m.bookedCount}) — impossible.`);
  }
  if (m.daySpend < 0) issues.push(`Yesterday's ad spend is negative (${m.daySpend}).`);
  if (m.monthSpend < 0) issues.push(`Month ad spend is negative (${m.monthSpend}).`);
  if (m.adsOk && m.monthSpend > 0 && m.monthLeads === 0) issues.push(`Spend this month but 0 leads — the leads source may be broken.`);

  return issues;
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
    monthlyBooked, monthlyNoShows,
    demosMonth,
  ] = await Promise.allSettled([
    get<{ spend: number; leads: number; cpl: number | null }>(`/api/meta/ads?since=${date}&until=${date}`),
    get<{ spend: number; leads: number; cpl: number | null }>(`/api/meta/ads?since=${monthStart}&until=${date}`),
    get<{ count: number }>(`/api/comment-leads/count?since=${date}&until=${date}`),
    get<{ count: number }>(`/api/comment-leads/count?since=${monthStart}&until=${date}`),
    // Booked calls + no-shows are now MONTHLY (were a single day → always ~0).
    get<{ count: number }>(`/api/ghl/opportunities/booked-calls?since=${monthStart}&until=${date}`),
    monthlyNoShowCount(monthStart, date), // by call outcomes, not pipeline stage
    get<{ count: number }>(`/api/clickup/demos/count?since=${monthStart}&until=${date}`),
  ]);

  const dAds    = dailyAds.status    === "fulfilled" ? dailyAds.value    : null;
  const mAds    = monthlyAds.status  === "fulfilled" ? monthlyAds.value  : null;
  const dCom    = dailyComments.status === "fulfilled" ? dailyComments.value : null;
  const mCom    = monthlyComments.status === "fulfilled" ? monthlyComments.value : null;
  const booked  = monthlyBooked.status === "fulfilled" ? monthlyBooked.value : null;
  const noShow  = monthlyNoShows.status === "fulfilled" ? monthlyNoShows.value : null;
  const demos   = demosMonth.status  === "fulfilled" ? demosMonth.value  : null;

  // ── Assemble metrics, tracking which SOURCES actually resolved. A source that failed is
  //    never rendered as a real number (no false 0): it shows "—" and is flagged below.
  const daySpend     = dAds?.spend ?? 0;
  const dayLeads     = (dAds?.leads ?? 0) + (dCom?.count ?? 0);
  const dayCPL       = daySpend > 0 && dayLeads > 0 ? daySpend / dayLeads : null;
  const monthSpend   = mAds?.spend ?? 0;
  const monthLeads   = (mAds?.leads ?? 0) + (mCom?.count ?? 0);
  const monthCPL     = monthSpend > 0 && monthLeads > 0 ? monthSpend / monthLeads : null;
  const monthName    = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  // null = the source failed (distinct from a real 0). booked-calls returns {count:number} on
  // success; on error the fetch rejects → `booked` is null.
  const bookedCount  = booked && typeof booked.count === "number" ? booked.count : null;
  const noShowCount  = noShow; // number | null (monthlyNoShowCount resolves a number, or rejects → null)
  const demosCount   = demos && typeof demos.count === "number" ? demos.count : null;
  const showRate     = bookedCount != null && bookedCount > 0 && noShowCount != null
    ? Math.round(((bookedCount - noShowCount) / bookedCount) * 100) : null;

  // ── Pre-post validation gate (Jack's "reviewer"): scrutinise every metric before posting.
  const issues = validateSummary({
    daySpend, dayLeads, monthSpend, monthLeads, bookedCount, noShowCount, demosCount,
    adsOk: mAds != null, bookedOk: bookedCount != null, noShowOk: noShowCount != null, demosOk: demosCount != null,
  });
  const n = (v: number | null) => (v == null ? "—" : String(v));

  const lines: string[] = [
    `*Daily Summary — ${dayLabel}*`,
    "",
    `*Yesterday's Ad Spend:* ${fmt(daySpend)}   *Leads Yesterday:* ${dayLeads}${dayCPL ? `   *CPL:* ${fmt(dayCPL)}` : ""}`,
    `*${monthName} Spend So Far:* ${fmt(monthSpend)}   *Leads This Month:* ${monthLeads}${monthCPL ? `   *Month CPL:* ${fmt(monthCPL)}` : ""}`,
    "",
    `*Booked This Month:* ${n(bookedCount)}   *No-Shows:* ${n(noShowCount)}${showRate !== null ? `   *Show Rate:* ${showRate}%` : ""}`,
    `*Demos This Month:* ${n(demosCount)}`,
  ];
  if (issues.length) {
    lines.push(
      "",
      `:warning: *Data check flagged ${issues.length} issue${issues.length === 1 ? "" : "s"} — anything shown as "—" could not be verified and was withheld:*`,
      ...issues.map((i) => `• ${i}`),
    );
    console.error(`[daily-summary] validation issues for ${date}:`, issues);
  }

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
