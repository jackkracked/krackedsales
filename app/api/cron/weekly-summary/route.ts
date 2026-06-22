import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  users, weeklySummaries, calls, proposals, repTargets,
} from "@/lib/db/schema";
import { and, eq, gte, lte, count, isNotNull, sum } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  startOfWeek, endOfWeek, subWeeks, format,
} from "date-fns";
import { locationId } from "@/lib/ghl/client";
import { fetchAllOpportunities } from "@/lib/ghl/paginate";
import type { GHLOpportunity } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gemini-2.5-flash";

// Vercel Cron invokes the path with a GET request (it auto-attaches the CRON_SECRET
// in the Authorization header). The generation logic lived only under POST, so the
// scheduled job never actually ran — delegate GET to POST so it fires every Monday.
export async function GET(req: NextRequest) {
  return POST(req);
}

/**
 * POST /api/cron/weekly-summary
 *
 * Generates an AI weekly summary for every active user.
 * Called by Vercel Cron every Monday at 6am.
 * Protected by CRON_SECRET header.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  const ai = new GoogleGenerativeAI(key);
  const model = ai.getGenerativeModel({ model: MODEL });

  const now = new Date();
  const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
  const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
  const weekLabel = `${format(lastWeekStart, "MMM d")} – ${format(lastWeekEnd, "MMM d")}`;

  // Fetch all active users
  const allUsers = await db()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      ghlUserId: users.ghlUserId,
    })
    .from(users)
    .where(eq(users.isActive, true));

  // Fetch team-wide data once
  const [teamCalls] = await db()
    .select({ c: count() })
    .from(calls)
    .where(and(gte(calls.startedAt, lastWeekStart), lte(calls.startedAt, lastWeekEnd)));

  const [teamProposalsSent] = await db()
    .select({ c: count() })
    .from(proposals)
    .where(and(isNotNull(proposals.sentAt), gte(proposals.sentAt, lastWeekStart), lte(proposals.sentAt, lastWeekEnd)));

  const [teamDealsClosed] = await db()
    .select({ c: count(), s: sum(proposals.totalAmount) })
    .from(proposals)
    .where(and(isNotNull(proposals.paidAt), gte(proposals.paidAt, lastWeekStart), lte(proposals.paidAt, lastWeekEnd)));

  // Fetch GHL opportunities
  let allOpps: GHLOpportunity[] = [];
  try {
    allOpps = await fetchAllOpportunities(
      `/opportunities/search?location_id=${locationId()}`
    );
  } catch {}

  const newLeads = allOpps.filter(
    (o) => new Date(o.createdAt) >= lastWeekStart && new Date(o.createdAt) <= lastWeekEnd
  ).length;

  const stalledOpps = allOpps.filter((o) => {
    if (o.status !== "open") return false;
    const updated = new Date(o.updatedAt);
    return updated < lastWeekStart; // no activity last week
  }).length;

  const openPipeline = allOpps.filter((o) => o.status === "open").length;

  const results: string[] = [];

  for (const user of allUsers) {
    try {
      // Per-user stats
      const [userCalls] = await db()
        .select({ c: count() })
        .from(calls)
        .where(and(eq(calls.repEmail, user.email), gte(calls.startedAt, lastWeekStart), lte(calls.startedAt, lastWeekEnd)));

      const [userProps] = await db()
        .select({ c: count() })
        .from(proposals)
        .where(and(eq(proposals.createdBy, user.id), isNotNull(proposals.sentAt), gte(proposals.sentAt, lastWeekStart), lte(proposals.sentAt, lastWeekEnd)));

      const [userDeals] = await db()
        .select({ c: count(), s: sum(proposals.totalAmount) })
        .from(proposals)
        .where(and(eq(proposals.createdBy, user.id), isNotNull(proposals.paidAt), gte(proposals.paidAt, lastWeekStart), lte(proposals.paidAt, lastWeekEnd)));

      const userOpenLeads = user.ghlUserId
        ? allOpps.filter((o) => o.assignedTo === user.ghlUserId && o.status === "open").length
        : 0;

      const allTargets = await db().select().from(repTargets).where(eq(repTargets.userId, user.id)).limit(1);
      const target = allTargets[0];

      const isAdmin = user.role === "admin";

      const prompt = isAdmin
        ? `You are writing a weekly sales briefing for an email design agency owner. Week: ${weekLabel}.

Team stats:
- Total calls logged: ${Number(teamCalls?.c ?? 0)}
- Proposals sent: ${Number(teamProposalsSent?.c ?? 0)}
- Deals closed: ${Number(teamDealsClosed?.c ?? 0)} for $${Number(teamDealsClosed?.s ?? 0).toLocaleString()}
- New leads: ${newLeads}
- Stalled opportunities (no activity last week): ${stalledOpps}
- Open pipeline: ${openPipeline} opportunities

Your personal stats:
- Calls: ${Number(userCalls?.c ?? 0)}
- Proposals sent: ${Number(userProps?.c ?? 0)}
- Deals closed: ${Number(userDeals?.c ?? 0)} for $${Number(userDeals?.s ?? 0).toLocaleString()}

Write a 3-5 sentence briefing paragraph. Be direct and specific with numbers. Mention what closed, what stalled, and what needs attention this week. No fluff, no greetings, no sign-offs. Sound like a sharp internal memo, not a newsletter.`
        : `You are writing a weekly sales briefing for a sales rep at an email design agency. Week: ${weekLabel}.

Your stats:
- Calls logged: ${Number(userCalls?.c ?? 0)}${target ? ` (target: ${target.callsPerDay * 5}/week)` : ""}
- Proposals sent: ${Number(userProps?.c ?? 0)}
- Deals closed: ${Number(userDeals?.c ?? 0)} for $${Number(userDeals?.s ?? 0).toLocaleString()}${target ? ` (target: ${target.dealsPerMonth}/month)` : ""}
- Open leads assigned: ${userOpenLeads}

Write a 3-5 sentence briefing paragraph about YOUR performance. Be direct and specific with numbers. Mention what you closed, what needs follow-up, and what to focus on this week. No fluff, no greetings, no sign-offs. Sound like a coach giving a quick debrief.`;

      const result = await model.generateContent(prompt);
      const content = result.response.text().trim();

      // Upsert: delete existing for this user+week, then insert
      await db()
        .delete(weeklySummaries)
        .where(and(eq(weeklySummaries.userId, user.id), eq(weeklySummaries.weekStart, lastWeekStart)));

      await db().insert(weeklySummaries).values({
        userId: user.id,
        weekStart: lastWeekStart,
        content,
      });

      results.push(`${user.name}: OK`);
    } catch (err) {
      console.error(`[weekly-summary] Failed for ${user.name}:`, err);
      results.push(`${user.name}: FAILED`);
    }
  }

  return NextResponse.json({ results });
}
