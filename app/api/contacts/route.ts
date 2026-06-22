import { NextRequest, NextResponse } from "next/server";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { commentLeads, brandCategories, demoGhlLinks, proposals, localContacts } from "@/lib/db/schema";
import { ghl, locationId } from "@/lib/ghl/client";
import { fetchAllOpportunities } from "@/lib/ghl/paginate";
import { daysAgo } from "@/lib/utils/date";
import type { UnifiedContact } from "@/lib/contacts/types";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

interface FilterRule {
  id: string;
  field: string;
  operator: string;
  values: string[];
  connector?: "and" | "or";
}

function applyRule(c: UnifiedContact, rule: FilterRule): boolean {
  const { field, operator, values } = rule;
  switch (field) {
    case "name": {
      const name = c.name.toLowerCase();
      const val = (values[0] ?? "").toLowerCase();
      if (operator === "contains")     return name.includes(val);
      if (operator === "not_contains") return !name.includes(val);
      if (operator === "is")           return name === val;
      return true;
    }
    case "email": {
      const email = (c.email ?? "").toLowerCase();
      const val = (values[0] ?? "").toLowerCase();
      if (operator === "contains")     return email.includes(val);
      if (operator === "not_contains") return !email.includes(val);
      return true;
    }
    case "source":
      if (operator === "is_any_of")  return values.includes(c.source);
      if (operator === "is_none_of") return !values.includes(c.source);
      return true;
    case "pipelineId":
      if (operator === "is_any_of")  return c.pipelineId != null && values.includes(c.pipelineId);
      if (operator === "is_none_of") return c.pipelineId == null || !values.includes(c.pipelineId);
      return true;
    case "stageId":
      if (operator === "is_any_of")  return c.stageId != null && values.includes(c.stageId);
      if (operator === "is_none_of") return c.stageId == null || !values.includes(c.stageId);
      return true;
    case "brandCategory":
      if (operator === "is_any_of")  return c.brandCategory != null && values.includes(c.brandCategory);
      if (operator === "is_none_of") return c.brandCategory == null || !values.includes(c.brandCategory);
      return true;
    case "hasDemo":
      if (operator === "is_any_of")  return values.map((v) => v === "true").includes(c.hasDemo);
      if (operator === "is_none_of") return !values.map((v) => v === "true").includes(c.hasDemo);
      return true;
    case "daysSinceLastTouch": {
      const n = Number(values[0] ?? 0);
      if (operator === "gt") return c.daysSinceLastTouch > n;
      if (operator === "lt") return c.daysSinceLastTouch < n;
      if (operator === "is") return c.daysSinceLastTouch === n;
      return true;
    }
    case "platform":
      if (operator === "is_any_of")  return c.platform != null && values.includes(c.platform);
      if (operator === "is_none_of") return c.platform == null || !values.includes(c.platform);
      return true;
    case "channel":
      if (operator === "is_any_of")  return c.lastChannel != null && values.includes(c.lastChannel);
      if (operator === "is_none_of") return c.lastChannel == null || !values.includes(c.lastChannel);
      return true;
    case "assignedTo": {
      // "__unassigned__" matches contacts with no rep
      const wantsUnassigned = values.includes("__unassigned__");
      const match = (c.assignedTo != null && values.includes(c.assignedTo)) || (wantsUnassigned && c.assignedTo == null);
      if (operator === "is_any_of")  return match;
      if (operator === "is_none_of") return !match;
      return true;
    }
    case "hasProposal":
      if (operator === "is_any_of")  return values.map((v) => v === "true").includes(c.hasProposal);
      if (operator === "is_none_of") return !values.map((v) => v === "true").includes(c.hasProposal);
      return true;
    case "daysInCurrentStage": {
      if (c.daysInCurrentStage == null) return false;
      const n = Number(values[0] ?? 0);
      if (operator === "gt") return c.daysInCurrentStage > n;
      if (operator === "lt") return c.daysInCurrentStage < n;
      if (operator === "is") return c.daysInCurrentStage === n;
      return true;
    }
    case "reachableChannels": {
      const hasEmail = c.reachableChannels?.includes("email") ?? false;
      const hasSms = c.reachableChannels?.includes("sms") ?? false;
      const matchesOne = (v: string) =>
        v === "email_only" ? hasEmail && !hasSms :
        v === "sms_only"   ? hasSms && !hasEmail :
        v === "both"       ? hasEmail && hasSms :
        false;
      const match = values.some(matchesOne);
      if (operator === "is_any_of")  return match;
      if (operator === "is_none_of") return !match;
      return true;
    }
    case "urgency": {
      // single bucket value: today | 3to5 | 7plus | "<number>" (custom: at least N days)
      const v = values[0] ?? "";
      const d = c.daysSinceLastTouch;
      if (v === "today")  return d === 0;
      if (v === "3to5")   return d >= 3 && d <= 5;
      if (v === "7plus")  return d >= 7;
      const n = Number(v);
      if (!Number.isNaN(n) && v !== "") return d >= n;
      return true;
    }
    default:
      return true;
  }
}

