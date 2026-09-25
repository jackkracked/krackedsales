/**
 * POST /api/ghl/sync
 *
 * Backfills local DB tables from the GHL REST API.
 * Accepts an optional body: { entities?: string[] }
 * Defaults to all four entity types if omitted.
 *
 * Returns: { synced: { pipelines: N, contacts: N, opportunities: N, conversations: N } }
 */
import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import {
  upsertPipeline,
  upsertContact,
  upsertOpportunity,
  upsertConversation,
  type GhlPipeline,
  type GhlContact,
  type GhlOpportunity,
  type GhlConversation,
} from "@/lib/ghl/sync";
import { db } from "@/lib/db";
import { ghlSyncLog } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALL_ENTITIES = ["pipelines", "contacts", "opportunities", "conversations"] as const;
type EntityType = (typeof ALL_ENTITIES)[number];

// ─── GHL API response shapes ──────────────────────────────────────────────────

interface PipelinesResponse {
  pipelines: GhlPipeline[];
}

interface ContactsResponse {
  contacts: GhlContact[];
  meta?: { nextPageUrl?: string; startAfterId?: string; total?: number };
}

interface OpportunitiesResponse {
  opportunities: GhlOpportunity[];
  meta?: { nextPageUrl?: string; startAfterId?: string; total?: number };
}

interface ConversationsResponse {
  conversations: GhlConversation[];
  meta?: { nextPageUrl?: string; startAfterId?: string; total?: number };
}

// ─── Per-entity sync helpers ──────────────────────────────────────────────────

async function batchUpsert<T>(items: T[], fn: (item: T) => Promise<void>, chunkSize = 25): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await Promise.all(items.slice(i, i + chunkSize).map(fn));
  }
}

async function syncPipelines(): Promise<number> {
  const loc = locationId();
  const data = await ghl.get<PipelinesResponse>(
    `/opportunities/pipelines?locationId=${loc}`
  );
  const pipelines = data.pipelines ?? [];
  await batchUpsert(pipelines, upsertPipeline);
  return pipelines.length;
}

// Paginate until all records are synced or the time budget (ms) is exceeded
const PAGE_BUDGET_MS = 50_000; // 50s per entity — well within 300s maxDuration
// Contacts get their own, much larger budget. v1 /contacts/ pages OLDEST-first and cannot be
// sorted, so a truncated pass always drops the newest leads — the exact failure that left Tony
// Lightwood unfindable. 5,094 contacts is 51 round trips; 200s finishes with room to spare
// inside the route's 300s maxDuration.
const CONTACTS_BUDGET_MS = 200_000;

/**
 * Sync contacts.
 *
 * MUST USE v1 `/contacts/`. It is the only contact endpoint that returns the `attributions`
 * ARRAY — every UTM touch, including `utmAdId`, which is how the Leads Centre identifies a
 * Meta lead (`raw_data::text ILIKE '%"utmAdId"%'` in app/api/leads/route.ts).
 *
 * DO NOT switch this to v2 `/contacts/search`. I did, on 2026-08-07, to get newest-first
 * ordering — and it destroyed the Meta attribution on every contact it touched. v2 returns
 * `attributionSource` / `lastAttributionSource` (single objects) but NOT `attributions`, so
 * `upsertContact` wrote a raw_data blob with no `utmAdId` anywhere in it and the Leads page
 * fell from 553 leads to 10. The only survivors were contacts the sync SKIPPED. Recoverable
 * only because GHL still had the truth; a re-sync on v1 restored it.
 *
 * The original bug this was meant to fix — a 50s budget that always dropped the NEWEST
 * contacts, because v1 pages oldest-first — is fixed by giving the pass enough time to finish
 * instead. 5,094 contacts is 51 pages; the route allows 300s.
 */
async function syncContacts(): Promise<number> {
  const loc = locationId();
  let total = 0;
  let startAfterId: string | undefined = undefined;
  let startAfter: number | undefined = undefined;
  // Generous on purpose: a truncated pass silently drops the newest leads, and this endpoint
  // cannot be sorted newest-first. Finishing is what makes truncation a non-issue.
  const deadline = Date.now() + CONTACTS_BUDGET_MS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let url = `/contacts/?locationId=${loc}&limit=100`;
    if (startAfterId && startAfter) {
      url += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;
    }
    const data: ContactsResponse = await ghl.get(url);
    const batch: GhlContact[] = data.contacts ?? [];
    if (!batch.length) break;

    await batchUpsert(batch, upsertContact);
    total += batch.length;

    if (batch.length < 100) break;
    const last = batch[batch.length - 1];
    startAfterId = data.meta?.startAfterId ?? last?.id;
    startAfter = last?.dateAdded ? new Date(last.dateAdded).getTime() : undefined;
    if (!startAfterId || Date.now() > deadline) {
      if (Date.now() > deadline) {
        // Loud, because a quiet truncation here is exactly how new leads went missing.
        console.error(`[ghl/sync] contacts TRUNCATED at ${total} — budget exhausted. Newest contacts may be missing.`);
      }
      break;
    }
  }

  return total;
}

