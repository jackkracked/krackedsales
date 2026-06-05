/**
 * GET /api/ghl/sync/verify
 *
 * Cross-references GHL API totals against local DB counts to surface
 * any discrepancies between the source-of-truth and the local sync.
 *
 * Returns:
 *   {
 *     pipelines:     { ghl: N, local: N, match: boolean },
 *     contacts:      { ghl: N, local: N, match: boolean, missing?: N },
 *     opportunities: { ghl: N, local: N, match: boolean, missing?: N },
 *     conversations: { ghl: N, local: N, match: boolean, missing?: N },
 *     allMatch: boolean
 *   }
 */
import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { db } from "@/lib/db";
import { ghl, locationId } from "@/lib/ghl/client";
import {
  localPipelines,
  localContacts,
  localOpportunities,
  localConversations,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// ─── GHL response shapes ───────────────────────────────────────────────────────

interface PaginatedResponse {
  meta?: { total?: number };
}

interface PipelinesResponse {
  pipelines?: unknown[];
}

// ─── GHL fetch helpers ─────────────────────────────────────────────────────────

async function fetchGhlContacts(loc: string): Promise<number | null> {
  const data = await ghl.get<PaginatedResponse>(
    `/contacts/?locationId=${loc}&limit=1`
  );
  return data.meta?.total ?? null;
}

async function fetchGhlOpportunities(loc: string): Promise<number | null> {
  const data = await ghl.get<PaginatedResponse>(
    `/opportunities/search?location_id=${loc}&limit=1`
  );
  return data.meta?.total ?? null;
}

async function fetchGhlPipelines(loc: string): Promise<number | null> {
  const data = await ghl.get<PipelinesResponse>(
    `/opportunities/pipelines?locationId=${loc}`
  );
  return Array.isArray(data.pipelines) ? data.pipelines.length : null;
}

async function fetchGhlConversations(loc: string): Promise<number | null> {
  const data = await ghl.get<PaginatedResponse>(
    `/conversations/search?locationId=${loc}&limit=1&page=1`
  );
  return data.meta?.total ?? null;
}

// ─── Result types ──────────────────────────────────────────────────────────────

interface EntityResult {
  ghl: number | null;
  local: number;
  match: boolean;
  missing?: number;
  error?: string;
}

type GhlFetcher = (loc: string) => Promise<number | null>;

async function resolveEntity(
  fetcher: GhlFetcher,
  loc: string,
  localCount: number
): Promise<EntityResult> {
  try {
    const ghlCount = await fetcher(loc);

    if (ghlCount === null) {
      return { ghl: null, local: localCount, match: false, error: "GHL returned no total" };
    }

    const match = ghlCount === localCount;
    const result: EntityResult = { ghl: ghlCount, local: localCount, match };
    if (!match && ghlCount > localCount) {
      result.missing = ghlCount - localCount;
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ghl: null, local: localCount, match: false, error: message };
  }
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const loc = locationId();
    const client = db();

    // Run all GHL fetches and local DB counts in parallel
    const [
      [pipelinesRow],
      [contactsRow],
      [opportunitiesRow],
      [conversationsRow],
      pipelinesResult,
      contactsResult,
      opportunitiesResult,
      conversationsResult,
    ] = await Promise.all([
      client.select({ value: count() }).from(localPipelines),
      client.select({ value: count() }).from(localContacts),
      client.select({ value: count() }).from(localOpportunities),
      client.select({ value: count() }).from(localConversations),
      // GHL calls resolved after DB counts — we handle errors per-entity below
      fetchGhlPipelines(loc).then((n) => ({ ok: true as const, value: n })).catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })),
      fetchGhlContacts(loc).then((n) => ({ ok: true as const, value: n })).catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })),
      fetchGhlOpportunities(loc).then((n) => ({ ok: true as const, value: n })).catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })),
      fetchGhlConversations(loc).then((n) => ({ ok: true as const, value: n })).catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })),
    ]);

    const localPipelinesCount = pipelinesRow?.value ?? 0;
    const localContactsCount = contactsRow?.value ?? 0;
    const localOpportunitiesCount = opportunitiesRow?.value ?? 0;
    const localConversationsCount = conversationsRow?.value ?? 0;

    function buildResult(
      fetched: { ok: true; value: number | null } | { ok: false; error: string },
      localCount: number
    ): EntityResult {
      if (!fetched.ok) {
        return { ghl: null, local: localCount, match: false, error: fetched.error };
      }
      const ghlCount = fetched.value;
      if (ghlCount === null) {
        return { ghl: null, local: localCount, match: false, error: "GHL returned no total" };
      }
      const match = ghlCount === localCount;
      const result: EntityResult = { ghl: ghlCount, local: localCount, match };
      if (!match && ghlCount > localCount) {
        result.missing = ghlCount - localCount;
      }
      return result;
    }

    const pipelines = buildResult(pipelinesResult, localPipelinesCount);
    const contacts = buildResult(contactsResult, localContactsCount);
    const opportunities = buildResult(opportunitiesResult, localOpportunitiesCount);
    const conversations = buildResult(conversationsResult, localConversationsCount);

    const allMatch =
      pipelines.match && contacts.match && opportunities.match && conversations.match;

    return NextResponse.json({
      pipelines,
      contacts,
      opportunities,
      conversations,
      allMatch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/ghl/sync/verify]", message);
    return NextResponse.json({ error: "Failed to verify sync" }, { status: 500 });
  }
}