// AND before OR: split rules at OR boundaries into AND-groups, then union the results.
function applyRules(all: UnifiedContact[], rules: FilterRule[]): UnifiedContact[] {
  if (!rules.length) return all;

  // Build AND-groups: a new group starts whenever a rule has connector="or"
  const groups: FilterRule[][] = [[rules[0]]];
  for (let i = 1; i < rules.length; i++) {
    if (rules[i].connector === "or") groups.push([rules[i]]);
    else groups[groups.length - 1].push(rules[i]);
  }

  // Each group: contacts must pass ALL rules in the group (AND)
  // Final result: union across groups (OR between groups)
  const seen = new Set<string>();
  const result: UnifiedContact[] = [];
  for (const group of groups) {
    for (const c of all) {
      if (!seen.has(c.uid) && group.every((r) => applyRule(c, r))) {
        seen.add(c.uid);
        result.push(c);
      }
    }
  }
  return result;
}

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ─── Channel label helper ─────────────────────────────────────────────────────

function channelLabel(type: string): string {
  const t = type.toUpperCase();
  if (t.includes("SMS"))       return "SMS";
  if (t.includes("EMAIL"))     return "Email";
  if (t.includes("INSTAGRAM")) return "Instagram";
  if (t.includes("FB") || t.includes("FACEBOOK")) return "Facebook";
  if (t.includes("WHATSAPP"))  return "WhatsApp";
  if (t.includes("CALL"))      return "Call";
  if (t.includes("TIKTOK"))    return "TikTok";
  return "Unknown";
}

// ─── Conversations cache (3-min TTL) — contactId → last channel ───────────────

let _convMap: Map<string, string> | null = null;
let _convAt = 0;
const CONV_TTL = 3 * 60 * 1000;

