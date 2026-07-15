import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, stripeEvents } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { hasStripe, stripe } from "@/lib/stripe/client";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";

/**
 * Read-only billing timeline for one proposal — every invoice/payment/reminder/subscription event,
 * so nothing ever happens to a client invisibly. Sources merged, deduped, newest-first:
 *   1. app milestones (proposal created / sent / signed) from the proposal row,
 *   2. our LOGGED Stripe webhook events for this proposal (paid, failed, voided, reminder-sent,
 *      subscription lifecycle) from stripe_events,
 *   3. LIVE Stripe backfill of each invoice's status_transitions (created/finalized/paid/voided)
 *      so history shows even for events captured before invoice.sent/finalized were subscribed.
 * Admin-only. Never mutates anything.
 */

interface BillingEvent {
  at: string; // ISO
  kind: "proposal_created" | "proposal_sent" | "proposal_signed" | "created" | "finalized"
    | "reminder" | "paid" | "failed" | "voided" | "uncollectible" | "subscription" | "subscription_cancelled";
  label: string;
  amount?: number | null;
  currency?: string | null;
  invoiceNumber?: string | null;
  hostedUrl?: string | null;
  source: "app" | "stripe";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function num(v: any): number | null { return v == null ? null : Number(v) / 100; }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser().catch(() => null);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
  if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const instalments = await db().select().from(proposalInstalments).where(eq(proposalInstalments.proposalId, id));
  const invoiceIds = [proposal.stripeInvoiceId, ...instalments.map((i) => i.stripeInvoiceId)].filter((x): x is string => !!x);
  const custId = proposal.stripeCustomerId;
  const subId = proposal.stripeSubscriptionId;

  const events: BillingEvent[] = [];

  // 1) App milestones
  if (proposal.createdAt) events.push({ at: proposal.createdAt.toISOString(), kind: "proposal_created", label: "Proposal created", source: "app" });
  if (proposal.sentAt) events.push({ at: proposal.sentAt.toISOString(), kind: "proposal_sent", label: "Proposal sent to client", source: "app" });
  if (proposal.signedAt) events.push({ at: proposal.signedAt.toISOString(), kind: "proposal_signed", label: "Signed by client", source: "app" });

