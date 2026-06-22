/**
 * lib/ghl/sync.ts
 *
 * Typed upsert helpers for all GHL entities.
 * Used by:
 *   - /api/ghl/sync (backfill)
 *   - /api/webhooks/ghl (ongoing sync on every event)
 *
 * Each function is safe to call concurrently and is idempotent —
 * re-syncing the same record just updates it in place.
 */
import { db } from "@/lib/db";
import {
  localContacts,
  localOpportunities,
  localPipelines,
  localConversations,
  localMessages,
} from "@/lib/db/schema";
import { sql, and, eq, or, isNull, lte } from "drizzle-orm";

// ─── GHL API response shapes ──────────────────────────────────────────────────

export interface GhlContact {
  id: string;
  locationId?: string;
  firstName?: string;
  lastName?: string;
  fullNameLowerCase?: string;
  name?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
  assignedTo?: string;
  customFields?: Array<{ id: string; field_value?: string; value?: string }>;
  address1?: string;
  city?: string;
  state?: string;
  country?: string;
  companyName?: string;
  website?: string;
  dnd?: boolean;
  dateAdded?: string;
  dateUpdated?: string;
}

export interface GhlOpportunity {
  id: string;
  contact?: {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    tags?: string[];
    companyName?: string;
    dateAdded?: string;
  };
  pipeline?: {
    id?: string;
    name?: string;
  };
  pipelineId?: string;
  pipelineStageId?: string;
  pipelineStageName?: string;
  name?: string;
  status?: string;
  monetaryValue?: number;
  assignedTo?: string;
  source?: string;
  lastStageChangeAt?: string;
  dateAdded?: string;
  dateUpdated?: string;
  createdAt?: string; // alias GHL sometimes uses
}

export interface GhlPipeline {
  id: string;
  name: string;
  stages?: Array<{ id: string; name: string; position: number }>;
}

export interface GhlConversation {
  id: string;
  contactId?: string;
  fullName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  lastMessageBody?: string;
  lastMessageDate?: string;
  unreadCount?: number;
  type?: string;
  assignedTo?: string;
  inbox?: boolean;
  starred?: boolean;
}

export interface GhlMessage {
  id: string;
  conversationId: string;
  contactId?: string;
  direction?: string;
  type?: string;
  body?: string;
  subject?: string;
  status?: string;
  source?: string;
  userId?: string; // GHL user id of the sender (present on human-sent outbound messages)
  attachments?: unknown[];
  dateAdded?: string;
}

// A genuine human reply (vs automation) carries a userId AND originates from a
// person: GHL web/mobile app ("app") or our own app/API ("api"). Workflow blasts
// and bulk sends also carry a userId, so source must be checked too. Activity
// rows (TYPE_ACTIVITY_*) are system events, not messages.
const HUMAN_REPLY_SOURCES = new Set(["app", "api"]);

export function isHumanOutboundReply(m: {
  direction?: string;
  source?: string;
  type?: string;
  userId?: string;
}): boolean {
  if (m.direction !== "outbound") return false;
  if (!m.userId) return false;
  if (!m.source || !HUMAN_REPLY_SOURCES.has(m.source)) return false;
  if (m.type && m.type.toUpperCase().startsWith("TYPE_ACTIVITY")) return false;
  return true;
}

/**
 * Record who last *personally* responded to a conversation. Date-guarded: only
 * advances when `at` is newer than the stored value, so replayed / out-of-order
 * webhooks can't set a stale responder. No-ops if the conversation row is absent
 * yet (self-heals on the next sync/message).
 */
export async function updateLastResponder(
  conversationId: string,
  userId: string,
  source: string | null,
  at: Date
): Promise<void> {
  await db()
    .update(localConversations)
    .set({
      lastResponderUserId: userId,
      lastRespondedAt: at,
      lastRespondedSource: source ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(localConversations.id, conversationId),
        or(
          isNull(localConversations.lastRespondedAt),
          lte(localConversations.lastRespondedAt, at)
        )
      )
    );
}

// ─── Upsert functions ─────────────────────────────────────────────────────────

