/**
 * POST /api/ghl/sync/custom-fields
 *
 * Backfills custom fields for all existing contacts.
 * Fetches each contact from GHL to get the latest custom fields,
 * then upserts into the localContacts table.
 *
 * Returns: { total, updated, errors }
 */
import { NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { upsertContact, type GhlContact } from "@/lib/ghl/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — this is a bulk operation

interface ContactsResponse {
  contacts: GhlContact[];
  meta?: { nextPageUrl?: string; startAfterId?: string; total?: number };
}

export async function POST() {
  const loc = locationId();
  let total = 0;
  let updated = 0;
  let errors = 0;

  // GHL contacts pagination
  let startAfterId: string | undefined = undefined;
  let startAfter: number | undefined = undefined;
  const deadline = Date.now() + 240_000; // 4 minute budget (leave headroom for maxDuration)

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let url = `/contacts/?locationId=${loc}&limit=100`;
      if (startAfterId && startAfter) {
        url += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;
      }

      const data: ContactsResponse = await ghl.get(url);
      const batch: GhlContact[] = data.contacts ?? [];
      total += batch.length;

      // Upsert each contact — this writes customFields, website, etc. to the local DB
      for (let i = 0; i < batch.length; i += 25) {
        const chunk = batch.slice(i, i + 25);
        const results = await Promise.allSettled(chunk.map((c) => upsertContact(c)));
        for (const r of results) {
          if (r.status === "fulfilled") updated++;
          else {
            errors++;
            console.error("[sync/custom-fields] upsert error:", r.reason);
          }
        }
      }

      if (batch.length < 100) break;
      const last = batch[batch.length - 1];
      startAfterId = data.meta?.startAfterId ?? last?.id;
      startAfter = last?.dateAdded ? new Date(last.dateAdded).getTime() : undefined;
      if (!startAfterId || Date.now() > deadline) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/ghl/sync/custom-fields] Fatal:", message);
    return NextResponse.json(
      { total, updated, errors, fatalError: message },
      { status: 500 }
    );
  }

  return NextResponse.json({ total, updated, errors });
}
