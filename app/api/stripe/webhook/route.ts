import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, stripeEvents, agreementTemplates, tasks, users } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { stripe } from "@/lib/stripe/client";
import type Stripe from "stripe";
import { generateAgreementPdf } from "@/lib/pdf/render";
import { sendPaymentReceiptEmail } from "@/lib/email/resend";
import { dispatchWorkflowEvent, buildProposalPayload } from "@/lib/workflows/triggers";

const DEFAULT_MANAGEMENT_TERMS = `**Service Collaboration & Cooperation**

To maintain a fair and healthy long-term relationship, Kracked Retention reserves the right to temporarily **pause services** if cooperation or communication from the Client prevents effective service delivery.

---

**Governing Law**

This Agreement is governed by the laws of the State of Tennessee.`;

const DEFAULT_PROJECT_TERMS = `**Terms of Sale**

All sales are final and non-refundable. This Agreement is governed by the laws of the State of Tennessee.`;

/** Convert a client name into a Slack-safe channel slug, e.g. "Gage Flesher" → "gage-flesher" */
function toChannelSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
}

/**
 * Create two onboarding tasks for the rep who created the proposal:
 *   #[brand]-project  — internal team channel
 *   #[brand]-ecc      — external client chat
 * Runs fire-and-forget; errors are logged but never throw.
 */
async function createOnboardingTasks(proposalId: string) {
  try {
    const [proposal] = await db()
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId))
      .limit(1);
    if (!proposal) return;

    // Resolve the user who sent the proposal so tasks are assigned to them
    let userId: string | null = null;
    let userName: string | null = null;
    if (proposal.createdBy) {
      const [user] = await db()
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, proposal.createdBy))
        .limit(1);
      userId = user?.id ?? null;
      userName = user?.name ?? null;
    }

    const slug = toChannelSlug(proposal.contactName);
    const channelNames = [`#${slug}-project`, `#${slug}-ecc`];

    for (const channel of channelNames) {
      await db().insert(tasks).values({
        title: `Create Slack channel: ${channel}`,
        notes: `Onboarding for ${proposal.title}`,
        contactId: proposal.ghlContactId ?? null,
        contactName: proposal.contactName,
        priority: "high",
        ...(userId ? { userId, userName } : {}),
      });
    }

    console.log(`[webhook] Created onboarding tasks for proposal ${proposalId} (${slug})`);
  } catch (err) {
    console.error("[webhook] Failed to create onboarding tasks:", err);
  }
}

/**
 * Create a Stripe subscription after all deposit instalments are paid.
 * Sets trial_end so the first subscription charge is skipped (deposit covers it).
 */
