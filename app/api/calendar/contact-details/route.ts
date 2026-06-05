import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  website?: string;
  tags?: string[];
  source?: string;
  customFields?: Array<{ id: string; value: string }>;
  customField?: Array<{ id: string; value: string }>;
}

interface GHLNote {
  id: string;
  body: string;
}

interface GHLPipeline {
  id: string;
  stages: Array<{ id: string; name: string }>;
}

/**
 * GET /api/calendar/contact-details?contactId=xxx
 *
 * Fetches contact, notes, and opportunity in parallel for the event panel.
 * Single endpoint to avoid three separate client-side fetches.
 */
export async function GET(req: NextRequest) {
  const contactId = req.nextUrl.searchParams.get("contactId");
  if (!contactId) {
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }

  const loc = locationId();

  const [contactRes, notesRes, oppsRes] = await Promise.allSettled([
    ghl.get<{ contact: GHLContact }>(`/contacts/${contactId}`),
    ghl.get<{ notes: GHLNote[] }>(`/contacts/${contactId}/notes/`),
    ghl.get<{ opportunities: GHLOpportunity[] }>(
      `/opportunities/search?location_id=${loc}&contact_id=${contactId}&limit=3`,
    ),
  ]);

  // Contact — GHL v2 returns the contact directly (not nested)
  let contact: GHLContact | null = null;
  if (contactRes.status === "fulfilled") {
    const raw = contactRes.value;
    // Handle both { contact: {...} } and direct {...} response shapes
    contact = (raw as { contact?: GHLContact }).contact ?? (raw as unknown as GHLContact);
  }

  // Notes
  const notes: GHLNote[] =
    notesRes.status === "fulfilled" ? notesRes.value.notes ?? [] : [];

  // Opportunity — pick the first open one, or the first overall
  let opportunity: GHLOpportunity | null = null;
  if (oppsRes.status === "fulfilled") {
    const opps = oppsRes.value.opportunities ?? [];
    opportunity = opps.find((o) => o.status === "open") ?? opps[0] ?? null;

    // Resolve stage name if we have an opportunity
    if (opportunity && !opportunity.pipelineStageId_name) {
      try {
        const pipelineData = await ghl.get<{ pipelines: GHLPipeline[] }>(
          `/opportunities/pipelines?locationId=${loc}`,
        );
        const pipeline = (pipelineData.pipelines ?? []).find(
          (p) => p.id === opportunity!.pipelineId,
        );
        if (pipeline) {
          const stage = pipeline.stages.find(
            (s) => s.id === opportunity!.pipelineStageId,
          );
          if (stage) opportunity.pipelineStageId_name = stage.name;
        }
      } catch {
        // Non-blocking — stage name is nice-to-have
      }
    }
  }

  return NextResponse.json({ contact, notes, opportunity });
}
