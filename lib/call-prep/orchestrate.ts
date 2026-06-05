import { db } from "@/lib/db";
import { callPreps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  gatherContactData,
  detectCallType,
  gatherCallHistory,
  gatherDemoStatus,
  gatherProposalStatus,
  gatherRecentMessages,
} from "./gather";
import { fetchSitePages, researchCompany } from "./research";
import { generateCallPrep } from "./generate";
import type { CallPrepData } from "./types";

interface OrchestrateOptions {
  calendarEventId: string;
  contactId: string;
  contactName?: string;
  /** Bypass the cached "ready" prep and regenerate from scratch. */
  force?: boolean;
  onStep?: (step: string) => void;
}

/**
 * Full call prep generation pipeline:
 * 1. Gather contact data
 * 2. Scrape website (Firecrawl)
 * 3. Gather call history, demo status, messages
 * 4. Generate AI brief via Gemini
 * 5. Store in database
 */
export async function orchestrateCallPrep({
  calendarEventId,
  contactId,
  contactName,
  force = false,
  onStep,
}: OrchestrateOptions): Promise<CallPrepData> {
  // Mark as generating
  const [existing] = await db()
    .select()
    .from(callPreps)
    .where(eq(callPreps.calendarEventId, calendarEventId))
    .limit(1);

  if (!force && existing && existing.status === "ready" && existing.sections) {
    return toCallPrepData(existing);
  }

  // Upsert a "generating" record
  if (existing) {
    await db()
      .update(callPreps)
      .set({ status: "generating" })
      .where(eq(callPreps.calendarEventId, calendarEventId));
  } else {
    await db().insert(callPreps).values({
      calendarEventId,
      contactId,
      contactName: contactName ?? null,
      callType: "intro", // will be updated below
      status: "generating",
    });
  }

  const failedSections: string[] = [];

  try {
    // Step 1: Contact data
    onStep?.("contact");
    const contact = await gatherContactData(contactId);
    if (!contact) {
      await markFailed(calendarEventId, "Could not fetch contact data");
      throw new Error("Contact data unavailable");
    }

    // Step 1b: Detect call type
    const callType = await detectCallType(contactId);

    // Step 2: Deep company research — read their site + grounded web search.
    // Never throws; degrades to a thin result so the brief still generates.
    onStep?.("website");
    const siteText = contact.website ? await fetchSitePages(contact.website) : "";
    const research = await researchCompany({
      website: contact.website,
      companyName: contact.companyName,
      contactName: contact.name,
      siteText,
    });
    if (research.degraded) {
      failedSections.push("brandResearch");
    }

    // Step 3: Call history, demo, messages, proposals (parallel)
    onStep?.("history");
    const [callHistory, demoStatus, proposalStatus, recentMessages] =
      await Promise.all([
        gatherCallHistory(contactId),
        gatherDemoStatus(contactId),
        gatherProposalStatus(contactId),
        gatherRecentMessages(contactId),
      ]);

    // Step 4: Generate AI brief
    onStep?.("generating");
    const sections = await generateCallPrep({
      contact,
      callType,
      callHistory,
      research,
      demoStatus,
      proposalStatus,
      recentMessages,
    });

    // Step 5: Store
    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h expiry

    await db()
      .update(callPreps)
      .set({
        callType,
        status: "ready",
        sections,
        failedSections,
        generatedAt: now,
        expiresAt: expires,
        contactName: contact.name || contactName || null,
      })
      .where(eq(callPreps.calendarEventId, calendarEventId));

    const [result] = await db()
      .select()
      .from(callPreps)
      .where(eq(callPreps.calendarEventId, calendarEventId))
      .limit(1);

    return toCallPrepData(result);
  } catch (err) {
    await markFailed(
      calendarEventId,
      err instanceof Error ? err.message : "Unknown error"
    );
    throw err;
  }
}

/**
 * Get cached call prep if it exists and is still valid.
 */
export async function getCachedCallPrep(
  calendarEventId: string
): Promise<CallPrepData | null> {
  const [existing] = await db()
    .select()
    .from(callPreps)
    .where(eq(callPreps.calendarEventId, calendarEventId))
    .limit(1);

  if (!existing) return null;

  // If expired, return null so it regenerates
  if (existing.expiresAt && new Date() > existing.expiresAt) {
    return null;
  }

  return toCallPrepData(existing);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function markFailed(calendarEventId: string, _error: string) {
  await db()
    .update(callPreps)
    .set({ status: "failed" })
    .where(eq(callPreps.calendarEventId, calendarEventId));
}

function toCallPrepData(row: typeof callPreps.$inferSelect): CallPrepData {
  return {
    id: row.id,
    calendarEventId: row.calendarEventId,
    contactId: row.contactId,
    contactName: row.contactName,
    callType: row.callType as "intro" | "follow_up",
    status: row.status as CallPrepData["status"],
    sections: row.sections as CallPrepData["sections"],
    failedSections: (row.failedSections as string[]) ?? [],
    generatedAt: row.generatedAt?.toISOString() ?? null,
  };
}