export async function upsertContact(c: GhlContact): Promise<void> {
  const fullName =
    c.name ??
    (c.fullNameLowerCase
      ? c.fullNameLowerCase
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      : [c.firstName, c.lastName].filter(Boolean).join(" ") || null);

  await db()
    .insert(localContacts)
    .values({
      id: c.id,
      locationId: c.locationId ?? null,
      firstName: c.firstName ?? null,
      lastName: c.lastName ?? null,
      fullName: fullName ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      tags: (c.tags ?? []) as string[],
      source: c.source ?? null,
      assignedUserId: c.assignedTo ?? null,
      customFields: (c.customFields ?? []) as Record<string, unknown>[],
      address: c.address1 ?? null,
      city: c.city ?? null,
      state: c.state ?? null,
      country: c.country ?? null,
      companyName: c.companyName ?? null,
      website: c.website ?? null,
      dnd: c.dnd ?? false,
      rawData: c as unknown as Record<string, unknown>,
      createdAtGhl: c.dateAdded ? new Date(c.dateAdded) : null,
      updatedAtGhl: c.dateUpdated ? new Date(c.dateUpdated) : null,
      syncedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: localContacts.id,
      set: {
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        fullName: sql`excluded.full_name`,
        email: sql`excluded.email`,
        phone: sql`excluded.phone`,
        tags: sql`excluded.tags`,
        source: sql`excluded.source`,
        assignedUserId: sql`excluded.assigned_user_id`,
        customFields: sql`excluded.custom_fields`,
        address: sql`excluded.address`,
        city: sql`excluded.city`,
        state: sql`excluded.state`,
        country: sql`excluded.country`,
        companyName: sql`excluded.company_name`,
        website: sql`excluded.website`,
        dnd: sql`excluded.dnd`,
        rawData: sql`excluded.raw_data`,
        updatedAtGhl: sql`excluded.updated_at_ghl`,
        syncedAt: sql`excluded.synced_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function upsertOpportunity(o: GhlOpportunity): Promise<void> {
  await db()
    .insert(localOpportunities)
    .values({
      id: o.id,
      contactId: o.contact?.id ?? null,
      pipelineId: o.pipeline?.id ?? o.pipelineId ?? null,
      pipelineStageId: o.pipelineStageId ?? null,
      pipelineName: o.pipeline?.name ?? null,
      stageName: o.pipelineStageName ?? null,
      name: o.name ?? null,
      status: o.status ?? null,
      monetaryValue: o.monetaryValue ?? null,
      assignedTo: o.assignedTo ?? null,
      source: o.source ?? null,
      contactName: o.contact?.name ?? null,
      contactEmail: o.contact?.email ?? null,
      contactPhone: o.contact?.phone ?? null,
      contactTags: (o.contact?.tags ?? []) as string[],
      contactCompanyName: o.contact?.companyName ?? null,
      contactDateAdded: o.contact?.dateAdded ? new Date(o.contact.dateAdded) : null,
      lastStageChangeAt: o.lastStageChangeAt ? new Date(o.lastStageChangeAt) : null,
      rawData: o as unknown as Record<string, unknown>,
      createdAtGhl: o.dateAdded ? new Date(o.dateAdded) : o.createdAt ? new Date(o.createdAt) : null,
      updatedAtGhl: o.dateUpdated ? new Date(o.dateUpdated) : null,
      syncedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: localOpportunities.id,
      set: {
        contactId: sql`excluded.contact_id`,
        pipelineId: sql`excluded.pipeline_id`,
        pipelineStageId: sql`excluded.pipeline_stage_id`,
        pipelineName: sql`excluded.pipeline_name`,
        stageName: sql`excluded.stage_name`,
        name: sql`excluded.name`,
        status: sql`excluded.status`,
        monetaryValue: sql`excluded.monetary_value`,
        assignedTo: sql`excluded.assigned_to`,
        contactName: sql`excluded.contact_name`,
        contactEmail: sql`excluded.contact_email`,
        contactPhone: sql`excluded.contact_phone`,
        contactTags: sql`excluded.contact_tags`,
        contactCompanyName: sql`excluded.contact_company_name`,
        contactDateAdded: sql`excluded.contact_date_added`,
        lastStageChangeAt: sql`excluded.last_stage_change_at`,
        rawData: sql`excluded.raw_data`,
        updatedAtGhl: sql`excluded.updated_at_ghl`,
        syncedAt: sql`excluded.synced_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function upsertPipeline(p: GhlPipeline): Promise<void> {
  await db()
    .insert(localPipelines)
    .values({
      id: p.id,
      name: p.name,
      stages: (p.stages ?? []) as Array<{ id: string; name: string; position: number }>,
      syncedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: localPipelines.id,
      set: {
        name: sql`excluded.name`,
        stages: sql`excluded.stages`,
        syncedAt: sql`excluded.synced_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function upsertConversation(c: GhlConversation): Promise<void> {
  await db()
    .insert(localConversations)
    .values({
      id: c.id,
      contactId: c.contactId ?? null,
      contactName: c.contactName ?? c.fullName ?? null,
      contactEmail: c.email ?? null,
      contactPhone: c.phone ?? null,
      lastMessageBody: c.lastMessageBody ?? null,
      lastMessageDate: c.lastMessageDate ? new Date(c.lastMessageDate) : null,
      unreadCount: c.unreadCount ?? 0,
      type: c.type ?? null,
      assignedTo: c.assignedTo ?? null,
      inbox: c.inbox ?? true,
      starred: c.starred ?? false,
      rawData: c as unknown as Record<string, unknown>,
      syncedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: localConversations.id,
      set: {
        contactName: sql`excluded.contact_name`,
        contactEmail: sql`excluded.contact_email`,
        contactPhone: sql`excluded.contact_phone`,
        lastMessageBody: sql`excluded.last_message_body`,
        lastMessageDate: sql`excluded.last_message_date`,
        unreadCount: sql`excluded.unread_count`,
        assignedTo: sql`excluded.assigned_to`,
        inbox: sql`excluded.inbox`,
        starred: sql`excluded.starred`,
        rawData: sql`excluded.raw_data`,
        syncedAt: sql`excluded.synced_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function upsertMessage(m: GhlMessage): Promise<void> {
  await db()
    .insert(localMessages)
    .values({
      id: m.id,
      conversationId: m.conversationId,
      contactId: m.contactId ?? null,
      direction: m.direction ?? null,
      type: m.type ?? null,
      body: m.body ?? null,
      subject: m.subject ?? null,
      status: m.status ?? null,
      source: m.source ?? null,
      sentByUserId: m.userId ?? null,
      attachments: (m.attachments ?? []) as Record<string, unknown>[],
      rawData: m as unknown as Record<string, unknown>,
      messageDate: m.dateAdded ? new Date(m.dateAdded) : null,
      syncedAt: new Date(),
    })
    .onConflictDoNothing();

  // Record the rep as last responder when this is a real human reply.
  if (isHumanOutboundReply(m) && m.userId) {
    await updateLastResponder(
      m.conversationId,
      m.userId,
      m.source ?? null,
      m.dateAdded ? new Date(m.dateAdded) : new Date()
    );
  }
}