async function syncOpportunities(): Promise<number> {
  const loc = locationId();
  let total = 0;
  // GHL opportunities pagination: startAfterId (id) + startAfter (dateAdded ms timestamp)
  let startAfterId: string | undefined = undefined;
  let startAfter: number | undefined = undefined;
  let prevFirstId: string | undefined = undefined;
  const deadline = Date.now() + PAGE_BUDGET_MS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let url = `/opportunities/search?location_id=${loc}&limit=100`;
    if (startAfterId && startAfter) {
      url += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;
    }
    const data: OpportunitiesResponse = await ghl.get(url);
    const batch: GhlOpportunity[] = data.opportunities ?? [];

    // Cycle detection — if GHL returns the same page again, stop
    const firstId = batch[0]?.id;
    if (firstId && firstId === prevFirstId) break;
    prevFirstId = firstId;

    await batchUpsert(batch, upsertOpportunity);
    total += batch.length;

    if (batch.length < 100) break;
    const last = batch[batch.length - 1];
    startAfterId = data.meta?.startAfterId ?? last?.id;
    const lastDate = last?.dateAdded ?? last?.createdAt;
    startAfter = lastDate ? new Date(lastDate).getTime() : undefined;
    if (!startAfterId || Date.now() > deadline) break;
  }

  return total;
}

async function syncConversations(): Promise<number> {
  const loc = locationId();
  let total = 0;
  // GHL /conversations/search advances on `lastId` (the last conversation id), NOT
  // startAfterId — using the wrong cursor pins it to page 1 and only 100 sync. This
  // matches the working live paginator in /api/contacts.
  let lastId: string | undefined = undefined;
  let prevFirstId: string | undefined = undefined;
  const deadline = Date.now() + PAGE_BUDGET_MS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cursorParam = lastId ? `&lastId=${lastId}` : "";
    const data: ConversationsResponse = await ghl.get(
      `/conversations/search?locationId=${loc}&limit=100&sortBy=last_message_date&sortOrder=desc${cursorParam}`
    );
    const batch: GhlConversation[] = data.conversations ?? [];

    // Cycle detection — if GHL returns the same page again, stop
    const firstId = batch[0]?.id;
    if (firstId && firstId === prevFirstId) break;
    prevFirstId = firstId;

    await batchUpsert(batch, upsertConversation);
    total += batch.length;

    if (batch.length < 100) break;
    lastId = batch[batch.length - 1]?.id;
    if (!lastId || Date.now() > deadline) break;
  }

  return total;
}

// ─── Route handler ────────────────────────────────────────────────────────────

/** Reconcile the local GHL mirror for the given entities. Shared by the admin POST and the
 *  daily cron (app/api/cron/sync-ghl); webhooks keep the mirror real-time between runs. */
export async function runSync(requestedEntities: EntityType[] = [...ALL_ENTITIES]): Promise<Record<string, number>> {
  const synced: Record<string, number> = {
    pipelines: 0,
    contacts: 0,
    opportunities: 0,
    conversations: 0,
  };

  for (const entity of requestedEntities) {
    const startedAt = new Date();
    try {
      let recordCount = 0;

      if (entity === "pipelines") recordCount = await syncPipelines();
      else if (entity === "contacts") recordCount = await syncContacts();
      else if (entity === "opportunities") recordCount = await syncOpportunities();
      else if (entity === "conversations") recordCount = await syncConversations();

      synced[entity] = recordCount;

      await db().insert(ghlSyncLog).values({
        entity,
        status: "success",
        totalRecords: recordCount,
        syncedRecords: recordCount,
        startedAt,
        completedAt: new Date(),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[/api/ghl/sync] Failed to sync ${entity}:`, errorMessage);

      await db().insert(ghlSyncLog).values({
        entity,
        status: "error",
        error: errorMessage,
        startedAt,
        completedAt: new Date(),
      });
    }
  }

  return synced;
}

export async function POST(req: NextRequest) {
  let requestedEntities: EntityType[] = [...ALL_ENTITIES];
  try {
    const body = (await req.json().catch(() => ({}))) as { entities?: string[] };
    const raw = body.entities;
    if (Array.isArray(raw) && raw.length > 0) {
      requestedEntities = raw.filter((e): e is EntityType => (ALL_ENTITIES as readonly string[]).includes(e));
    }
  } catch { /* default = all entities */ }
  return NextResponse.json({ synced: await runSync(requestedEntities) });
}
