import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, stripeEvents, agreementTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe/client";
import type Stripe from "stripe";
import { generateAgreementPdf } from "@/lib/pdf/render";
import { sendPaymentReceiptEmail } from "@/lib/email/resend";

const DEFAULT_MANAGEMENT_TERMS = `**Service Collaboration & Cooperation**

To maintain a fair and healthy long-term relationship, Kracked Retention reserves the right to temporarily **pause services** if cooperation or communication from the Client prevents effective service delivery.

---

**Governing Law**

This Agreement is governed by the laws of the State of Tennessee.`;

const DEFAULT_PROJECT_TERMS = `**Terms of Sale**

All sales are final and non-refundable. This Agreement is governed by the laws of the State of Tennessee.`;

async function sendReceiptForProposal(proposalId: string) {
  const [proposal] = await db()
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);

  if (!proposal) return;

  const instalments =
    proposal.paymentStructure === "instalment"
      ? await db()
          .select()
          .from(proposalInstalments)
          .where(eq(proposalInstalments.proposalId, proposalId))
      : [];

  const [template] = await db()
    .select()
    .from(agreementTemplates)
    .where(eq(agreementTemplates.type, proposal.type))
    .limit(1);

  const agreementTerms =
    template?.body ??
    (proposal.type === "management" ? DEFAULT_MANAGEMENT_TERMS : DEFAULT_PROJECT_TERMS);

  const pdfBuffer = await generateAgreementPdf({
    id: proposal.id,
    title: proposal.title,
    type: proposal.type,
    contactName: proposal.contactName,
    contactEmail: proposal.contactEmail,
    totalAmount: proposal.totalAmount,
    currency: proposal.currency,
    serviceDescription: proposal.serviceDescription,
    paymentStructure: proposal.paymentStructure,
    billingInterval: proposal.billingInterval,
    billingIntervalCount: proposal.billingIntervalCount,
    startDate: proposal.startDate,
    endDate: proposal.endDate,
    signedAt: proposal.signedAt,
    instalments,
    agreementTerms,
    signatureData: proposal.signatureData,
  });

  await sendPaymentReceiptEmail(
    {
      contactName: proposal.contactName,
      contactEmail: proposal.contactEmail,
      title: proposal.title,
      totalAmount: proposal.totalAmount,
      currency: proposal.currency,
    },
    pdfBuffer
  );
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let rawBody: Uint8Array;
  try {
    rawBody = await req.bytes();
  } catch {
    return NextResponse.json({ error: "Cannot read body" }, { status: 400 });
  }

  const sig = req.headers.get("stripe-signature") ?? "";

  // Support two signing secrets: snapshot payloads + thin payloads
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_THIN,
  ].filter((s): s is string => Boolean(s));

  if (secrets.length === 0) {
    console.error("[stripe/webhook] No webhook secrets configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = stripe().webhooks.constructEvent(rawBody, sig, secret);
      break;
    } catch {
      // try next secret
    }
  }

  if (!event) {
    console.error("[stripe/webhook] Signature verification failed with all configured secrets");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency check
  const existing = await db()
    .select({ id: stripeEvents.id })
    .from(stripeEvents)
    .where(eq(stripeEvents.stripeEventId, event.id))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Log event
  await db().insert(stripeEvents).values({
    stripeEventId: event.id,
    type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });

  const obj = event.data.object as Stripe.Invoice;
  const stripeInvoiceId = obj.id;
  const metadata = obj.metadata ?? {};

  try {
    switch (event.type) {
      case "invoice.paid": {
        // Check if this matches a proposal instalment
        if (metadata.instalment_number && metadata.proposal_id) {
          await db()
            .update(proposalInstalments)
            .set({ status: "paid", paidAt: new Date() })
            .where(eq(proposalInstalments.stripeInvoiceId, stripeInvoiceId));

          // Check if all instalments are paid → update parent proposal
          const proposalId = metadata.proposal_id;
          const allInstalments = await db()
            .select()
            .from(proposalInstalments)
            .where(eq(proposalInstalments.proposalId, proposalId));
          const allPaid = allInstalments.every((i) => i.status === "paid");
          if (allPaid) {
            await db()
              .update(proposals)
              .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
              .where(eq(proposals.id, proposalId));
          }

          // Send receipt on first instalment
          if (metadata.instalment_number === "1") {
            sendReceiptForProposal(proposalId).catch((e) =>
              console.error("[webhook] Receipt email failed:", e)
            );
          }
        } else if (metadata.proposal_id) {
          // Single payment
          await db()
            .update(proposals)
            .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
            .where(eq(proposals.stripeInvoiceId, stripeInvoiceId));

          sendReceiptForProposal(metadata.proposal_id).catch((e) =>
            console.error("[webhook] Receipt email failed:", e)
          );
        } else {
          // Single payment matched by invoice id (no metadata)
          await db()
            .update(proposals)
            .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
            .where(eq(proposals.stripeInvoiceId, stripeInvoiceId));
        }
        break;
      }

      case "checkout.session.completed": {
        // Subscription first payment
        const session = event.data.object as Stripe.Checkout.Session;
        const sessionMeta = session.metadata ?? {};
        if (sessionMeta.proposal_id) {
          await db()
            .update(proposals)
            .set({
              status: "paid",
              paidAt: new Date(),
              stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : null,
              updatedAt: new Date(),
            })
            .where(eq(proposals.id, sessionMeta.proposal_id));

          sendReceiptForProposal(sessionMeta.proposal_id).catch((e) =>
            console.error("[webhook] Receipt email failed:", e)
          );
        }
        break;
      }

      case "invoice.payment_failed": {
        if (metadata.instalment_number) {
          await db()
            .update(proposalInstalments)
            .set({ status: "failed" })
            .where(eq(proposalInstalments.stripeInvoiceId, stripeInvoiceId));
        } else {
          await db()
            .update(proposals)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(proposals.stripeInvoiceId, stripeInvoiceId));
        }
        break;
      }

      case "invoice.voided": {
        await db()
          .update(proposals)
          .set({ status: "void", updatedAt: new Date() })
          .where(eq(proposals.stripeInvoiceId, stripeInvoiceId));
        break;
      }

      case "customer.subscription.updated": {
        // When a client cancels, Stripe sets cancel_at_period_end = true.
        // We record cancelledAt immediately so MRR drops on cancellation day,
        // not at the end of the billing cycle.
        const sub = event.data.object as Stripe.Subscription;
        if (sub.cancel_at_period_end) {
          await db()
            .update(proposals)
            .set({ cancelledAt: new Date(), updatedAt: new Date() })
            .where(eq(proposals.stripeSubscriptionId, sub.id));
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`[stripe/webhook] Handler error for ${event.type}:`, err);
  }

  return NextResponse.json({ ok: true });
}