  // 2) Our logged Stripe events, matched to this proposal
  try {
    const recent = await db().select().from(stripeEvents).orderBy(desc(stripeEvents.processedAt)).limit(400);
    for (const ev of recent) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = (ev.payload as any)?.data?.object ?? {};
      const meta = obj.metadata ?? {};
      const matches =
        meta.proposal_id === id ||
        (!!custId && obj.customer === custId) ||
        (!!subId && (obj.subscription === subId || obj.id === subId)) ||
        (!!obj.id && invoiceIds.includes(obj.id));
      if (!matches) continue;
      const at = (ev.processedAt instanceof Date ? ev.processedAt : new Date(ev.processedAt)).toISOString();
      const amt = obj.amount_paid != null ? num(obj.amount_paid) : num(obj.amount_due);
      const base = { at, amount: amt, currency: obj.currency ?? null, invoiceNumber: obj.number ?? null, hostedUrl: obj.hosted_invoice_url ?? null, source: "stripe" as const };
      switch (ev.type) {
        case "invoice.sent": events.push({ ...base, kind: "reminder", label: "Stripe emailed the invoice to the client" }); break;
        case "invoice.finalized": events.push({ ...base, kind: "finalized", label: "Invoice finalized" }); break;
        case "invoice.paid": events.push({ ...base, kind: "paid", label: "Invoice paid" }); break;
        case "invoice.payment_failed": events.push({ ...base, kind: "failed", label: "Payment failed (card declined)" }); break;
        case "invoice.voided": events.push({ ...base, kind: "voided", label: "Invoice voided" }); break;
        case "invoice.marked_uncollectible": events.push({ ...base, kind: "uncollectible", label: "Invoice marked uncollectible" }); break;
        case "checkout.session.completed": events.push({ at, kind: "paid", label: "Payment received — subscription started", amount: num(obj.amount_total), currency: obj.currency ?? null, source: "stripe" }); break;
        case "customer.subscription.created": events.push({ at, kind: "subscription", label: "Subscription started", source: "stripe" }); break;
        case "customer.subscription.updated": if (obj.cancel_at_period_end) events.push({ at, kind: "subscription", label: "Subscription set to end at period end", source: "stripe" }); break;
        case "customer.subscription.deleted": events.push({ at, kind: "subscription_cancelled", label: "Subscription cancelled", source: "stripe" }); break;
      }
    }
  } catch (e) {
    console.error("[billing-activity] stripe_events read failed:", e);
  }

  // 3) Live Stripe: the customer's real invoices (+ any tracked ids the list might miss) — the
  //    source of truth for the invoice lifecycle + current status, so a re-issued/replaced invoice
  //    is reflected, not a stale tracked id.
  let summary: { label: string; tone: "paid" | "pending" | "overdue" | "failed" | "none"; amount?: number | null; currency?: string | null; hostedUrl?: string | null; dueDate?: string | null } = { label: "Not yet invoiced", tone: "none" };
  if (hasStripe() && (custId || invoiceIds.length)) {
    const invMap = new Map<string, Stripe.Invoice>();
    try {
      if (custId) { const list = await stripe().invoices.list({ customer: custId, limit: 20 }); for (const inv of list.data) if (inv.id) invMap.set(inv.id, inv); }
    } catch (e) { console.error("[billing-activity] invoice list failed:", e); }
    for (const invId of invoiceIds) {
      if (!invMap.has(invId)) { try { invMap.set(invId, await stripe().invoices.retrieve(invId)); } catch (e) { console.error(`[billing-activity] invoice ${invId} retrieve failed:`, e); } }
    }
    let summaryIsOpen = false;
    for (const inv of invMap.values()) {
      const st = inv.status_transitions ?? {};
      const base = { currency: inv.currency ?? null, invoiceNumber: inv.number ?? null, hostedUrl: inv.hosted_invoice_url ?? null, source: "stripe" as const };
      if (inv.created) events.push({ ...base, at: new Date(inv.created * 1000).toISOString(), kind: "created", label: "Invoice created", amount: num(inv.amount_due) });
      if (st.finalized_at) events.push({ ...base, at: new Date(st.finalized_at * 1000).toISOString(), kind: "finalized", label: "Invoice finalized", amount: num(inv.amount_due) });
      if (st.paid_at) events.push({ ...base, at: new Date(st.paid_at * 1000).toISOString(), kind: "paid", label: "Invoice paid", amount: num(inv.amount_paid) });
      if (st.voided_at) events.push({ ...base, at: new Date(st.voided_at * 1000).toISOString(), kind: "voided", label: "Invoice voided", amount: num(inv.amount_due) });
      // Summary: an OPEN invoice (action needed) takes priority; otherwise a PAID one.
      if (inv.status === "open") {
        const due = inv.due_date ? new Date(inv.due_date * 1000) : null;
        const overdue = due ? due.getTime() < Date.now() : false;
        summary = { label: overdue ? "Overdue" : "Awaiting payment", tone: overdue ? "overdue" : "pending", amount: num(inv.amount_due), currency: inv.currency, hostedUrl: inv.hosted_invoice_url ?? null, dueDate: due ? due.toISOString() : null };
        summaryIsOpen = true;
      } else if (inv.status === "paid" && !summaryIsOpen) {
        summary = { label: "Paid", tone: "paid", amount: num(inv.amount_paid), currency: inv.currency, hostedUrl: inv.hosted_invoice_url ?? null };
      }
    }
  }
  if (summary.tone === "none") {
    if (proposal.status === "paid") summary = { label: "Paid", tone: "paid", amount: proposal.totalAmount, currency: proposal.currency };
    else if (proposal.status === "signed") summary = { label: "Signed — awaiting payment setup", tone: "pending" };
  }

  // Dedup (same kind + invoice + calendar day) and sort newest-first
  const seen = new Set<string>();
  const merged = events
    .filter((e) => { const k = `${e.kind}|${e.invoiceNumber ?? ""}|${e.at.slice(0, 10)}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.at.localeCompare(a.at));

  return NextResponse.json({ events: merged, summary });
}
