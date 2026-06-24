import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  users, weeklySummaries, calls, proposals, repTargets,
} from "@/lib/db/schema";
import { and, eq, gte, lte, count, isNotNull, isNull, sum } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  startOfWeek, format, subDays,
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

  // A personalised daily priority briefing: stats are THIS week so far; the
  // briefing leads with what each person should act on today.
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = now;
  const staleCutoff = subDays(now, 7); // open opps untouched for 7+ days = stalled
  const todayLabel = format(now, "EEEE, MMM d");

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
    .where(and(gte(calls.startedAt, weekStart), lte(calls.startedAt, weekEnd)));

  const [teamProposalsSent] = await db()
    .select({ c: count() })
    .from(proposals)
    .where(and(isNotNull(proposals.sentAt), gte(proposals.sentAt, weekStart), lte(proposals.sentAt, weekEnd)));

  const [teamDealsClosed] = await db()
    .select({ c: count(), s: sum(proposals.totalAmount) })
    .from(proposals)
    .where(and(isNotNull(proposals.paidAt), gte(proposals.paidAt, weekStart), lte(proposals.paidAt, weekEnd)));

  // Fetch GHL opportunities
  let allOpps: GHLOpportunity[] = [];
  try {
    allOpps = await fetchAllOpportunities(
      `/opportunities/search?location_id=${locationId()}`
    );
  } catch {}

  const newLeads = allOpps.filter(
    (o) => new Date(o.createdAt) >= weekStart && new Date(o.createdAt) <= weekEnd
  ).length;

  const stalledOpps = allOpps.filter((o) => {
    if (o.status !== "open") return false;
    return new Date(o.updatedAt) < staleCutoff; // untouched 7+ days
  }).length;

  const openPipeline = allOpps.filter((o) => o.status === "open").length;

  // Proposals sent but not yet paid — awaiting a response (chase these).
  const awaitingProposals = await db()
    .select({ id: proposals.id, contactName: proposals.contactName, totalAmount: proposals.totalAmount, createdBy: proposals.createdBy, sentAt: proposals.sentAt })
    .from(proposals)
    .where(and(isNotNull(proposals.sentAt), isNull(proposals.paidAt)));

  /** Up to 3 contact names, "and N more". */
  const nameList = (names: string[]): string => {
    if (names.length === 0) return "none";
    const shown = names.slice(0, 3).join(", ");
    return names.length > 3 ? `${shown}, and ${names.length - 3} more` : shown;
  };

  const results: string[] = [];

  for (const user of allUsers) {
    try {
      // Per-user stats
      const [userCalls] = await db()
        .select({ c: count() })
        .from(calls)
        .where(and(eq(calls.repEmail, user.email), gte(calls.startedAt, weekStart), lte(calls.startedAt, weekEnd)));

      const [userProps] = await db()
        .select({ c: count() })
        .from(proposals)
        .where(and(eq(proposals.createdBy, user.id), isNotNull(proposals.sentAt), gte(proposals.sentAt, weekStart), lte(proposals.sentAt, weekEnd)));

      const [userDeals] = await db()
        .select({ c: count(), s: sum(proposals.totalAmount) })
        .from(proposals)
        .where(and(eq(proposals.createdBy, user.id), isNotNull(proposals.paidAt), gte(proposals.paidAt, weekStart), lte(proposals.paidAt, weekEnd)));

      // ── This person's actionable items (the priority list) ──────────────────
      const myOpenOpps = user.ghlUserId
        ? allOpps.filter((o) => o.assignedTo === user.ghlUserId && o.status === "open")
        : [];
      const userOpenLeads = myOpenOpps.length;
      const myStalled = myOpenOpps.filter((o) => new Date(o.updatedAt) < staleCutoff);
      const myStalledNames = nameList(myStalled.map((o) => o.contact?.name ?? o.name ?? "a lead"));
      const myAwaiting = awaitingProposals.filter((p) => p.createdBy === user.id);
      const myAwaitingNames = nameList(myAwaiting.map((p) => p.contactName));

      const allTargets = await db().select().from(repTargets).where(eq(repTargets.userId, user.id)).limit(1);
      const target = allTargets[0];

      const isAdmin = user.role === "admin";

      const prompt = isAdmin
        ? `Write ${user.name}'s personal priority briefing for ${todayLabel}. ${user.name} owns this email design agency.

${user.name}'s own actionable items (THIS is the priority — lead with it):
- ${myStalled.length} of ${user.name}'s open deals have gone cold (no activity in 7+ days): ${myStalledNames}
- ${myAwaiting.length} proposals ${user.name} sent are still awaiting a reply: ${myAwaitingNames}
- Open leads assigned to ${user.name}: ${userOpenLeads}

${user.name}'s results this week so far:
- Calls: ${Number(userCalls?.c ?? 0)} · Proposals sent: ${Number(userProps?.c ?? 0)} · Closed: ${Number(userDeals?.c ?? 0)} for $${Number(userDeals?.s ?? 0).toLocaleString()}

Team context this week: ${Number(teamDealsClosed?.c ?? 0)} deals closed for $${Number(teamDealsClosed?.s ?? 0).toLocaleString()}, ${newLeads} new leads, ${stalledOpps} stalled opps across ${openPipeline} open.

Write 3-4 sentences addressed to ${user.name}. START with the single most important thing to do today, naming the specific cold deals or proposals to chase. Then a one-line note on results and team state. Be direct, specific, use the names. No greetings, no sign-offs, no fluff. Sound like a sharp chief-of-staff brief.`
        : `Write ${user.name}'s personal priority briefing for ${todayLabel}. ${user.name} is a sales rep at an email design agency.

${user.name}'s actionable items today (THIS is the priority — lead with it):
- ${myStalled.length} of your open deals have gone cold (no activity in 7+ days): ${myStalledNames}
- ${myAwaiting.length} proposals you sent are still awaiting a reply: ${myAwaitingNames}
- Open leads assigned to you: ${userOpenLeads}

Your results this week so far:
- Calls: ${Number(userCalls?.c ?? 0)}${target ? ` (target ${target.callsPerDay * 5}/wk)` : ""} · Proposals: ${Number(userProps?.c ?? 0)} · Closed: ${Number(userDeals?.c ?? 0)} for $${Number(userDeals?.s ?? 0).toLocaleString()}${target ? ` (target ${target.dealsPerMonth}/mo)` : ""}

Write 3-4 sentences addressed to ${user.name} ("you"). START with the single most important thing to do today, naming the specific cold deals or proposals to chase. Then one line on your results and pace vs target. Be direct, specific, use the names. No greetings, no sign-offs, no fluff. Sound like a sharp coach.`;

      const result = await model.generateContent(prompt);
      const content = result.response.text().trim();

      // Upsert: delete existing for this user+week, then insert
      await db()
        .delete(weeklySummaries)
        .where(and(eq(weeklySummaries.userId, user.id), eq(weeklySummaries.weekStart, weekStart)));

      await db().insert(weeklySummaries).values({
        userId: user.id,
        weekStart: weekStart,
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
