import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { commentLeads } from "@/lib/db/schema";
import type { GHLOpportunity } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

const DEMO_IN_PROGRESS_STAGE: Record<string, string> = {
  JRvrpfcwAlAOM38mPAUJ:   "ffd18e7a-a59e-4a13-894d-d5371d0bfc90", // Email Design Demo Pipeline (AD FUNNEL)
  uEefctNze07YOCaGOSNE:   "4e3b0980-9eb9-4d7d-9f4d-cf0dbac04ff8", // Email Design Demo Pipeline (ORGANIC FUNNEL)
  "9pk3LOPFgZucx0Q13Spj": "dc8cda15-0d9c-44d1-bf16-e8d9a82d921d", // Kracked Retention General Pipeline (MAIN WEBSITE)
  tZ2jrSx9nurGp08CWxWU:   "013d35a0-c062-423f-884a-9afa96716f36", // Taylor's TikTok Pipeline
};

function normaliseDomain(url: string): string {
  return (url ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").trim();
}

export async function POST(req: NextRequest) {
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const website: string = body.website ?? body["Website"] ?? "";
  const opportunityId: string = body.opportunityId ?? body["Opportunity ID"] ?? "";
  const commentLeadId: string = body.commentLeadId ?? body["Comment Lead ID"] ?? "";
  const contactId: string = body.contactId ?? "";

  if (!website && !opportunityId && !commentLeadId && !contactId) {
    return NextResponse.json({ error: "website, opportunityId, commentLeadId, or contactId is required" }, { status: 400 });
  }

  try {
    const database = db();
    const locId = locationId();

    // ── Path A: opportunityId provided directly — fastest, most reliable ──────
    if (opportunityId) {
      const oppData = await ghl.get<{ opportunity: GHLOpportunity }>(
        `/opportunities/${opportunityId}`
      );
      const opp = oppData.opportunity;
      if (!opp) {
        return NextResponse.json({ error: `Opportunity ${opportunityId} not found` }, { status: 404 });
      }
      const stageId = DEMO_IN_PROGRESS_STAGE[opp.pipelineId];
      if (!stageId) {
        return NextResponse.json(
          { error: `No Demo In Progress stage configured for pipeline ${opp.pipelineId}` },
          { status: 422 }
        );
      }
      if (opp.pipelineStageId === stageId) {
        return NextResponse.json({ success: true, alreadyInStage: true, source: "ghl_direct", opportunityId });
      }
      await ghl.put(`/opportunities/${opportunityId}`, { pipelineStageId: stageId });
      return NextResponse.json({ success: true, source: "ghl_direct", opportunityId, pipelineId: opp.pipelineId, stageId });
    }

    // ── Path B: commentLeadId provided — direct Postgres update, no GHL needed ─
    if (commentLeadId) {
      const clRow = await database.select().from(commentLeads).where(eq(commentLeads.id, commentLeadId));
      if (!clRow.length) {
        return NextResponse.json({ error: `Comment lead ${commentLeadId} not found` }, { status: 404 });
      }
      await database
        .update(commentLeads)
        .set({ demoStartedAt: new Date() })
        .where(eq(commentLeads.id, commentLeadId));
      return NextResponse.json({ success: true, source: "comment_lead_direct", commentLeadId, contactName: clRow[0].name });
    }

    // ── Path D: contactId provided — skip contact search, find their opp ──────
    if (contactId) {
      const oppSearch = await ghl.get<{ opportunities: GHLOpportunity[] }>(
        `/opportunities/search?location_id=${locId}&contact_id=${contactId}&limit=10`
      );
      const opp = (oppSearch.opportunities ?? []).find((o) => DEMO_IN_PROGRESS_STAGE[o.pipelineId]);
      if (!opp) {
        return NextResponse.json(
          { error: `No pipeline opportunity found for contact ${contactId}` },
          { status: 404 }
        );
      }
      const stageId = DEMO_IN_PROGRESS_STAGE[opp.pipelineId];
      if (opp.pipelineStageId === stageId) {
        return NextResponse.json({ success: true, alreadyInStage: true, source: "ghl_contact", opportunityId: opp.id });
      }
      await ghl.put(`/opportunities/${opp.id}`, { pipelineStageId: stageId });
      return NextResponse.json({ success: true, source: "ghl_contact", opportunityId: opp.id, contactId, pipelineId: opp.pipelineId, stageId });
    }

    // ── Path C: website lookup ────────────────────────────────────────────────
    const searchDomain = normaliseDomain(website);

    // C1. Comment leads (Postgres) — match on stored website field exactly
    const clRows = await database.select().from(commentLeads);
    const clMatch = clRows.find(
      (cl) => cl.website && normaliseDomain(cl.website) === searchDomain
    );

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

    // C2. GHL contacts — three strategies, most reliable first:
    //   a) POST /contacts/search with website field filter
    //   b) GET query by @domain (email domain match) — email IS indexed
    //   c) GET query by bare domain — catches contacts whose name/company contains the domain
    type GHLContactRow = { id: string; website?: string; email?: string; firstName?: string; lastName?: string };

    let matchedContact: GHLContactRow | undefined;

    // Strategy a: POST search with website filter
    try {
      const postSearch = await ghl.post<{ contacts: GHLContactRow[] }>(
        `/contacts/search?locationId=${locId}`,
        { filters: [{ field: "website", operator: "eq", value: website }], limit: 5 }
      );
      matchedContact = (postSearch.contacts ?? []).find(
        (c) => c.website && normaliseDomain(c.website) === searchDomain
      );
    } catch {
      // POST search not available or failed — fall through to strategy b
    }

    // Strategy b: email domain search — search "@example.com", GHL indexes email
    if (!matchedContact) {
      const emailQuery = `@${searchDomain}`;
      const emailSearch = await ghl.get<{ contacts: GHLContactRow[] }>(
        `/contacts/?locationId=${locId}&query=${encodeURIComponent(emailQuery)}&limit=50`
      );
      matchedContact = (emailSearch.contacts ?? []).find(
        (c) => c.website && normaliseDomain(c.website) === searchDomain
      );
      // If no website field set, fall back to any contact whose email domain matches
      if (!matchedContact) {
        matchedContact = (emailSearch.contacts ?? []).find(
          (c) => c.email && normaliseDomain(c.email.replace(/^[^@]+@/, "")) === searchDomain
        );
      }
    }

    // Strategy c: bare domain query (may hit company name / contact name)
    if (!matchedContact) {
      const domainSearch = await ghl.get<{ contacts: GHLContactRow[] }>(
        `/contacts/?locationId=${locId}&query=${encodeURIComponent(searchDomain)}&limit=50`
      );
      matchedContact = (domainSearch.contacts ?? []).find(
        (c) => c.website && normaliseDomain(c.website) === searchDomain
      );
    }

    if (!matchedContact) {
      return NextResponse.json(
        { error: `No contact found with website: ${website}` },
        { status: 404 }
      );
    }

    // C3. Find the opportunity for that contact
    const oppSearch = await ghl.get<{ opportunities: GHLOpportunity[] }>(
      `/opportunities/search?location_id=${locId}&contact_id=${matchedContact.id}&limit=10`
    );

    const opp = (oppSearch.opportunities ?? []).find(
      (o) => DEMO_IN_PROGRESS_STAGE[o.pipelineId]
    );

    if (!opp) {
      return NextResponse.json(
        { error: `No pipeline opportunity found for contact ${matchedContact.id}` },
        { status: 404 }
      );
    }

    const stageId = DEMO_IN_PROGRESS_STAGE[opp.pipelineId];

    if (opp.pipelineStageId === stageId) {
      return NextResponse.json({ success: true, alreadyInStage: true, source: "ghl", opportunityId: opp.id });
    }

    await ghl.put(`/opportunities/${opp.id}`, { pipelineStageId: stageId });

    return NextResponse.json({
      success: true,
      source: "ghl",
      opportunityId: opp.id,
      contactId: matchedContact.id,
      pipelineId: opp.pipelineId,
      stageId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/ghl/opportunities/demo-in-progress]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