async function createSubscriptionForDeposit(proposal: {
  id: string;
  title: string;
  totalAmount: number;
  currency: string;
  billingInterval: string | null;
  billingIntervalCount: number | null;
  startDate: Date | null;
  stripeCustomerId: string | null;
  depositTotal: number | null;
  contactName: string;
}) {
  if (!proposal.stripeCustomerId) {
    console.error(`[webhook] Cannot create subscription for ${proposal.id}: no Stripe customer`);
    return;
  }

  const interval = (proposal.billingInterval ?? "month") as "day" | "week" | "month" | "year";
  const intervalCount = proposal.billingIntervalCount ?? 1;
  const startDate = proposal.startDate ?? new Date();
  const now = new Date();

  // Calculate trial_end = startDate + one billing cycle (so first charge is skipped)
  const trialEnd = new Date(startDate);
  if (interval === "day") trialEnd.setDate(trialEnd.getDate() + intervalCount);
  else if (interval === "week") trialEnd.setDate(trialEnd.getDate() + intervalCount * 7);
  else if (interval === "month") trialEnd.setMonth(trialEnd.getMonth() + intervalCount);
  else if (interval === "year") trialEnd.setFullYear(trialEnd.getFullYear() + intervalCount);

  // Ensure trial_end is in the future (Stripe requires it)
  const trialEndUnix = Math.max(
    Math.floor(trialEnd.getTime() / 1000),
    Math.floor(Date.now() / 1000) + 86400 // at least 24 hours from now
  );

  const price = await stripe().prices.create({
    currency: proposal.currency,
    unit_amount: Math.round(proposal.totalAmount * 100),
    recurring: { interval, interval_count: intervalCount },
    product_data: {
      name: proposal.title,
      metadata: { proposal_id: proposal.id },
    },
  });

  const subscriptionParams: Stripe.SubscriptionCreateParams = {
    customer: proposal.stripeCustomerId,
    items: [{ price: price.id }],
    trial_end: trialEndUnix,
    metadata: { proposal_id: proposal.id },
  };

  // If start date is in the future, anchor billing to that date
  if (startDate > now) {
    subscriptionParams.billing_cycle_anchor = Math.floor(startDate.getTime() / 1000);
    subscriptionParams.proration_behavior = "none";
  }

  const subscription = await stripe().subscriptions.create(subscriptionParams);

  // Update the proposal: deposits fully paid, subscription active
  const depositTotal = proposal.depositTotal ?? proposal.totalAmount;
  await db()
    .update(proposals)
    .set({
      status: "paid",
      paidAt: new Date(),
      depositsPaidTotal: depositTotal,
      subscriptionCreatedAt: new Date(),
      stripeSubscriptionId: subscription.id,
      updatedAt: new Date(),
    })
    .where(eq(proposals.id, proposal.id));

  createOnboardingTasks(proposal.id).catch(() => {});
  buildProposalPayload(proposal.id).then((payload) =>
    dispatchWorkflowEvent("proposal.paid", payload)
  ).catch(() => {});

  console.log(`[webhook] Created subscription ${subscription.id} for deposit proposal ${proposal.id}`);
}

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
    autoRenew: proposal.autoRenew,
    listAmount: proposal.listAmount,
    discountType: proposal.discountType,
    discountValue: proposal.discountValue,
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
        // Check if this is a deposit instalment payment
        if (metadata.is_deposit === "true" && metadata.proposal_id) {
          await db()
            .update(proposalInstalments)
            .set({ status: "paid", paidAt: new Date() })
            .where(eq(proposalInstalments.stripeInvoiceId, stripeInvoiceId));

          const proposalId = metadata.proposal_id;
          const [proposal] = await db()
            .select()
            .from(proposals)
            .where(eq(proposals.id, proposalId))
            .limit(1);

          if (proposal) {
            // Get the amount from the paid instalment
            const [paidInst] = await db()
              .select()
              .from(proposalInstalments)
              .where(eq(proposalInstalments.stripeInvoiceId, stripeInvoiceId))
              .limit(1);
            const newPaidTotal = (proposal.depositsPaidTotal ?? 0) + (paidInst?.amount ?? 0);

            // Check if all deposit instalments are now paid
            const allDeposits = await db()
              .select()
              .from(proposalInstalments)
              .where(eq(proposalInstalments.proposalId, proposalId));
            const depositInstalments = allDeposits.filter(i => i.isDeposit);
            const allDepositsPaid = depositInstalments.every(i => i.status === "paid");

            if (allDepositsPaid) {
              // All deposits paid — create the Stripe subscription
              await createSubscriptionForDeposit(proposal);
            } else {
              // Partial deposits paid
              await db()
                .update(proposals)
                .set({
                  status: "partial",
                  depositsPaidTotal: newPaidTotal,
                  updatedAt: new Date(),
                })
                .where(eq(proposals.id, proposalId));
            }
          }

        // Check if this matches a regular instalment
        } else if (metadata.instalment_number && metadata.proposal_id) {
          await db()
            .update(proposalInstalments)
            .set({ status: "paid", paidAt: new Date() })
            .where(eq(proposalInstalments.stripeInvoiceId, stripeInvoiceId));

          // Check if all instalments are paid → update parent proposal status
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
            createOnboardingTasks(proposalId).catch(() => {});
            buildProposalPayload(proposalId, { stripeInvoiceId }).then((payload) =>
              dispatchWorkflowEvent("proposal.paid", payload)
            ).catch(() => {});
          } else {
            // Some but not all instalments paid — mark as partial
            await db()
              .update(proposals)
              .set({ status: "partial", updatedAt: new Date() })
              .where(eq(proposals.id, proposalId));
          }

          // Send receipt on first instalment
          if (metadata.instalment_number === "1") {
            sendReceiptForProposal(proposalId).catch((e) =>
              console.error("[webhook] Receipt email failed:", e)
            );
          }
        } else if (metadata.proposal_id) {
          // Single payment — match by proposal ID (stripeInvoiceId may not be stored yet)
          await db()
            .update(proposals)
            .set({ status: "paid", paidAt: new Date(), stripeInvoiceId, updatedAt: new Date() })
            .where(eq(proposals.id, metadata.proposal_id));

          sendReceiptForProposal(metadata.proposal_id).catch((e) =>
            console.error("[webhook] Receipt email failed:", e)
          );
          createOnboardingTasks(metadata.proposal_id).catch(() => {});
          buildProposalPayload(metadata.proposal_id, { stripeInvoiceId }).then((payload) =>
            dispatchWorkflowEvent("proposal.paid", payload)
          ).catch(() => {});
        } else {
          // No proposal metadata on the invoice (e.g. a management/subscription
          // first invoice, where the proposal_id lives on the subscription, not
          // the invoice). Correlate it carefully so we NEVER mark the wrong one:
          //   1) a stored invoice id, 2) the invoice's subscription metadata,
          //   3) customer + matching amount — a single confident match only.
          const byInvoice = await db()
            .update(proposals)
            .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
            .where(and(eq(proposals.stripeInvoiceId, stripeInvoiceId), ne(proposals.status, "paid")))
            .returning({ id: proposals.id });
          let matchedId: string | null = byInvoice[0]?.id ?? null;

          // 2) the invoice's subscription carries the proposal_id
          const subField = (obj as Stripe.Invoice & { subscription?: string | { id: string } }).subscription;
          if (!matchedId && subField) {
            try {
              const subId = typeof subField === "string" ? subField : subField.id;
              const sub = await stripe().subscriptions.retrieve(subId);
              const pid = sub.metadata?.proposal_id;
              if (pid) {
                const r = await db()
                  .update(proposals)
                  .set({ status: "paid", paidAt: new Date(), stripeSubscriptionId: subId, stripeInvoiceId, updatedAt: new Date() })
                  .where(and(eq(proposals.id, pid), ne(proposals.status, "paid")))
                  .returning({ id: proposals.id });
                matchedId = r[0]?.id ?? null;
              }
            } catch (e) {
              console.error("[webhook] subscription lookup failed:", e);
            }
          }

          // 3) customer + amount — only when exactly ONE unpaid proposal for this
          //    customer matches the paid amount, so other proposals are untouched.
          if (!matchedId && obj.customer) {
            const custId = typeof obj.customer === "string" ? obj.customer : obj.customer.id;
            const amountDollars = (obj.amount_paid ?? 0) / 100;
            const candidates = await db()
              .select()
              .from(proposals)
              .where(and(eq(proposals.stripeCustomerId, custId), ne(proposals.status, "paid")));
            const byAmount = candidates.filter((p) => Math.abs((p.totalAmount ?? 0) - amountDollars) < 0.5);
            if (byAmount.length === 1) {
              await db()
                .update(proposals)
                .set({ status: "paid", paidAt: new Date(), stripeInvoiceId, updatedAt: new Date() })
                .where(eq(proposals.id, byAmount[0].id));
              matchedId = byAmount[0].id;
            } else {
              console.warn(`[webhook] invoice.paid ${stripeInvoiceId}: no confident proposal match (customer=${custId}, $${amountDollars}, unpaid=${candidates.length}, amountMatch=${byAmount.length})`);
            }
          }

          if (matchedId) {
            sendReceiptForProposal(matchedId).catch((e) => console.error("[webhook] Receipt email failed:", e));
            createOnboardingTasks(matchedId).catch(() => {});
            buildProposalPayload(matchedId, { stripeInvoiceId }).then((payload) =>
              dispatchWorkflowEvent("proposal.paid", payload)
            ).catch(() => {});
          }
        }
        break;
      }

      case "checkout.session.completed": {
        // Subscription first payment
        const session = event.data.object as Stripe.Checkout.Session;
        const sessionMeta = session.metadata ?? {};
        if (sessionMeta.proposal_id) {
          const subId = typeof session.subscription === "string" ? session.subscription : null;
          const [updated] = await db()
            .update(proposals)
            .set({
              status: "paid",
              paidAt: new Date(),
              stripeSubscriptionId: subId,
              updatedAt: new Date(),
            })
            .where(eq(proposals.id, sessionMeta.proposal_id))
            .returning({ autoRenew: proposals.autoRenew });

          // Paid-in-full term (auto-renew OFF): set the subscription to cancel at the end
          // of its single period, so it bills exactly once and NEVER renews — while still
          // counting as an active subscription (management client / MRR) until the term ends.
          // Retry a few times: this guarantees no second charge, so it must not be left to a
          // single fallible call (the renewal it prevents is the whole point of "pay in full").
          if (subId && updated?.autoRenew === false) {
            let cancelSet = false;
            for (let attempt = 1; attempt <= 3 && !cancelSet; attempt++) {
              try {
                await stripe().subscriptions.update(subId, { cancel_at_period_end: true });
                cancelSet = true;
                console.log(`[webhook] Prepaid term ${sessionMeta.proposal_id}: subscription ${subId} set to cancel at period end`);
              } catch (e) {
                console.error(`[webhook] Attempt ${attempt}/3 to set cancel_at_period_end for ${subId} failed:`, e);
              }
            }
            if (!cancelSet) {
              console.error(`[webhook] CRITICAL: could not stop renewal on prepaid subscription ${subId} (proposal ${sessionMeta.proposal_id}) — needs manual cancel_at_period_end in Stripe.`);
            }
          }

          sendReceiptForProposal(sessionMeta.proposal_id).catch((e) =>
            console.error("[webhook] Receipt email failed:", e)
          );
          createOnboardingTasks(sessionMeta.proposal_id).catch(() => {});
          buildProposalPayload(sessionMeta.proposal_id).then((payload) =>
            dispatchWorkflowEvent("proposal.paid", payload)
          ).catch(() => {});
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
          // A prepaid term (auto-renew OFF) is SET to cancel at period end by design —
          // that is not an early cancellation, so it must not stamp cancelledAt (which
          // would wrongly read as churn today). Only a genuinely auto-renewing client
          // choosing to cancel counts as churn-on-cancellation-day.
          await db()
            .update(proposals)
            .set({ cancelledAt: new Date(), updatedAt: new Date() })
            .where(and(eq(proposals.stripeSubscriptionId, sub.id), ne(proposals.autoRenew, false)));
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
