/**
 * lib/contacts/mirror-source.ts
 *
 * Mirror-backed replacements for the two live-GHL scrapes the Contacts route used
 * to do on every load (all opportunities + the conversation channel map). Reading
 * from the local mirror (local_opportunities / local_pipelines / local_conversations)
 * turns a ~5s cold load into ~0.1s.
 *
 * Correctness is guaranteed by shape, not by re-deriving fields: each opportunity /
 * conversation is reconstructed from its `rawData` column, which is the exact GHL JSON
 * captured from the SAME endpoints the live path calls (`/opportunities/search`,
 * `/conversations/search`). The stage-name map is built from `local_pipelines.stages`,
 * identical to the live path's pipeline lookup. So the objects handed to the Contacts
 * transform are indistinguishable from the live ones, minus at most a few seconds of
 * webhook lag (the daily reconcile cron heals any drift).
 */
import { desc, sql, isNull} from "drizzle-orm";
import { db } from "@/lib/db";
import { localOpportunities, localPipelines, localConversations } from "@/lib/db/schema";
import type { GHLOpportunity } from "@/lib/ghl/types";

export interface EnrichedOpp extends GHLOpportunity {
  pipelineStageId_name: string;
}

export interface ConvInfo {
  channel: string;
  autoAction: string | null;
  lastMessageAt: number | null;
}

interface PipelineStage {
  id: string;
  name: string;
  position?: number;
}

// Kept byte-identical to the live Contacts route's channelLabel().
function channelLabel(type: string): string {
  const t = type.toUpperCase();
  if (t.includes("SMS")) return "SMS";
  if (t.includes("EMAIL")) return "Email";
  if (t.includes("INSTAGRAM")) return "Instagram";
  if (t.includes("FB") || t.includes("FACEBOOK")) return "Facebook";
  if (t.includes("WHATSAPP")) return "WhatsApp";
  if (t.includes("CALL")) return "Call";
  if (t.includes("TIKTOK")) return "TikTok";
  return "Unknown";
}

/**
 * Every opportunity across all pipelines, shaped exactly like the live
 * getAllOpportunities(): the raw GHL opp plus a computed pipelineStageId_name.
 */
export async function getOpportunitiesFromMirror(): Promise<EnrichedOpp[]> {
  const database = db();
  const [pipelineRows, oppRows] = await Promise.all([
    database.select({ stages: localPipelines.stages }).from(localPipelines),
    database
      .select({ rawData: localOpportunities.rawData, pipelineStageId: localOpportunities.pipelineStageId })
      .from(localOpportunities)
      /* Exclude opportunities GoHighLevel no longer has. The sync only upserts, so deleted
         deals were counted forever: stage "Unresponsive (Demo Not Started)" read 46 here
         against 0 in GHL, and every id sampled returned 404. Without this filter the ghost
         delete has no effect on anything the user sees. */
      .where(isNull(localOpportunities.deletedInGhlAt)),
  ]);

  // stageId → stageName, exactly as the live path builds it from the pipelines call.
  const stageMap: Record<string, string> = {};
  for (const p of pipelineRows) {
    for (const s of (p.stages as PipelineStage[] | null) ?? []) {
      stageMap[s.id] = s.name;
    }
  }

  const opps: EnrichedOpp[] = [];
  for (const row of oppRows) {
    const raw = row.rawData as GHLOpportunity | null;
    if (!raw || !raw.id) continue; // skip malformed rows; live path skips contact-less opps downstream
    const stageId = raw.pipelineStageId ?? row.pipelineStageId ?? "";
    opps.push({ ...raw, pipelineStageId_name: stageMap[stageId] ?? "Unknown Stage" });
  }
  return opps;
}

/**
 * contactId → { channel, autoAction, lastMessageAt }, first (most recent) conversation
 * per contact — identical to the live getConversationChannelMap(). Ordered by
 * last_message_date desc, undated rows last, so "most recent wins" matches GHL's sort.
 */
export async function getConversationMapFromMirror(): Promise<Map<string, ConvInfo>> {
  const database = db();
  const rows = await database
    .select({
      contactId: localConversations.contactId,
      type: localConversations.type,
      lastMessageDate: localConversations.lastMessageDate,
      rawData: localConversations.rawData,
    })
    .from(localConversations)
    .orderBy(sql`${localConversations.lastMessageDate} desc nulls last`, desc(localConversations.id));

  const map = new Map<string, ConvInfo>();
  for (const row of rows) {
    if (!row.contactId || map.has(row.contactId)) continue;
    const raw = (row.rawData ?? {}) as { lastOutboundMessageAction?: string };
    map.set(row.contactId, {
      channel: channelLabel(row.type ?? ""),
      autoAction: raw.lastOutboundMessageAction ?? null,
      lastMessageAt: row.lastMessageDate ? row.lastMessageDate.getTime() : null,
    });
  }
  return map;
}
