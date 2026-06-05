import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";
import { logActivity } from "@/lib/activity/logger";


export const dynamic = "force-dynamic";

interface GHLOpportunitiesResponse {
  opportunities: GHLOpportunity[];
  meta?: { total: number };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const pipelineId = searchParams.get("pipelineId");
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  if (!pipelineId) {
    return NextResponse.json({ opportunities: [], meta: { total: 0 } });
  }

  try {
    // Fetch EVERY opportunity in the pipeline, not just the first 100.
    // The board must never silently drop opportunities — missing a live deal
    // is a data-integrity failure. GHL pages at 100/request, so loop until
    // we've pulled the full set (with a safety cap).
    const MAX_PAGES = 60; // safety cap: 6,000 opportunities
    const allOpps: GHLOpportunity[] = [];
    let total = Infinity;

    const pipelinesData = await ghl.get<{ pipelines: GHLPipeline[] }>(
      `/opportunities/pipelines?locationId=${locationId()}`
    );

    for (let page = 1; page <= MAX_PAGES; page++) {
      const oppsData = await ghl.get<GHLOpportunitiesResponse>(
        `/opportunities/search?location_id=${locationId()}&pipeline_id=${pipelineId}&limit=100&page=${page}`
      );
      const batch = oppsData.opportunities ?? [];
      allOpps.push(...batch);
      total = oppsData.meta?.total ?? allOpps.length;
      // Stop when the last page returns a partial batch or we've reached the total.
      if (batch.length < 100 || allOpps.length >= total) break;
    }

    const pipeline = pipelinesData.pipelines?.find((p) => p.id === pipelineId);
    const stageMap: Record<string, string> = {};
    if (pipeline?.stages) {
      for (const s of pipeline.stages) {
        stageMap[s.id] = s.name;
      }
    }

    let opps = allOpps.map((opp) => ({
      ...opp,
      pipelineStageId_name: stageMap[opp.pipelineStageId] ?? "Unknown Stage",
    }));

    // Filter by createdAt date range if requested.
    // Dates are treated as CST (UTC-6) day boundaries so a "today" query
    // covers the full calendar day in Jack's timezone, not UTC.
    if (since || until) {
      const sinceMs = since ? new Date(`${since}T00:00:00-06:00`).getTime() : 0;
      const untilMs = until ? new Date(`${until}T23:59:59-06:00`).getTime() : Infinity;
      const before = opps.length;
      opps = opps.filter((opp) => {
        const t = new Date(opp.createdAt).getTime();
        return t >= sinceMs && t <= untilMs;
      });
      console.log(`[opportunities] date filter ${since}→${until} (CST): ${before} total → ${opps.length} matched`);
    }

    return NextResponse.json({ opportunities: opps, meta: { total } });
  } catch (err) {
    console.error("[GET /api/ghl/opportunities]", err);
    return NextResponse.json({ error: "Failed to fetch opportunities" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, email, phone, website, source, pipelineId, pipelineStageId } = body;

  try {
    // Step 1: Create the contact in GHL and get their contactId
    const nameParts = (name ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ") || undefined;

    const contactPayload: Record<string, unknown> = {
      locationId: locationId(),
      firstName,
    };
    if (lastName) contactPayload.lastName = lastName;
    if (email) contactPayload.email = email;
    if (phone) contactPayload.phone = phone;
    if (website) contactPayload.website = website;
    if (source) contactPayload.source = source;

    const contactData = await ghl.post<{ contact: { id: string } }>("/contacts/", contactPayload);
    const contactId = contactData.contact?.id;
    if (!contactId) throw new Error("GHL did not return a contactId after contact creation");

    // Step 2: Create the opportunity with the contactId
    const oppData = await ghl.post<GHLOpportunity>("/opportunities/", {
      locationId: locationId(),
      name: name ?? firstName,
      pipelineId,
      pipelineStageId,
      contactId,
    });

    logActivity({
      userId: "unknown",
      userName: "Unknown",
      userEmail: "unknown@unknown.com",
      action: "lead.added",
      entityType: "opportunity",
      entityId: oppData.id ?? "",
      entityName: name ?? firstName,
      metadata: { pipeline_id: pipelineId, stage_id: pipelineStageId },
    });

    return NextResponse.json(oppData);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/ghl/opportunities]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
