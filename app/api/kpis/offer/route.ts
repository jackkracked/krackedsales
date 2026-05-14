import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pipelineStageEvents, proposals } from "@/lib/db/schema";
import { and, gte, lt, inArray, isNotNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { ghl, locationId } from "@/lib/ghl/client";
import { clickup, demoListId } from "@/lib/clickup/client";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

// Pipeline name substrings that identify the Free Email Design offer
const EMAIL_DESIGN_NAMES = [
  "email design demo",
  "taylor's tiktok",
  "taylor tiktok",
];

// Demo and audit fulfillment costs (from the KPI doc)
const DEMO_COST = 30;
const AUDIT_COST = 100;

function parsePeriod(period: string): { start: Date; end: Date } | null {
  const match = period.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
}

function parseRange(searchParams: URLSearchParams): { start: Date; end: Date } | null {
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  if (startParam && endParam) {
    const start = new Date(startParam + "T00:00:00.000Z");
    const end = new Date(endParam + "T00:00:00.000Z");
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) return null;
    return { start, end };
  }
  return parsePeriod(searchParams.get("period") ?? "");
}

// Normalise raw GHL source strings into clean display labels
function normaliseSource(raw: string | undefined | null): string {
  if (!raw) return "Unknown";
  const s = raw.toLowerCase();
  if (s.includes("tiktok")) return "TikTok";
  if (s.includes("facebook") || s.includes("fb ads") || s.includes("meta")) return "Facebook Ads";
  if (s.includes("instagram") || s === "ig") return "Instagram";
  if (s.includes("website") || s.includes("google") || s.includes("seo")) return "Website";
  if (s.includes("referral") || s.includes("refer")) return "Referral";
  // Capitalise first letter of unrecognised sources verbatim
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const range = parseRange(searchParams);
    if (!range) {
      return NextResponse.json(
        { error: "Invalid date range — use ?start=YYYY-MM-DD&end=YYYY-MM-DD or ?period=YYYY-MM" },
        { status: 400 }
      );
    }
    const { start, end } = range;

    // ─── 1. Find the Email Design pipeline IDs ────────────────────────────────
    const pipelinesData = await ghl.get<{ pipelines: GHLPipeline[] }>(
      `/opportunities/pipelines?locationId=${locationId()}`
    );
    const emailDesignPipelines = pipelinesData.pipelines.filter((p) =>
      EMAIL_DESIGN_NAMES.some((name) => p.name.toLowerCase().includes(name))
    );

    if (emailDesignPipelines.length === 0) {
      return NextResponse.json({ error: "Email Design pipelines not found in GHL" }, { status: 404 });
    }

    const pipelineIds = emailDesignPipelines.map((p) => p.id);

    // ─── 2. Fetch all opportunities in those pipelines → source map ───────────
    // opportunityId → normalised source label
    const sourceByOppId = new Map<string, string>();
    // contactId → normalised source (for demo attribution)
    const sourceByContactId = new Map<string, string>();

    for (const pipeline of emailDesignPipelines) {
      let page = 1;
      while (true) {
        const data = await ghl.get<{ opportunities: GHLOpportunity[] }>(
          `/opportunities/search?location_id=${locationId()}&pipeline_id=${pipeline.id}&limit=100&page=${page}`
        );
        const opps = data.opportunities ?? [];
        for (const opp of opps) {
          const source = normaliseSource(opp.source);
          sourceByOppId.set(opp.id, source);
          if (opp.contact?.id) sourceByContactId.set(opp.contact.id, source);
        }
        if (opps.length < 100) break;
        page++;
      }
    }

    // ─── 3. Pipeline stage events in period for these pipelines ───────────────
    const stageEvents = await db()
      .select({
        opportunityId: pipelineStageEvents.opportunityId,
        stageName: pipelineStageEvents.stageName,
      })
      .from(pipelineStageEvents)
      .where(
        and(
          inArray(pipelineStageEvents.pipelineId, pipelineIds),
          gte(pipelineStageEvents.enteredAt, start),
          lt(pipelineStageEvents.enteredAt, end)
        )
      );

    // Group stage events: source → { stageName → count }
    const stagesBySource = new Map<string, Map<string, number>>();
    // Collect all unique stage names across all sources
    const allStageNames = new Set<string>();

    for (const event of stageEvents) {
      const source = sourceByOppId.get(event.opportunityId) ?? "Unknown";
      const stageName = event.stageName;
      allStageNames.add(stageName);
      if (!stagesBySource.has(source)) stagesBySource.set(source, new Map());
      const stages = stagesBySource.get(source)!;
      stages.set(stageName, (stages.get(stageName) ?? 0) + 1);
    }

    // Format as array sorted by total volume descending
    const stageBreakdown = Array.from(stagesBySource.entries())
      .map(([source, stages]) => ({
        source,
        stages: Object.fromEntries(stages),
        total: Array.from(stages.values()).reduce((s, v) => s + v, 0),
      }))
      .sort((a, b) => b.total - a.total);

    const stageNames = Array.from(allStageNames).sort();

    // ─── 4. ClickUp demo counts + list in period ──────────────────────────────
    let demosCompleted = 0;
    const recentDemos: Array<{ id: string; name: string; status: string; statusColor: string; dateCreated: number; url: string }> = [];

    try {
      const listId = demoListId();
      const sinceMs = start.getTime();
      const untilMs = end.getTime();
      let page = 0;
      const allTasks: Array<{ id: string; name: string; parent: string | null; status: { status: string; color: string }; date_created: string; url: string }> = [];
      while (true) {
        const res = await clickup.get<{ tasks: typeof allTasks }>(
          `/list/${listId}/task?include_closed=true&subtasks=false&order_by=created&reverse=true&page=${page}&date_created_gt=${sinceMs}&date_created_lt=${untilMs}`
        );
        const batch = res.tasks ?? [];
        allTasks.push(...batch);
        if (batch.length < 100) break;
        page++;
      }
      const demoTasks = allTasks.filter(
        (t) => !t.parent && t.name.toLowerCase().includes(": email demo")
      );
      demosCompleted = demoTasks.length;
      // Build the recent demos list (most recent first, max 20)
      for (const t of demoTasks.slice(0, 20)) {
        // Strip the ": Email Demo" suffix to get the client name
        const clientName = t.name.replace(/:\s*email demo\s*$/i, "").trim();
        recentDemos.push({
          id: t.id,
          name: clientName,
          status: t.status?.status ?? "unknown",
          statusColor: t.status?.color ?? "#888",
          dateCreated: parseInt(t.date_created, 10),
          url: t.url,
        });
      }
    } catch (e) {
      console.error("[kpis/offer] ClickUp demos failed:", e);
    }

    // ─── 5. Proposals in these pipelines this period ─────────────────────────
    // "New clients" for this offer = proposals paid in period where contact is in
    // one of the 3 pipelines
    const contactsInPipelines = new Set(sourceByContactId.keys());

    const [paidProposals, sentProposals] = await Promise.all([
      db()
        .select({ totalAmount: proposals.totalAmount, ghlContactId: proposals.ghlContactId })
        .from(proposals)
        .where(and(gte(proposals.paidAt, start), lt(proposals.paidAt, end))),
      db()
        .select({ totalAmount: proposals.totalAmount })
        .from(proposals)
        .where(and(isNotNull(proposals.sentAt), gte(proposals.sentAt, start), lt(proposals.sentAt, end))),
    ]);

    const offerPaidProposals = paidProposals.filter((r) =>
      contactsInPipelines.has(r.ghlContactId)
    );
    const newClientsCount = new Set(offerPaidProposals.map((r) => r.ghlContactId)).size;
    const cashCollected = offerPaidProposals.reduce((sum, r) => sum + r.totalAmount, 0);
    const valueOfProposalsSent = sentProposals.reduce((sum, r) => sum + r.totalAmount, 0);

    // ─── 6. Meta ad spend for period ─────────────────────────────────────────
    let adSpend = 0;

    try {
      const adAccountId = process.env.META_AD_ACCOUNT_ID;
      if (adAccountId) {
        const sinceStr = start.toISOString().slice(0, 10);
        const untilStr = new Date(end.getTime() - 86400000).toISOString().slice(0, 10);
        const { meta } = await import("@/lib/meta/client");
        const res = await meta.get<{ data: Array<{ spend?: string }> }>(
          `/${adAccountId}/insights`,
          {
            fields: "spend",
            time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
          }
        );
        adSpend = (res.data ?? []).reduce((sum, d) => sum + parseFloat(d.spend ?? "0"), 0);
      }
    } catch (e) {
      console.error("[kpis/offer] Meta ad spend failed:", e);
    }

    // ─── 7. Unit economics ────────────────────────────────────────────────────
    const demoCost = demosCompleted * DEMO_COST;
    const totalCost = adSpend + demoCost;

    // Cost of Proposal = (Ad Spend + Demo Cost) / Demos Requested
    // "Demos requested" = count of distinct opportunities that entered any demo-related stage
    const demosRequested = stageBreakdown.reduce((sum, row) => {
      const demoEntry = Object.entries(row.stages).find(([name]) =>
        name.toLowerCase().includes("demo")
      );
      return sum + (demoEntry?.[1] ?? 0);
    }, 0);

    const costOfProposal = demosRequested > 0 ? totalCost / demosRequested : 0;
    const cac = newClientsCount > 0 ? totalCost / newClientsCount : 0;
    const roas = adSpend > 0 ? cashCollected / adSpend : 0;

    return NextResponse.json({
      pipelines: emailDesignPipelines.map((p) => ({ id: p.id, name: p.name })),
      // Pipeline stage breakdown
      stageBreakdown,
      stageNames,
      // Demo tracking
      demosCompleted,
      recentDemos,
      demoCost: DEMO_COST,
      auditCost: AUDIT_COST,
      // Financials
      cashCollected,
      adSpend,
      roas,
      valueOfProposalsSent,
      // Unit economics
      newClientsCount,
      costOfProposal,
      cac,
      totalFulfillmentCost: demoCost,
    });
  } catch (err) {
    console.error("[GET /api/kpis/offer]", err);
    return NextResponse.json({ error: "Failed to load offer metrics" }, { status: 500 });
  }
}
