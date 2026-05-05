import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { commentLeads, brandCategories, demoGhlLinks } from "@/lib/db/schema";
import { ghl, locationId } from "@/lib/ghl/client";
import { daysAgo } from "@/lib/utils/date";
import type { UnifiedContact } from "@/lib/contacts/types";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ─── All-pipelines opportunity cache (3-min TTL) ──────────────────────────────
interface EnrichedOpp extends GHLOpportunity {
  pipelineStageId_name: string;
}

let _opps: EnrichedOpp[] | null = null;
let _oppsAt = 0;
const OPPS_TTL = 3 * 60 * 1000;

async function getAllOpportunities(): Promise<EnrichedOpp[]> {
  const now = Date.now();
  if (_opps && now - _oppsAt < OPPS_TTL) return _opps;

  try {
    const locId = locationId();

    // Fetch all pipelines so we can build a stageId → stageName map
    const pipelinesData = await ghl.get<{ pipelines: GHLPipeline[] }>(
      `/opportunities/pipelines?locationId=${locId}`
    );

    const stageMap: Record<string, string> = {};
    const pipelineIds: string[] = [];
    for (const p of pipelinesData.pipelines ?? []) {
      pipelineIds.push(p.id);
      for (const s of p.stages ?? []) {
        stageMap[s.id] = s.name;
      }
    }

    // Fetch all opportunities (across all pipelines), paginated
    const allOpps: GHLOpportunity[] = [];
    const MAX_PAGES = 20;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await ghl.get<{ opportunities: GHLOpportunity[]; meta?: { total?: number } }>(
        `/opportunities/search?location_id=${locId}&limit=100&page=${page}`
      );
      const batch = data.opportunities ?? [];
      allOpps.push(...batch);
      if (batch.length < 100) break;
    }

    _opps = allOpps.map((o) => ({
      ...o,
      pipelineStageId_name: stageMap[o.pipelineStageId] ?? "Unknown Stage",
    }));
    _oppsAt = Date.now();
  } catch (err) {
    console.error("[contacts] getOpportunities error:", err);
    _opps = _opps ?? [];
  }

  return _opps!;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(100, parseInt(searchParams.get("pageSize") ?? "50", 10));
  const search = (searchParams.get("search") ?? "").toLowerCase().trim();
  const sourceFilter = searchParams.get("source");
  const stageFilter = searchParams.get("stage");
  const categoryFilter = searchParams.get("category");
  const hasDemoFilter = searchParams.get("hasDemo");
  const sortBy = searchParams.get("sortBy") ?? "createdAt";
  const sortOrder = (searchParams.get("sortOrder") ?? "desc") as "asc" | "desc";

  try {
    const database = db();

    const [allOpps, clRows, catRows, demoRows] = await Promise.all([
      getAllOpportunities(),
      database.select().from(commentLeads).orderBy(desc(commentLeads.createdAt)),
      database.select().from(brandCategories),
      database.select({ ghlContactId: demoGhlLinks.ghlContactId }).from(demoGhlLinks),
    ]);

    const catMap = new Map(catRows.map((r) => [r.domain, r.category]));
    const demoContactIds = new Set(demoRows.map((r) => r.ghlContactId).filter(Boolean) as string[]);

    // ─── GHL contacts: one UnifiedContact per unique contact from opportunities ─
    const seenContactIds = new Set<string>();
    const ghlUnified: UnifiedContact[] = [];

    for (const opp of allOpps) {
      const c = opp.contact;
      if (!c?.id || seenContactIds.has(c.id)) continue;
      seenContactIds.add(c.id);

      const createdAt = opp.createdAt;
      const lastActivityAt = opp.updatedAt ?? createdAt;
      const domain = (c.companyName ?? "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
      const category = domain ? (catMap.get(domain) as UnifiedContact["brandCategory"] ?? null) : null;

      ghlUnified.push({
        uid: `ghl_${c.id}`,
        source: "ghl",
        name: c.name ?? "Unknown",
        email: c.email ?? null,
        phone: c.phone ?? null,
        website: null, // fetched lazily in the modal from notes
        platform: "lead_form",
        ghlContactId: c.id,
        opportunityId: opp.id,
        stage: opp.pipelineStageId_name,
        stageId: opp.pipelineStageId,
        pipelineId: opp.pipelineId,
        opportunityStatus: opp.status,
        monetaryValue: opp.monetaryValue ?? null,
        tags: c.tags ?? [],
        commentLeadId: null,
        commentText: null,
        brandCategory: category,
        hasDemo: demoContactIds.has(c.id),
        awaitingReply: false,
        daysSinceLastTouch: daysAgo(lastActivityAt),
        lastActivityAt,
        createdAt,
      });
    }

    // ─── Comment leads → UnifiedContact ──────────────────────────────────────
    const clUnified: UnifiedContact[] = clRows.map((cl) => {
      const createdAt = cl.createdAt.toISOString();
      const lastActivityAt = cl.contactedAt?.toISOString() ?? createdAt;
      const domain = (cl.website ?? "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
      const category = domain ? (catMap.get(domain) as UnifiedContact["brandCategory"] ?? null) : null;

      return {
        uid: `cl_${cl.id}`,
        source: "comment_lead" as const,
        name: cl.name,
        email: cl.email ?? null,
        phone: cl.phone ?? null,
        website: cl.website ?? null,
        platform: cl.platform as UnifiedContact["platform"],
        ghlContactId: null,
        opportunityId: null,
        stage: cl.demoStartedAt ? "Demo In Progress" : cl.contactedAt ? "Initial Contact Made" : "New Lead",
        stageId: null,
        pipelineId: null,
        opportunityStatus: null,
        monetaryValue: null,
        tags: [],
        commentLeadId: cl.id,
        commentText: cl.commentText,
        brandCategory: category,
        hasDemo: false,
        awaitingReply: false,
        daysSinceLastTouch: daysAgo(lastActivityAt),
        lastActivityAt,
        createdAt,
      };
    });

    let all: UnifiedContact[] = [...ghlUnified, ...clUnified];

    // ─── Filters ──────────────────────────────────────────────────────────────
    if (search) {
      all = all.filter((c) =>
        c.name.toLowerCase().includes(search) ||
        (c.email ?? "").toLowerCase().includes(search) ||
        (c.phone ?? "").toLowerCase().includes(search) ||
        (c.website ?? "").toLowerCase().includes(search) ||
        (c.stage ?? "").toLowerCase().includes(search)
      );
    }
    if (sourceFilter) all = all.filter((c) => c.source === sourceFilter);
    if (stageFilter)  all = all.filter((c) => c.stage === stageFilter);
    if (categoryFilter) all = all.filter((c) => c.brandCategory === categoryFilter);
    if (hasDemoFilter === "true")  all = all.filter((c) => c.hasDemo);
    if (hasDemoFilter === "false") all = all.filter((c) => !c.hasDemo);

    // ─── Sort ─────────────────────────────────────────────────────────────────
    all.sort((a, b) => {
      let av: string | number = 0, bv: string | number = 0;
      if (sortBy === "createdAt")          { av = a.createdAt;          bv = b.createdAt; }
      else if (sortBy === "lastActivityAt"){ av = a.lastActivityAt;     bv = b.lastActivityAt; }
      else if (sortBy === "name")          { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (sortBy === "daysSinceLastTouch") { av = a.daysSinceLastTouch; bv = b.daysSinceLastTouch; }
      else if (sortBy === "source")        { av = a.source;               bv = b.source; }
      else if (sortBy === "stage")         { av = (a.stage ?? "").toLowerCase(); bv = (b.stage ?? "").toLowerCase(); }
      if (av < bv) return sortOrder === "asc" ? -1 : 1;
      if (av > bv) return sortOrder === "asc" ? 1  : -1;
      return 0;
    });

    const total = all.length;
    const contacts = all.slice((page - 1) * pageSize, page * pageSize);

    return NextResponse.json({ contacts, total, page, pageSize });
  } catch (err) {
    console.error("[GET /api/contacts]", err);
    return NextResponse.json({ error: "Failed to fetch contacts" }, { status: 500 });
  }
}
