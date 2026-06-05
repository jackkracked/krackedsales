import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { offerFunnels, proposals, pipelineStageEvents } from "@/lib/db/schema";
import { and, eq, gte, lt, inArray, isNotNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { ghl, locationId } from "@/lib/ghl/client";
import { clickup, demoListId } from "@/lib/clickup/client";
import type { GHLOpportunity } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

function parseRange(searchParams: URLSearchParams): { start: Date; end: Date } | null {
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  if (startParam && endParam) {
    const start = new Date(startParam + "T00:00:00.000Z");
    const end = new Date(endParam + "T00:00:00.000Z");
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) return null;
    return { start, end };
  }
  return null;
}

/**
 * GET /api/kpis/funnel?funnelId=xxx&start=YYYY-MM-DD&end=YYYY-MM-DD
 * Computes all 20 offer metrics for a single funnel.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const funnelId = searchParams.get("funnelId");
    if (!funnelId) return NextResponse.json({ error: "funnelId required" }, { status: 400 });

    const range = parseRange(searchParams);
    if (!range) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

    const { start, end } = range;

    // Load funnel config
    const [funnel] = await db().select().from(offerFunnels).where(eq(offerFunnels.id, funnelId)).limit(1);
    if (!funnel) return NextResponse.json({ error: "Funnel not found" }, { status: 404 });

    const pipelineIds = (funnel.pipelineIds as string[]) ?? [];
    if (pipelineIds.length === 0) {
      return NextResponse.json({ funnel: funnel.name, metrics: emptyMetrics() });
    }

    // ─── 1. Leads: opportunities in funnel pipelines ──────────────────────────
    let leads = 0;
    const contactIdsInFunnel = new Set<string>();
    try {
      for (const pipelineId of pipelineIds) {
        let page = 1;
        while (true) {
          const res = await ghl.get<{ opportunities: GHLOpportunity[]; meta: { total: number } }>(
            `/opportunities/search?location_id=${locationId()}&pipeline_id=${pipelineId}&limit=100&page=${page}`
          );
          const opps = res.opportunities ?? [];
          for (const opp of opps) {
            if (opp.contact?.id) contactIdsInFunnel.add(opp.contact.id);
            const created = new Date(opp.createdAt);
            if (created >= start && created < end) leads++;
          }
          if (opps.length < 100) break;
          page++;
        }
      }
    } catch (e) {
      console.error("[kpis/funnel] GHL opportunity fetch failed:", e);
    }

    // ─── 2. Booked Calls: calendar events for contacts in funnel ──────────────
    let bookedCalls = 0;
    // We count appointments where the contact is in the funnel pipelines
    // This is tracked via pipeline stage events with stage names containing "booked" or "call"
    try {
      const stageEvents = await db().select().from(pipelineStageEvents)
        .where(and(
          inArray(pipelineStageEvents.pipelineId, pipelineIds),
          gte(pipelineStageEvents.enteredAt, start),
          lt(pipelineStageEvents.enteredAt, end),
        ));
      // Count events where stage name suggests a booked call
      const callStages = stageEvents.filter(e =>
        e.stageName.toLowerCase().includes("booked") ||
        e.stageName.toLowerCase().includes("call") ||
        e.stageName.toLowerCase().includes("appointment")
      );
      bookedCalls = callStages.length;
    } catch (e) {
      console.error("[kpis/funnel] Booked calls query failed:", e);
    }

    // ─── 3. Demos (ClickUp) ──────────────────────────────────────────────────
    let demosSubmitted = 0;
    let demosCompleted = 0;
    try {
      const listId = demoListId();
      if (listId) {
        const startMs = start.getTime();
        const endMs = end.getTime();
        let page = 0;
        while (true) {
          const res = await clickup.get<{ tasks: Array<{ name: string; status: { status: string }; date_created: string; parent: string | null }> }>(
            `/list/${listId}/task?page=${page}&subtasks=false&include_closed=true&date_created_gt=${startMs}&date_created_lt=${endMs}`
          );
          const tasks = res.tasks ?? [];
          for (const task of tasks) {
            if (task.parent) continue; // skip subtasks
            demosSubmitted++;
            const status = task.status?.status?.toLowerCase() ?? "";
            if (status === "scheduled/live" || status === "complete" || status === "closed") {
              demosCompleted++;
            }
          }
          if (tasks.length < 100) break;
          page++;
        }
      }
    } catch (e) {
      console.error("[kpis/funnel] ClickUp demo fetch failed:", e);
    }

    // ─── 4. Audits (ClickUp Account Audits list) ─────────────────────────────
    let auditsRequested = 0;
    let auditsCompleted = 0;
    try {
      const auditListId = process.env.CLICKUP_AUDIT_LIST_ID;
      if (auditListId) {
        const startMs = start.getTime();
        const endMs = end.getTime();
        let page = 0;
        while (true) {
          const res = await clickup.get<{ tasks: Array<{ status: { status: string }; date_created: string; parent: string | null }> }>(
            `/list/${auditListId}/task?page=${page}&subtasks=false&include_closed=true&date_created_gt=${startMs}&date_created_lt=${endMs}`
          );
          const tasks = res.tasks ?? [];
          for (const task of tasks) {
            if (task.parent) continue;
            auditsRequested++;
            const status = task.status?.status?.toLowerCase() ?? "";
            if (status === "complete" || status === "closed" || status === "done") {
              auditsCompleted++;
            }
          }
          if (tasks.length < 100) break;
          page++;
        }
      }
    } catch (e) {
      console.error("[kpis/funnel] ClickUp audit fetch failed:", e);
    }

    // ─── 5. Ad Spend (filtered by campaign name, or total if no filter) ────
    let adSpend = 0;
    try {
      const platform = funnel.adPlatform ?? "meta";

      if (platform === "meta" || platform === "both") {
        const adAccountId = process.env.META_AD_ACCOUNT_ID;
        if (adAccountId) {
          const sinceStr = start.toISOString().slice(0, 10);
          const untilStr = new Date(end.getTime() - 86400000).toISOString().slice(0, 10);
          const { meta } = await import("@/lib/meta/client");

          if (funnel.campaignFilter) {
            // Fetch campaign-level insights to filter by name
            const filter = funnel.campaignFilter.toUpperCase();
            const res = await meta.get<{ data: Array<{ campaign_name?: string; spend?: string }> }>(
              `/${adAccountId}/insights`,
              {
                fields: "campaign_name,spend",
                level: "campaign",
                time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
                limit: "500",
              }
            );
            adSpend += (res.data ?? [])
              .filter(d => (d.campaign_name ?? "").toUpperCase().includes(filter))
              .reduce((sum, d) => sum + parseFloat(d.spend ?? "0"), 0);
          } else {
            // No campaign filter — fetch total account-level ad spend
            const res = await meta.get<{ data: Array<{ spend?: string }> }>(
              `/${adAccountId}/insights`,
              {
                fields: "spend",
                time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
              }
            );
            adSpend += (res.data ?? []).reduce((sum, d) => sum + parseFloat(d.spend ?? "0"), 0);
          }
        }
      }
      // TikTok: placeholder for future integration
    } catch (e) {
      console.error("[kpis/funnel] Ad spend fetch failed:", e);
    }

    // ─── 6. Proposals (for contacts in funnel pipelines) ─────────────────────
    const contactIds = Array.from(contactIdsInFunnel);
    let funnelCashCollected = 0;
    let funnelMgmtSent = 0;
    let funnelMgmtLost = 0;
    let funnelProjSent = 0;
    let funnelProjLost = 0;

    if (contactIds.length > 0) {
      const [paidRows, mgmtSentRows, mgmtLostRows, projSentRows, projLostRows] = await Promise.all([
        db().select({ totalAmount: proposals.totalAmount }).from(proposals)
          .where(and(
            inArray(proposals.ghlContactId, contactIds),
            isNotNull(proposals.paidAt),
            gte(proposals.paidAt, start),
            lt(proposals.paidAt, end),
          )),
        db().select({ totalAmount: proposals.totalAmount }).from(proposals)
          .where(and(
            inArray(proposals.ghlContactId, contactIds),
            eq(proposals.type, "management"),
            isNotNull(proposals.sentAt),
            gte(proposals.sentAt, start),
            lt(proposals.sentAt, end),
          )),
        db().select({ totalAmount: proposals.totalAmount }).from(proposals)
          .where(and(
            inArray(proposals.ghlContactId, contactIds),
            eq(proposals.type, "management"),
            isNotNull(proposals.lostAt),
            gte(proposals.lostAt, start),
            lt(proposals.lostAt, end),
          )),
        db().select({ totalAmount: proposals.totalAmount }).from(proposals)
          .where(and(
            inArray(proposals.ghlContactId, contactIds),
            eq(proposals.type, "project"),
            isNotNull(proposals.sentAt),
            gte(proposals.sentAt, start),
            lt(proposals.sentAt, end),
          )),
        db().select({ totalAmount: proposals.totalAmount }).from(proposals)
          .where(and(
            inArray(proposals.ghlContactId, contactIds),
            eq(proposals.type, "project"),
            isNotNull(proposals.lostAt),
            gte(proposals.lostAt, start),
            lt(proposals.lostAt, end),
          )),
      ]);

      funnelCashCollected = paidRows.reduce((sum, r) => sum + r.totalAmount, 0);
      funnelMgmtSent = mgmtSentRows.reduce((sum, r) => sum + r.totalAmount, 0);
      funnelMgmtLost = mgmtLostRows.reduce((sum, r) => sum + r.totalAmount, 0);
      funnelProjSent = projSentRows.reduce((sum, r) => sum + r.totalAmount, 0);
      funnelProjLost = projLostRows.reduce((sum, r) => sum + r.totalAmount, 0);
    }

    // ─── 7. Computed metrics ─────────────────────────────────────────────────
    const cpl = leads > 0 ? adSpend / leads : 0;
    const bookingRate = leads > 0 ? Math.round((bookedCalls / leads) * 1000) / 10 : 0;
    const costPerBookedCall = bookedCalls > 0 ? adSpend / bookedCalls : 0;
    const costPerDemoCompleted = demosCompleted > 0 ? adSpend / demosCompleted : 0;
    const roas = adSpend > 0 ? Math.round((funnelCashCollected / adSpend) * 100) / 100 : 0;

    return NextResponse.json({
      funnel: funnel.name,
      metrics: {
        leads,
        cpl,
        bookedCalls,
        bookingRate,
        costPerBookedCall,
        adSpend,
        demosSubmitted,
        demosCompleted,
        costPerDemoCompleted,
        auditsRequested,
        auditsCompleted,
        cashCollected: funnelCashCollected,
        roas,
        mgmtProposalValueSent: funnelMgmtSent,
        mgmtProposalValueLost: funnelMgmtLost,
        projProposalValueSent: funnelProjSent,
        projProposalValueLost: funnelProjLost,
      },
    });
  } catch (err) {
    console.error("[GET /api/kpis/funnel]", err);
    return NextResponse.json({ error: "Failed to load funnel metrics" }, { status: 500 });
  }
}

function emptyMetrics() {
  return {
    leads: 0, cpl: 0, bookedCalls: 0, bookingRate: 0, costPerBookedCall: 0,
    adSpend: 0, demosSubmitted: 0, demosCompleted: 0, costPerDemoCompleted: 0,
    auditsRequested: 0, auditsCompleted: 0, cashCollected: 0, roas: 0,
    mgmtProposalValueSent: 0, mgmtProposalValueLost: 0,
    projProposalValueSent: 0, projProposalValueLost: 0,
  };
}
