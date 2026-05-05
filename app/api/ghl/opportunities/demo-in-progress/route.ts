import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

// "Demo In Progress" stage ID keyed by pipelineId
const DEMO_IN_PROGRESS_STAGE: Record<string, string> = {
  JRvrpfcwAlAOM38mPAUJ:   "ffd18e7a-a59e-4a13-894d-d5371d0bfc90", // Email Design Demo Pipeline (AD FUNNEL)
  uEefctNze07YOCaGOSNE:   "4e3b0980-9eb9-4d7d-9f4d-cf0dbac04ff8", // Email Design Demo Pipeline (ORGANIC FUNNEL)
  "9pk3LOPFgZucx0Q13Spj": "dc8cda15-0d9c-44d1-bf16-e8d9a82d921d", // Kracked Retention General Pipeline (MAIN WEBSITE)
  tZ2jrSx9nurGp08CWxWU:   "013d35a0-c062-423f-884a-9afa96716f36", // Taylor's TikTok Pipeline
};

function normaliseDomain(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").trim();
}

// Fetch all opportunities across all pages — same pattern as contacts route
async function fetchAllOpportunities(): Promise<GHLOpportunity[]> {
  const locId = locationId();
  const all: GHLOpportunity[] = [];
  for (let page = 1; page <= 20; page++) {
    const data = await ghl.get<{ opportunities: GHLOpportunity[] }>(
      `/opportunities/search?location_id=${locId}&limit=100&page=${page}`
    );
    const batch = data.opportunities ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export async function POST(req: NextRequest) {
  // Optional webhook secret
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const website: string = body.website ?? "";

  if (!website) {
    return NextResponse.json({ error: "website is required" }, { status: 400 });
  }

  const searchDomain = normaliseDomain(website);

  try {
    // Fetch all opportunities from our pipeline data and find the match by domain
    const allOpps = await fetchAllOpportunities();

    const match = allOpps.find((o) => {
      const company = normaliseDomain(o.contact?.companyName ?? "");
      return company === searchDomain || company.includes(searchDomain) || searchDomain.includes(company);
    });

    if (!match) {
      return NextResponse.json(
        { error: `No opportunity found matching website: ${website}` },
        { status: 404 }
      );
    }

    const stageId = DEMO_IN_PROGRESS_STAGE[match.pipelineId];
    if (!stageId) {
      return NextResponse.json(
        { error: `Pipeline ${match.pipelineId} has no Demo In Progress stage configured` },
        { status: 422 }
      );
    }

    // Already in Demo In Progress — no-op
    if (match.pipelineStageId === stageId) {
      return NextResponse.json({ success: true, alreadyInStage: true, opportunityId: match.id });
    }

    await ghl.put(`/opportunities/${match.id}`, { pipelineStageId: stageId });

    return NextResponse.json({
      success: true,
      opportunityId: match.id,
      contactName: match.contact?.name,
      pipelineId: match.pipelineId,
      stageId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/ghl/opportunities/demo-in-progress]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
