import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { commentLeads } from "@/lib/db/schema";
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
  return (url ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").trim();
}

function domainsMatch(a: string, b: string): boolean {
  const na = normaliseDomain(a);
  const nb = normaliseDomain(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Paginate all GHL opportunities — same pattern as contacts route
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

  try {
    const database = db();

    // ── 1. Check comment leads in Postgres first ─────────────────────────────
    const clRows = await database.select().from(commentLeads);
    const clMatch = clRows.find((cl) => cl.website && domainsMatch(cl.website, website));

    if (clMatch) {
      await database
        .update(commentLeads)
        .set({ demoStartedAt: new Date() })
        .where(eq(commentLeads.id, clMatch.id));

      return NextResponse.json({
        success: true,
        source: "comment_lead",
        commentLeadId: clMatch.id,
        contactName: clMatch.name,
        website: clMatch.website,
      });
    }

    // ── 2. Check GHL pipeline opportunities ──────────────────────────────────
    const allOpps = await fetchAllOpportunities();

    const oppMatch = allOpps.find((o) =>
      o.contact?.companyName && domainsMatch(o.contact.companyName, website)
    );

    if (!oppMatch) {
      return NextResponse.json(
        { error: `No contact found matching website: ${website}` },
        { status: 404 }
      );
    }

    const stageId = DEMO_IN_PROGRESS_STAGE[oppMatch.pipelineId];
    if (!stageId) {
      return NextResponse.json(
        { error: `Pipeline ${oppMatch.pipelineId} has no Demo In Progress stage configured` },
        { status: 422 }
      );
    }

    // Already in Demo In Progress — no-op
    if (oppMatch.pipelineStageId === stageId) {
      return NextResponse.json({
        success: true,
        alreadyInStage: true,
        source: "ghl",
        opportunityId: oppMatch.id,
      });
    }

    await ghl.put(`/opportunities/${oppMatch.id}`, { pipelineStageId: stageId });

    return NextResponse.json({
      success: true,
      source: "ghl",
      opportunityId: oppMatch.id,
      contactName: oppMatch.contact?.name,
      pipelineId: oppMatch.pipelineId,
      stageId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/ghl/opportunities/demo-in-progress]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
