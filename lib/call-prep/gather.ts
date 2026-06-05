import { db } from "@/lib/db";
import {
  callDispositions,
  calls,
  callInsights,
  contactCustomFields,
  demoGhlLinks,
  proposals,
  localContacts,
  localOpportunities,
  localMessages,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";

// ─── Contact data ────────────────────────────────────────────────────────────

export interface GatheredContact {
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  companyName: string | null;
  tags: string[];
  stage: string | null;
  pipelineStage: string | null;
  monetaryValue: number | null;
  source: string | null;
  customFields: Record<string, string>;
}

export async function gatherContactData(contactId: string): Promise<GatheredContact | null> {
  // Try local contacts first (faster), fall back to GHL API
  const [local] = await db()
    .select()
    .from(localContacts)
    .where(eq(localContacts.id, contactId))
    .limit(1);

  // Get opportunity data
  const [opp] = await db()
    .select()
    .from(localOpportunities)
    .where(eq(localOpportunities.contactId, contactId))
    .limit(1);

  // Get custom fields
  const uid = `ghl_${contactId}`;
  const fields = await db()
    .select()
    .from(contactCustomFields)
    .where(eq(contactCustomFields.contactUid, uid));

  const customFieldMap: Record<string, string> = {};
  for (const f of fields) {
    if (f.fieldValue) customFieldMap[f.fieldName] = f.fieldValue;
  }

  if (local) {
    return {
      name: local.fullName || `${local.firstName ?? ""} ${local.lastName ?? ""}`.trim(),
      email: local.email,
      phone: local.phone,
      website: local.website,
      companyName: local.companyName,
      tags: (local.tags as string[]) ?? [],
      stage: opp?.stageName ?? null,
      pipelineStage: opp?.stageName ?? null,
      monetaryValue: opp?.monetaryValue ?? null,
      source: local.source,
      customFields: customFieldMap,
    };
  }

  // Fall back to GHL API
  try {
    const data = await ghl.get<{
      contact: {
        id: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        website?: string;
        companyName?: string;
        tags?: string[];
        source?: string;
      };
    }>(`/contacts/${contactId}?locationId=${locationId()}`);

    return {
      name: `${data.contact.firstName ?? ""} ${data.contact.lastName ?? ""}`.trim() || "Unknown",
      email: data.contact.email ?? null,
      phone: data.contact.phone ?? null,
      website: data.contact.website ?? null,
      companyName: data.contact.companyName ?? null,
      tags: data.contact.tags ?? [],
      stage: opp?.stageName ?? null,
      pipelineStage: opp?.stageName ?? null,
      monetaryValue: opp?.monetaryValue ?? null,
      source: data.contact.source ?? null,
      customFields: customFieldMap,
    };
  } catch {
    return null;
  }
}

// ─── Call type detection ─────────────────────────────────────────────────────

export async function detectCallType(
  contactId: string
): Promise<"intro" | "follow_up"> {
  const dispositions = await db()
    .select({ outcome: callDispositions.outcome })
    .from(callDispositions)
    .where(eq(callDispositions.contactId, contactId));

  // Intro if no dispositions, or all are no_show
  const hasRealCall = dispositions.some((d) => d.outcome !== "no_show");
  return hasRealCall ? "follow_up" : "intro";
}

// ─── Call history & insights ─────────────────────────────────────────────────

export interface CallHistory {
  dispositions: Array<{
    outcome: string;
    notes: string | null;
    dispositionedAt: Date;
  }>;
  fathomSummaries: Array<{
    summary: string;
    startedAt: Date;
  }>;
  insights: Array<{
    wants: string | null;
    objections: string | null;
    nextSteps: string | null;
    redFlags: string | null;
    sentiment: string | null;
  }>;
}

export async function gatherCallHistory(contactId: string): Promise<CallHistory> {
  const [dispositions, callRecords, insightRecords] = await Promise.all([
    db()
      .select({
        outcome: callDispositions.outcome,
        notes: callDispositions.notes,
        dispositionedAt: callDispositions.dispositionedAt,
      })
      .from(callDispositions)
      .where(eq(callDispositions.contactId, contactId))
      .orderBy(desc(callDispositions.dispositionedAt)),

    db()
      .select({
        fathomSummary: calls.fathomSummary,
        startedAt: calls.startedAt,
      })
      .from(calls)
      .where(eq(calls.contactId, contactId))
      .orderBy(desc(calls.startedAt)),

    db()
      .select({
        wants: callInsights.wantsText,
        objections: callInsights.objectionsText,
        nextSteps: callInsights.nextStepsText,
        redFlags: callInsights.redFlagsText,
        sentiment: callInsights.sentimentLabel,
      })
      .from(callInsights)
      .where(eq(callInsights.contactId, contactId))
      .orderBy(desc(callInsights.analyzedAt)),
  ]);

  return {
    dispositions: dispositions.map((d) => ({
      outcome: d.outcome,
      notes: d.notes,
      dispositionedAt: d.dispositionedAt,
    })),
    fathomSummaries: callRecords
      .filter((c) => c.fathomSummary)
      .map((c) => ({
        summary: c.fathomSummary!,
        startedAt: c.startedAt,
      })),
    insights: insightRecords,
  };
}

// ─── Demo status ─────────────────────────────────────────────────────────────

export interface DemoInfo {
  status: string;
  clickupLink: string | null;
}

export async function gatherDemoStatus(contactId: string): Promise<DemoInfo | null> {
  const [link] = await db()
    .select()
    .from(demoGhlLinks)
    .where(eq(demoGhlLinks.ghlContactId, contactId))
    .limit(1);

  if (!link) return null;

  return {
    status: link.firstCallAt ? "Demo sent, call booked" : "Demo sent",
    clickupLink: link.clickupTaskId
      ? `https://app.clickup.com/t/${link.clickupTaskId}`
      : null,
  };
}

// ─── Proposal status ─────────────────────────────────────────────────────────

export async function gatherProposalStatus(
  contactId: string
): Promise<{ status: string; amount: number } | null> {
  const [proposal] = await db()
    .select({
      status: proposals.status,
      amount: proposals.totalAmount,
    })
    .from(proposals)
    .where(eq(proposals.ghlContactId, contactId))
    .orderBy(desc(proposals.createdAt))
    .limit(1);

  if (!proposal) return null;
  return { status: proposal.status, amount: proposal.amount };
}

// ─── Recent conversations ────────────────────────────────────────────────────

export interface RecentMessage {
  channel: string;
  body: string;
  date: string;
  direction: string;
}

export async function gatherRecentMessages(
  contactId: string,
  limit = 10
): Promise<RecentMessage[]> {
  const messages = await db()
    .select({
      body: localMessages.body,
      type: localMessages.type,
      direction: localMessages.direction,
      messageDate: localMessages.messageDate,
    })
    .from(localMessages)
    .where(eq(localMessages.contactId, contactId))
    .orderBy(desc(localMessages.messageDate))
    .limit(limit);

  return messages
    .filter((m) => m.body)
    .map((m) => ({
      channel: m.type ?? "unknown",
      body: m.body!,
      date: m.messageDate?.toISOString() ?? "",
      direction: m.direction ?? "unknown",
    }));
}

// ─── Website scraping via Firecrawl ──────────────────────────────────────────

export interface WebsiteData {
  summary: string;
  audience: string;
  currentMarketing: string;
}

export async function scrapeWebsite(url: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey || !url) return null;

  // Normalize URL
  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith("http")) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: normalizedUrl,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 15000,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const markdown = data?.data?.markdown;
    if (!markdown) return null;

    // Truncate to avoid blowing up the AI prompt
    return markdown.slice(0, 8000);
  } catch {
    return null;
  }
}
