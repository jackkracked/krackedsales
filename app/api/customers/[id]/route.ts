import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customers, customerPayments, localContacts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import type { UnifiedContact } from "@/lib/contacts/types";

export const dynamic = "force-dynamic";

/**
 * Build a modal-ready UnifiedContact from a linked contact row. A real GHL contact (matched) opens
 * the full modal (source "ghl"); a backfilled Stripe-only contact (id `cust_…`) opens the same modal
 * shell with GHL-only tabs hidden (treated as non-GHL). Billing lives in the slide-over, not here.
 */
async function resolveContact(contactId: string | null): Promise<UnifiedContact | null> {
  if (!contactId) return null;
  const [lc] = await db().select().from(localContacts).where(eq(localContacts.id, contactId)).limit(1);
  if (!lc) return null;
  const isBackfilled = contactId.startsWith("cust_");
  const name = lc.fullName || [lc.firstName, lc.lastName].filter(Boolean).join(" ") || lc.email || "Customer";
  const now = new Date().toISOString();
  return {
    uid: isBackfilled ? contactId : `ghl_${contactId}`,
    source: isBackfilled ? "comment_lead" : "ghl",
    name,
    email: lc.email ?? null,
    phone: lc.phone ?? null,
    website: lc.website ?? null,
    platform: null,
    ghlContactId: isBackfilled ? null : contactId,
    opportunityId: null,
    stage: null,
    stageId: null,
    pipelineId: null,
    opportunityStatus: null,
    monetaryValue: null,
    tags: Array.isArray(lc.tags) ? (lc.tags as string[]) : [],
    commentLeadId: null,
    commentText: null,
    brandCategory: null,
    hasDemo: false,
    hasProposal: false,
    proposalStatus: null,
    hasAudit: false,
    auditStatus: null,
    awaitingReply: false,
    lastChannel: null,
    daysSinceLastTouch: 0,
    daysInCurrentStage: null,
    lastActivityAt: (lc.updatedAt ?? new Date()).toISOString?.() ?? now,
    createdAt: (lc.createdAtGhl ?? lc.syncedAt ?? new Date()).toISOString?.() ?? now,
    assignedTo: lc.assignedUserId ?? null,
    dnd: !!lc.dnd,
    responseStatus: null,
    reachableChannels: [lc.email ? "email" : null, lc.phone ? "sms" : null].filter(Boolean) as string[],
    autoSequence: false,
    autoSequenceAt: null,
    followupScheduledAt: null,
  };
}

interface Payment {
  id: string;
  at: string;
  amount: number; // net cents
  currency: string;
  source: string; // 'invoice' | 'charge' | 'manual'
  manual: boolean; // true => editable/deletable in the UI
  method: string | null; // manual only: 'wire' | 'bill_com' | 'check' | 'ach' | 'cash' | 'other'
  note: string | null; // manual only
  stripeUrl: string | null; // Stripe dashboard link for Stripe-sourced rows
}

/** Build a Stripe dashboard deep-link from a stored payment id. Manual rows have none. */
function stripeDashboardUrl(stripeId: string, source: string): string | null {
  if (source === "manual" || !stripeId || stripeId.startsWith("manual_")) return null;
  if (stripeId.startsWith("in_")) return `https://dashboard.stripe.com/invoices/${stripeId}`;
  if (stripeId.startsWith("ch_") || stripeId.startsWith("py_") || stripeId.startsWith("pi_"))
    return `https://dashboard.stripe.com/payments/${stripeId}`;
  return null;
}

/**
 * One customer's detail for the slide-over. The payments timeline is read from the
 * `customer_payments` table — the SAME source that powers the lifetime-value / count
 * aggregates, so the list always matches the totals and includes invoice + charge +
 * manual payments. (The previous live-charges fetch missed every invoice / ACH / wire
 * payment, which is why most customers wrongly showed "no payments on record".)
 * Admin-only, read-only.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser().catch(() => null);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const [customer] = await db().select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db()
    .select({
      id: customerPayments.id,
      stripeId: customerPayments.stripeId,
      source: customerPayments.source,
      amountNet: customerPayments.amountNet,
      currency: customerPayments.currency,
      paidAt: customerPayments.paidAt,
      method: customerPayments.method,
      note: customerPayments.note,
    })
    .from(customerPayments)
    .where(eq(customerPayments.dedupeKey, customer.dedupeKey))
    .orderBy(desc(customerPayments.paidAt));

  const payments: Payment[] = rows.map((r) => ({
    id: r.id,
    at: (r.paidAt instanceof Date ? r.paidAt : new Date(r.paidAt)).toISOString(),
    amount: r.amountNet,
    currency: r.currency ?? "usd",
    source: r.source,
    manual: r.source === "manual",
    method: r.method ?? null,
    note: r.note ?? null,
    stripeUrl: stripeDashboardUrl(r.stripeId, r.source),
  }));

  const contact = await resolveContact(customer.contactId);
  return NextResponse.json({ customer, payments, contact });
}

/** Set a customer's manual acquisition source (Facebook / Instagram / TikTok / Other, extensible). Admin-only. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser().catch(() => null);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({} as { source?: unknown }));
  let source: string | null = null;
  if (body.source != null) {
    if (typeof body.source !== "string") return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    source = body.source.trim().slice(0, 40) || null;
  }

  const [updated] = await db()
    .update(customers)
    .set({ source, updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning({ id: customers.id, source: customers.source });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, source: updated.source });
}
