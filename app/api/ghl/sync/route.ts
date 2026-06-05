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

async function syncContacts(): Promise<number> {
  const loc = locationId();
  let total = 0;
  // GHL contacts pagination requires BOTH startAfterId (id) AND startAfter (dateAdded ms)
  let startAfterId: string | undefined = undefined;
  let startAfter: number | undefined = undefined;
  const deadline = Date.now() + PAGE_BUDGET_MS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let url = `/contacts/?locationId=${loc}&limit=100`;
    if (startAfterId && startAfter) {
      url += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;
    }
    const data: ContactsResponse = await ghl.get(url);
    const batch: GhlContact[] = data.contacts ?? [];
    await batchUpsert(batch, upsertContact);
    total += batch.length;

    if (batch.length < 100) break;
    const last = batch[batch.length - 1];
    startAfterId = data.meta?.startAfterId ?? last?.id;
    startAfter = last?.dateAdded ? new Date(last.dateAdded).getTime() : undefined;
    if (!startAfterId || Date.now() > deadline) break;
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
  let startAfterId: string | undefined = undefined;
  let prevFirstId: string | undefined = undefined;
  const deadline = Date.now() + PAGE_BUDGET_MS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cursorParam = startAfterId ? `&startAfterId=${startAfterId}` : "";
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
    startAfterId = data.meta?.startAfterId ?? batch[batch.length - 1]?.id;
    if (!startAfterId || Date.now() > deadline) break;
  }

  return total;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let requestedEntities: EntityType[];

  try {
    const body = await req.json().catch(() => ({})) as { entities?: string[] };
    const raw = body.entities;
    if (Array.isArray(raw) && raw.length > 0) {
      requestedEntities = raw.filter((e): e is EntityType =>
        (ALL_ENTITIES as readonly string[]).includes(e)
      );
    } else {
      requestedEntities = [...ALL_ENTITIES];
    }
  } catch {
    requestedEntities = [...ALL_ENTITIES];
  }

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

  return NextResponse.json({ synced });
}
