import { NextRequest, NextResponse } from "next/server";
import { desc, isNotNull, and, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { urlKey } from "@/lib/utils/url";
import { socialLeads, brandCategories, demoGhlLinks, proposals, localContacts, audits, followupSends } from "@/lib/db/schema";
import { ghl, locationId } from "@/lib/ghl/client";
import { fetchAllOpportunities } from "@/lib/ghl/paginate";
import { getOpportunitiesFromMirror, getConversationMapFromMirror } from "@/lib/contacts/mirror-source";
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
    case "pipelineId": {
      const ids = (c.oppRefs?.map((r) => r.pipelineId) ?? [c.pipelineId]).filter((x): x is string => !!x);
      if (operator === "is_any_of")  return ids.some((id) => values.includes(id));
      if (operator === "is_none_of") return !ids.some((id) => values.includes(id));
      return true;
    }
    case "stageId": {
      const ids = (c.oppRefs?.map((r) => r.stageId) ?? [c.stageId]).filter((x): x is string => !!x);
      if (operator === "is_any_of")  return ids.some((id) => values.includes(id));
      if (operator === "is_none_of") return !ids.some((id) => values.includes(id));
      return true;
    }
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
    case "auditDelivered": {
      const delivered = c.auditStatus === "delivered";
      if (operator === "is_any_of")  return values.map((v) => v === "true").includes(delivered);
      if (operator === "is_none_of") return !values.map((v) => v === "true").includes(delivered);
      return true;
    }
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
    case "stageName": {
      const match = c.stage != null && values.includes(c.stage);
      if (operator === "is_any_of") return match;
      if (operator === "is_none_of") return !match;
      return true;
    }
    case "inSequence": {
      const inSeq = c.autoSequence || !!c.followupScheduledAt;
      const want = values[0] !== "false";
      if (operator === "is_any_of") return inSeq === want;
      if (operator === "is_none_of") return inSeq !== want;
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

// ─── Conversations cache (3-min TTL) — contactId → channel + automation signal ─
// We also read `lastOutboundMessageAction` ("automated" = a GHL workflow/sequence
// sent the last outbound, vs "manual" = a human), the only readable GHL signal for
// "this contact is being worked by an automation". Costs zero extra calls — we
// already page every conversation here.

interface ConvInfo { channel: string; autoAction: string | null; lastMessageAt: number | null }

let _convMap: Map<string, ConvInfo> | null = null;
let _convAt = 0;
const CONV_TTL = 3 * 60 * 1000;

async function getConversationChannelMap(): Promise<Map<string, ConvInfo>> {
  const now = Date.now();
  if (_convMap && now - _convAt < CONV_TTL) return _convMap;

  const map = new Map<string, ConvInfo>();
  try {
    const locId = locationId();
    const MAX_ROUNDS = 20;
    let lastId: string | undefined;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const cursor = lastId ? `&lastId=${lastId}` : "";
      const data = await ghl.get<{
        conversations: Array<{ id: string; contactId: string; type: string; lastOutboundMessageAction?: string; lastMessageDate?: number }>;
        meta?: { total?: number; currentPage?: number; nextPage?: boolean };
      }>(
        `/conversations/search?locationId=${locId}&limit=100&sortBy=last_message_date&sortOrder=desc${cursor}`
      );
      const batch = data.conversations ?? [];
      for (const conv of batch) {
        // First entry per contactId wins (sorted by most recent)
        if (conv.contactId && !map.has(conv.contactId)) {
          map.set(conv.contactId, {
            channel: channelLabel(conv.type ?? ""),
            autoAction: conv.lastOutboundMessageAction ?? null,
            lastMessageAt: conv.lastMessageDate ? new Date(conv.lastMessageDate).getTime() : null,
          });
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
  /** Exact contact lookup, e.g. "ghl_abc123". Bypasses fuzzy search entirely — see the filter below. */
  const uidFilter = (searchParams.get("uid") ?? "").trim();
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

  // Opportunities: default to the local mirror. Verified against GHL's authoritative
  // per-record reads to be as accurate or MORE accurate than the live /opportunities/search
  // scrape (which intermittently omits open opps + serves stale stages), and ~6x faster.
  // `?feed=live` re-scrapes GHL as a rollback lever. Conversations also default to the mirror:
  // GHL's /conversations/search is hard-capped at 100 (cursor ignored, meta null), so the mirror
  // (~291 rows accumulated via webhooks) is a strict superset with identical autoSequence parity.
  // `?convFeed=live` forces the old 100-cap scrape. NOTE: `feed`/`convFeed` are distinct from the
  // `source` filter (c.source).
  const oppsFeed = searchParams.get("feed") === "live" ? "live" : "mirror";
  const convFeed = searchParams.get("convFeed") === "live" ? "live" : "mirror";

  try {
    const database = db();

    const [allOpps, clRows, catRows, demoRows, convMap, proposalRows, dndRows, auditRows, followupRows] = await Promise.all([
      oppsFeed === "live" ? getAllOpportunities() : getOpportunitiesFromMirror(),
      database.select().from(socialLeads).orderBy(desc(socialLeads.createdAt)),
      database.select().from(brandCategories),
      database.select({ ghlContactId: demoGhlLinks.ghlContactId }).from(demoGhlLinks),
      convFeed === "mirror" ? getConversationMapFromMirror() : getConversationChannelMap(),
      database.select({ ghlContactId: proposals.ghlContactId, status: proposals.status }).from(proposals).where(isNotNull(proposals.ghlContactId)),
      /**
       * THE CONTACT LIST ITSELF — every live contact, not just the ones with a deal.
       *
       * This used to select four columns purely to decorate opportunity-derived rows. The
       * page was built by iterating opportunities, so a person with no opportunity did not
       * exist on it: 1,895 of 5,094 contacts — 37% of the CRM — were unsearchable, and
       * because a brand-new lead never has an opportunity yet, that 37% was exactly the
       * cohort Gage searches for. He would look up a lead he had just seen in Meta, find
       * nothing, and fall back to GoHighLevel. That is the workflow this app replaces.
       *
       * `deletedInGhlAt IS NULL` excludes the ghost-deleted rows so the count agrees with
       * GHL exactly (5,094 = 5,094).
       */
      database
        .select({
          id: localContacts.id,
          fullName: localContacts.fullName,
          email: localContacts.email,
          phone: localContacts.phone,
          website: localContacts.website,
          companyName: localContacts.companyName,
          tags: localContacts.tags,
          // Searched, never returned to the client: every URL variant a lead ever submitted
          // lives here. Gage searches by domain, and the domain we store on `website` is only
          // ONE of the forms they may have given us.
          customFields: localContacts.customFields,
          createdAtGhl: localContacts.createdAtGhl,
          updatedAtGhl: localContacts.updatedAtGhl,
          assignedUserId: localContacts.assignedUserId,
          dnd: localContacts.dnd,
          isCustomer: localContacts.isCustomer,
          customerStatus: localContacts.customerStatus,
        })
        .from(localContacts)
        .where(isNull(localContacts.deletedInGhlAt)),
      database.select({ ghlContactId: audits.ghlContactId, status: audits.status }).from(audits).where(isNotNull(audits.ghlContactId)),
      // Our own follow-ups queued for the future (scheduled, not yet delivered)
      database.select({ ghlContactId: followupSends.ghlContactId, scheduledFor: followupSends.scheduledFor })
        .from(followupSends)
        .where(and(isNotNull(followupSends.scheduledFor), gt(followupSends.scheduledFor, new Date()), isNull(followupSends.sentAtActual))),
    ]);

    // Earliest queued follow-up per contact (our system) — for the "Follow-up" pill.
    const followupMap = new Map<string, Date>();
    for (const f of followupRows) {
      if (!f.ghlContactId || !f.scheduledFor) continue;
      const cur = followupMap.get(f.ghlContactId);
      if (!cur || f.scheduledFor < cur) followupMap.set(f.ghlContactId, f.scheduledFor);
    }
    const AUTO_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // "actively in a sequence" recency

    const catMap = new Map(catRows.map((r) => [r.domain, r.category]));
    const demoContactIds = new Set(demoRows.map((r) => r.ghlContactId).filter(Boolean) as string[]);

    // Audit status per contact: "delivered" wins over "requested".
    const auditMap = new Map<string, string>();
    for (const a of auditRows) {
      if (!a.ghlContactId) continue;
      const existing = auditMap.get(a.ghlContactId);
      if (existing !== "delivered") auditMap.set(a.ghlContactId, a.status);
    }

    // Proposal status per contact (best status wins: paid > signed > sent > draft)
    const proposalMap = new Map<string, string>();
    // Best-status-wins per contact. "active" and "completed" rank at the top alongside "paid":
    // they all mean the client gave us money. Missing from this map they scored 0 via the `?? 0`
    // fallback below, so a paying retainer client would lose to a stale draft and their contact
    // row would display "draft".
    const statusPriority: Record<string, number> = {
      completed: 6, active: 5, paid: 5, past_due: 4, signed: 4, partial: 3, sent: 2, draft: 1,
    };
    for (const p of proposalRows) {
      if (!p.ghlContactId) continue;
      const existing = proposalMap.get(p.ghlContactId);
      if (!existing || (statusPriority[p.status] ?? 0) > (statusPriority[existing] ?? 0)) {
        proposalMap.set(p.ghlContactId, p.status);
      }
    }

    // DND map
    const dndMap = new Map(dndRows.filter((r) => r.dnd).map((r) => [r.id, true]));

    // Customer status per contact (denormalized from the customers table) → Contacts-tab badge.
    const customerMap = new Map<string, string | null>();
    for (const r of dndRows) if (r.isCustomer) customerMap.set(r.id, r.customerStatus);

    // Meta's own contact payload, keyed by id — richer than what the opportunity embeds
    // (the embedded contact carries only id, name, companyName, email, phone, tags, score,
    // never website or customFields — see tasks/lessons.md 2026-06-29).
    const contactById = new Map(dndRows.map((r) => [r.id, r]));

    // A comment lead becomes a real pipeline lead only when a demo is submitted (which
    // creates a GHL contact + opportunity and sets ghl_contact_id). Carry its real platform
    // (instagram/facebook/tiktok) onto that GHL entry so source attribution survives, and
    // dedup the comment-lead row out (below) so it isn't double-listed.
    const metaPlatformByGhlId = new Map<string, string>();
    for (const cl of clRows) {
      if (cl.ghlContactId && cl.platform) metaPlatformByGhlId.set(cl.ghlContactId, cl.platform);
    }

    // ─── GHL contacts: one UnifiedContact per unique contact from opportunities ─
    // A contact can sit in several pipelines/stages at once. We show ONE row (their first
    // opportunity), but keep EVERY opportunity's pipeline/stage so a stage filter matches a
    // contact via any of their opportunities — not just the one shown (the 314→1 bug).
    const oppsByContact = new Map<string, typeof allOpps>();
    for (const o of allOpps) {
      const cid = o.contact?.id;
      if (!cid) continue;
      if (!oppsByContact.has(cid)) oppsByContact.set(cid, []);
      oppsByContact.get(cid)!.push(o);
    }

    const ghlUnified: UnifiedContact[] = [];

    /**
     * ONE ROW PER CONTACT — driven by the contact list, not by opportunities.
     *
     * The opportunity is now an ATTRIBUTE of a contact rather than the reason a contact
     * exists. A person with no deal still appears, with a null stage, which is the honest
     * representation: they are a real contact who simply has no opportunity yet.
     */
    for (const row of dndRows) {
      const opps = oppsByContact.get(row.id) ?? [];
      // A contact can sit in several pipelines at once; show the first, keep them all in
      // oppRefs so a stage filter matches via ANY of them (the 314→1 bug).
      const opp = opps[0] ?? null;

      // Everything else worth matching on, flattened once. Includes company name and every
      // custom-field value (websites, handles, alternate URLs) so a lead is findable by any
      // detail they actually gave us, not just the four fields the list happens to render.
      const extraSearch = [
        row.companyName ?? "",
        ...(Array.isArray(row.customFields)
          ? (row.customFields as { value?: unknown; field_value?: unknown }[]).map((f) => {
              const v = f?.value ?? f?.field_value;
              return typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : v == null ? "" : String(v);
            })
          : []),
        ...(Array.isArray(row.tags) ? (row.tags as string[]) : []),
      ].join(" ").toLowerCase();

      const c = {
        id: row.id,
        // Our mirror is the better name source; fall back to the opportunity's embedded copy.
        name: row.fullName ?? opp?.contact?.name ?? "Unknown",
        email: row.email ?? null,
        phone: row.phone ?? null,
        // The embedded opportunity contact never carries website (see lessons 2026-06-29),
        // so this is the only place it can come from.
        website: row.website ?? null,
        companyName: row.companyName ?? null,
        tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      };

      const createdAt =
        row.createdAtGhl?.toISOString() ?? opp?.createdAt ?? new Date(0).toISOString();
      const lastActivityAt =
        opp?.updatedAt ?? row.updatedAtGhl?.toISOString() ?? createdAt;
      const domain = (c.companyName ?? "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
      const category = domain ? (catMap.get(domain) as UnifiedContact["brandCategory"] ?? null) : null;

      const daysSince = daysAgo(lastActivityAt);
      // Null, not zero, when there is no opportunity: "0 days in stage" would read as a
      // brand-new deal rather than "there is no deal".
      const stageChangeAt = opp ? opp.lastStatusChangeAt ?? opp.createdAt : null;
      const daysInStage = stageChangeAt ? daysAgo(stageChangeAt) : null;
      const channels: string[] = [];
      if (c.email) channels.push("email");
      if (c.phone) channels.push("sms");

      // Response status derivation
      let responseStatus: UnifiedContact["responseStatus"] = null;
      if (daysSince >= 7) responseStatus = "no_response";
      else if (daysSince <= 2) responseStatus = "replied";
      else responseStatus = "awaiting_reply";

      const propStatus = proposalMap.get(c.id) ?? null;
      const auditStatus = auditMap.get(c.id) ?? null;

      // Sequence signal: GHL automation (last outbound automated + recent) and/or
      // our own queued follow-up.
      const conv = convMap.get(c.id);
      const autoAt = conv?.autoAction === "automated" ? conv.lastMessageAt : null;
      const inAutoSequence = autoAt != null && Date.now() - autoAt < AUTO_WINDOW_MS;
      const followupAt = followupMap.get(c.id) ?? null;

      ghlUnified.push({
        uid: `ghl_${c.id}`,
        source: "ghl",
        name: c.name ?? "Unknown",
        email: c.email ?? null,
        phone: c.phone ?? null,
        website: c.website ?? null,
        platform: (metaPlatformByGhlId.get(c.id) as UnifiedContact["platform"]) ?? "lead_form",
        ghlContactId: c.id,
        opportunityId: opp?.id ?? null,
        stage: opp?.pipelineStageId_name ?? null,
        stageId: opp?.pipelineStageId ?? null,
        pipelineId: opp?.pipelineId ?? null,
        oppRefs: opps.map((o) => ({ pipelineId: o.pipelineId, stageId: o.pipelineStageId, stage: o.pipelineStageId_name })),
        opportunityStatus: opp?.status ?? null,
        monetaryValue: opp?.monetaryValue ?? null,
        tags: c.tags ?? [],
        commentLeadId: null,
        commentText: null,
        brandCategory: category,
        hasDemo: demoContactIds.has(c.id),
        hasProposal: !!propStatus,
        proposalStatus: propStatus,
        hasAudit: !!auditStatus,
        auditStatus,
        awaitingReply: false,
        lastChannel: conv?.channel ?? null,
        daysSinceLastTouch: daysSince,
        daysInCurrentStage: daysInStage,
        lastActivityAt,
        createdAt,
        // The contact's own owner still applies when they have no opportunity.
        assignedTo: opp?.assignedTo ?? row.assignedUserId ?? null,
        dnd: dndMap.has(c.id),
        responseStatus,
        reachableChannels: channels,
        autoSequence: inAutoSequence,
        autoSequenceAt: autoAt != null ? new Date(autoAt).toISOString() : null,
        followupScheduledAt: followupAt ? followupAt.toISOString() : null,
        isCustomer: customerMap.has(c.id),
        customerStatus: customerMap.get(c.id) ?? null,
        extraSearch,
      });
    }

    // ─── Comment leads → UnifiedContact ──────────────────────────────────────
    // A comment lead is a pipeline lead ONLY once a demo has been submitted (demoStartedAt
    // set). Un-demoed trigger-word comments stay in the Meta inbox but are NOT counted as
    // leads here. Promoted leads (ghlContactId set) are represented by their GHL entry
    // above, so dedup them out — leaving only the rare demo-started-but-GHL-promotion-failed
    // rows, which still surface with their real platform.
    const clUnified: UnifiedContact[] = clRows
      .filter((cl) => cl.demoStartedAt != null && !cl.ghlContactId)
      .map((cl) => {
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
        hasAudit: false,
        auditStatus: null,
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
        autoSequence: false,
        autoSequenceAt: null,
        followupScheduledAt: null,
      };
    });

    let all: UnifiedContact[] = [...ghlUnified, ...clUnified];

    // Authoritative per-stage totals over the FULL population, computed BEFORE any
    // filter or pagination narrows `all`. The stage-summary pills render these, so
    // each pill shows the TRUE number of contacts in that stage, not a per-page
    // sample. Computed once here regardless of the active stage filter, so the bar
    // stays accurate and you can switch between stages.
    const stageCounts: Record<string, number> = {};
    for (const c of all) {
      if (!c.stage) continue;
      stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1;
    }

    // ─── Filters ──────────────────────────────────────────────────────────────
    // EXACT LOOKUP BY ID. `?uid=ghl_<contactId>` returns that one contact and nothing else.
    //
    // Callers that already know WHICH contact they want must never go through `search`, which is
    // a fuzzy substring match over name, email, phone, website, tags and custom fields. On
    // 2026-08-13 a caller searched by name, got a page of other people, and fell back to the
    // first result — opening a different client's record and, from there, a live message
    // composer. Exact-or-nothing removes the possibility: an unknown uid returns zero contacts,
    // never somebody else's.
    //
    // Applied before every other filter so it short-circuits the whole chain.
    if (uidFilter) {
      all = all.filter((c) => c.uid === uidFilter);
    }

    if (search) {
      // Websites are compared on their NORMALISED form (no scheme, no www., no trailing
      // slash). Gage pastes the URL straight from the browser — "https://harborheightscoffee.com/"
      // — while we store "www.harborheightscoffee.com". Neither string contains the other, so
      // a plain substring match returns nothing on a contact that is sitting right there.
      const searchUrlKey = urlKey(search);
      all = all.filter((c) => {
        const site = urlKey(c.website ?? "");
        return (
          c.name.toLowerCase().includes(search) ||
          (c.email ?? "").toLowerCase().includes(search) ||
          (c.phone ?? "").toLowerCase().includes(search) ||
          (!!site && !!searchUrlKey && site.includes(searchUrlKey)) ||
          // Company name, tags, and every custom-field value (alternate URLs included).
          ((c as { extraSearch?: string }).extraSearch ?? "").includes(search) ||
          (!!searchUrlKey && ((c as { extraSearch?: string }).extraSearch ?? "").includes(searchUrlKey)) ||
          (c.stage ?? "").toLowerCase().includes(search)
        );
      });
    }
    if (sourceFilter)   all = all.filter((c) => c.source === sourceFilter);
    // Pipeline/stage filters match against ANY of a contact's opportunities (see oppRefs).
    if (stageFilter)    all = all.filter((c) => c.oppRefs?.some((r) => r.stage === stageFilter) ?? (c.stage === stageFilter));
    if (categoryFilter) all = all.filter((c) => c.brandCategory === categoryFilter);
    if (hasDemoFilter === "true")  all = all.filter((c) => c.hasDemo);
    if (hasDemoFilter === "false") all = all.filter((c) => !c.hasDemo);
    if (pipelineFilter) all = all.filter((c) => c.oppRefs?.some((r) => r.pipelineId === pipelineFilter) ?? (c.pipelineId === pipelineFilter));
    if (stageFilter2)   all = all.filter((c) => c.oppRefs?.some((r) => r.stageId === stageFilter2) ?? (c.stageId === stageFilter2));
    all = applyRules(all, rules);

    // When a pipeline/stage filter is active, show the opportunity that MATCHED it — a contact
    // can sit in several pipelines, so the row should reflect the stage the user filtered for,
    // not their (arbitrary) primary opportunity.
    const activeStageIds = new Set<string>([
      ...(stageFilter2 ? [stageFilter2] : []),
      ...rules.filter((r) => r.field === "stageId" && r.operator === "is_any_of").flatMap((r) => r.values as string[]),
    ]);
    const activePipelineIds = new Set<string>([
      ...(pipelineFilter ? [pipelineFilter] : []),
      ...rules.filter((r) => r.field === "pipelineId" && r.operator === "is_any_of").flatMap((r) => r.values as string[]),
    ]);
    const activeStageNames = new Set<string>(stageFilter ? [stageFilter] : []);
    if (activeStageIds.size || activePipelineIds.size || activeStageNames.size) {
      all = all.map((c) => {
        if (!c.oppRefs?.length) return c;
        // Prefer a matching stage, then pipeline, so a combined pipeline+stage filter lands on the right opp.
        const match =
          c.oppRefs.find((r) => (r.stageId && activeStageIds.has(r.stageId)) || (r.stage && activeStageNames.has(r.stage))) ??
          c.oppRefs.find((r) => r.pipelineId && activePipelineIds.has(r.pipelineId));
        return match ? { ...c, stage: match.stage, stageId: match.stageId, pipelineId: match.pipelineId } : c;
      });
    }

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

    return NextResponse.json({ contacts, total, page, pageSize, stageCounts });
  } catch (err) {
    console.error("[GET /api/contacts]", err);
    return NextResponse.json({ error: "Failed to fetch contacts" }, { status: 500 });
  }
}