async function getConversationChannelMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (_convMap && now - _convAt < CONV_TTL) return _convMap;

  const map = new Map<string, string>();
  try {
    const locId = locationId();
    const MAX_ROUNDS = 20;
    let lastId: string | undefined;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const cursor = lastId ? `&lastId=${lastId}` : "";
      const data = await ghl.get<{
        conversations: Array<{ id: string; contactId: string; type: string }>;
        meta?: { total?: number; currentPage?: number; nextPage?: boolean };
      }>(
        `/conversations/search?locationId=${locId}&limit=100&sortBy=last_message_date&sortOrder=desc${cursor}`
      );
      const batch = data.conversations ?? [];
      for (const conv of batch) {
        // First entry per contactId wins (sorted by most recent)
        if (conv.contactId && !map.has(conv.contactId)) {
          map.set(conv.contactId, channelLabel(conv.type ?? ""));
        }
      }
      if (batch.length < 100) break;
      // Advance cursor to the last conversation's ID for the next round
      lastId = batch[batch.length - 1]?.id;
      if (!lastId) break;
    }
    _convMap = map;
    _convAt = Date.now();
  } catch (err) {
    console.error("[contacts] getConversationChannelMap error:", err);
    _convMap = _convMap ?? map;
  }

  return _convMap!;
}

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

    // Fetch EVERY opportunity across all pipelines (all pages) — the contacts
    // list and its total count must not silently cap at the first N.
    const allOpps = await fetchAllOpportunities(`/opportunities/search?location_id=${locId}`);

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
  const pipelineFilter = searchParams.get("pipelineId");
  const stageFilter2 = searchParams.get("stageId");
  const sortBy = searchParams.get("sortBy") ?? "createdAt";
  const sortOrder = (searchParams.get("sortOrder") ?? "desc") as "asc" | "desc";
  const rulesParam = searchParams.get("rules");
  const rules: FilterRule[] = rulesParam ? (() => { try { return JSON.parse(rulesParam); } catch { return []; } })() : [];

  try {
    const database = db();

    const [allOpps, clRows, catRows, demoRows, convMap, proposalRows, dndRows] = await Promise.all([
      getAllOpportunities(),
      database.select().from(commentLeads).orderBy(desc(commentLeads.createdAt)),
      database.select().from(brandCategories),
      database.select({ ghlContactId: demoGhlLinks.ghlContactId }).from(demoGhlLinks),
      getConversationChannelMap(),
      database.select({ ghlContactId: proposals.ghlContactId, status: proposals.status }).from(proposals).where(isNotNull(proposals.ghlContactId)),
      database.select({ id: localContacts.id, dnd: localContacts.dnd }).from(localContacts),
    ]);

    const catMap = new Map(catRows.map((r) => [r.domain, r.category]));
    const demoContactIds = new Set(demoRows.map((r) => r.ghlContactId).filter(Boolean) as string[]);

    // Proposal status per contact (best status wins: paid > signed > sent > draft)
    const proposalMap = new Map<string, string>();
    const statusPriority: Record<string, number> = { paid: 5, signed: 4, partial: 3, sent: 2, draft: 1 };
    for (const p of proposalRows) {
      if (!p.ghlContactId) continue;
      const existing = proposalMap.get(p.ghlContactId);
      if (!existing || (statusPriority[p.status] ?? 0) > (statusPriority[existing] ?? 0)) {
        proposalMap.set(p.ghlContactId, p.status);
      }
    }

    // DND map
    const dndMap = new Map(dndRows.filter((r) => r.dnd).map((r) => [r.id, true]));

    // ─── GHL contacts: one UnifiedContact per unique contact from opportunities ─
    const seenContactIds = new Set<string>();
    const ghlUnified: UnifiedContact[] = [];

    for (const opp of allOpps) {
      const c = opp.contact;
      if (!c?.id || seenContactIds.has(c.id)) continue;
      seenContactIds.add(c.id);

      const createdAt = c.dateAdded ?? opp.createdAt;
      const lastActivityAt = opp.updatedAt ?? createdAt;
      const domain = (c.companyName ?? "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
      const category = domain ? (catMap.get(domain) as UnifiedContact["brandCategory"] ?? null) : null;

      const daysSince = daysAgo(lastActivityAt);
      const stageChangeAt = opp.lastStatusChangeAt ?? opp.createdAt;
      const daysInStage = daysAgo(stageChangeAt);
      const channels: string[] = [];
      if (c.email) channels.push("email");
      if (c.phone) channels.push("sms");

      // Response status derivation
      let responseStatus: UnifiedContact["responseStatus"] = null;
      if (daysSince >= 7) responseStatus = "no_response";
      else if (daysSince <= 2) responseStatus = "replied";
      else responseStatus = "awaiting_reply";

      const propStatus = proposalMap.get(c.id) ?? null;

      ghlUnified.push({
        uid: `ghl_${c.id}`,
        source: "ghl",
        name: c.name ?? "Unknown",
        email: c.email ?? null,
        phone: c.phone ?? null,
        website: c.website ?? null,
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
        hasProposal: !!propStatus,
        proposalStatus: propStatus,
        awaitingReply: false,
        lastChannel: convMap.get(c.id) ?? null,
        daysSinceLastTouch: daysSince,
        daysInCurrentStage: daysInStage,
        lastActivityAt,
        createdAt,
        assignedTo: opp.assignedTo ?? null,
        dnd: dndMap.has(c.id),
        responseStatus,
        reachableChannels: channels,
      });
    }

    // ─── Comment leads → UnifiedContact ──────────────────────────────────────
    const clUnified: UnifiedContact[] = clRows.map((cl) => {
      const createdAt = cl.createdAt.toISOString();
      const lastActivityAt = cl.contactedAt?.toISOString() ?? createdAt;
      const domain = (cl.website ?? "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
      const category = domain ? (catMap.get(domain) as UnifiedContact["brandCategory"] ?? null) : null;

      const clDaysSince = daysAgo(lastActivityAt);
      const clChannels: string[] = [];
      if (cl.email) clChannels.push("email");
      if (cl.phone) clChannels.push("sms");

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
        hasProposal: false,
        proposalStatus: null,
        awaitingReply: !cl.contactedAt,
        lastChannel: null,
        daysSinceLastTouch: clDaysSince,
        daysInCurrentStage: null,
        lastActivityAt,
        createdAt,
        assignedTo: null,
        dnd: false,
        responseStatus: !cl.contactedAt ? "awaiting_reply" : clDaysSince >= 7 ? "no_response" : "replied",
        reachableChannels: clChannels,
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
    if (sourceFilter)   all = all.filter((c) => c.source === sourceFilter);
    if (stageFilter)    all = all.filter((c) => c.stage === stageFilter);
    if (categoryFilter) all = all.filter((c) => c.brandCategory === categoryFilter);
    if (hasDemoFilter === "true")  all = all.filter((c) => c.hasDemo);
    if (hasDemoFilter === "false") all = all.filter((c) => !c.hasDemo);
    if (pipelineFilter) all = all.filter((c) => c.pipelineId === pipelineFilter);
    if (stageFilter2)   all = all.filter((c) => c.stageId === stageFilter2);
    all = applyRules(all, rules);

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
