import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, stripeEvents, agreementTemplates, tasks, users, localStripeInvoices } from "@/lib/db/schema";
import { eq, and, ne, isNull, notInArray, gt } from "drizzle-orm";
import { stripe } from "@/lib/stripe/client";
import type Stripe from "stripe";
import { syncStripeEventToMirror } from "@/lib/stripe/sync";
import { generateAgreementPdf } from "@/lib/pdf/render";
import { sendPaymentReceiptEmail, sendRenderedEmail } from "@/lib/email/resend";
import { renderTransactional } from "@/lib/reminders/transactional";
import { dispatchWorkflowEvent, buildProposalPayload } from "@/lib/workflows/triggers";
import { settleDeposits } from "@/lib/proposals/deposit-billing";
import { issueNextInstalmentInvoice, authoriseFutureCharges } from "@/lib/proposals/instalment-billing";
import { fulfillNinetyDayCheckout } from "@/lib/proposals/ninety-day-fulfillment";
import { MONTHS_IN_TERM } from "@/lib/proposals/ninety-day-billing";
import { postToSalesChannel } from "@/lib/proposals/slack-notify";
import { PAID_TERMINAL_STATUSES } from "@/lib/proposals/status";
import { routeToCloser } from "@/lib/proposals/credit";

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
/**
 * Onboarding tasks, but only the first time.
 *
 * WHY THIS EXISTS
 * Onboarding fires when a proposal becomes fully paid. For a plan paid in instalments that
 * moment is months after the client actually started: the nine clients being caught up in
 * September 2026 were signed and onboarded in July and August. Firing again would hand the rep
 * a second "Create Slack channel: #client-project" task for a channel that has existed for
 * weeks, which teaches people to ignore their task list.
 *
 * Keyed on the task we would create, so it is correct even for tasks created by an older code
 * path, and it needs no new column.
 */
async function createOnboardingTasksOnce(proposalId: string) {
  const [proposal] = await db()
    .select({ contactName: proposals.contactName, signedAt: proposals.signedAt })
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!proposal) return;

  // TWO TESTS, because neither alone is enough.
  //
  // The task check misses anyone onboarded outside the task system, which is all nine clients
  // being caught up here: they have zero "Create Slack channel" tasks and would each get a
  // fresh pair for a client live since July.
  //
  // So age decides it too. A plan whose final instalment lands months after signature is a
  // client who started long ago; onboarding them "now" is noise in someone's task list.
  const SIGNED_LONG_AGO_DAYS = 30;
  const signedDaysAgo = proposal.signedAt
    ? (Date.now() - proposal.signedAt.getTime()) / 86_400_000
    : 0;
  if (signedDaysAgo > SIGNED_LONG_AGO_DAYS) {
    console.log(
      `[webhook] ${proposal.contactName} signed ${Math.round(signedDaysAgo)} days ago; ` +
        `final payment landed now, so no onboarding tasks created`,
    );
    return;
  }

  const slug = toChannelSlug(proposal.contactName);
  const [existing] = await db()
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.title, `Create Slack channel: #${slug}-project`))
    .limit(1);
  if (existing) {
    console.log(`[webhook] ${proposal.contactName} was already onboarded; no duplicate tasks`);
    return;
  }
  await createOnboardingTasks(proposalId);
}

async function createOnboardingTasks(proposalId: string) {
  try {
    const [proposal] = await db()
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId))
      .limit(1);
    if (!proposal) return;

    // Onboarding tasks go to the deal's CLOSER (the admin's choice, else the creator), falling
    // back to the creator if the closer has left.
    let userId: string | null = null;
    let userName: string | null = null;
    const ownerId = await routeToCloser(proposal);
    if (ownerId) {
      const [user] = await db()
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, ownerId))
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

// Deposit invoicing, reconciliation, and subscription creation now live in one
// money-safe module: lib/proposals/deposit-billing.ts (settleDeposits). The webhook
// and the admin override both go through it, so they can never disagree.

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
    discountScope: proposal.discountScope,
    startDate: proposal.startDate,
    endDate: proposal.endDate,
    signedAt: proposal.signedAt,
    instalments,
    agreementTerms,
    signatureData: proposal.signatureData,
  });

  // Prefer the editable "payment_receipt" template; fall back to the built-in receipt.
  // Both keep the signed-agreement PDF attached and copy Gage.
  const templated = await renderTransactional("payment_receipt", proposal);
  if (templated) {
    const recipients = [proposal.contactEmail, "gage@krackedretention.com"].filter((e): e is string => !!e);
    const filename = `kracked-retention-receipt-${proposal.contactName.toLowerCase().replace(/\s+/g, "-")}.pdf`;
    await sendRenderedEmail(recipients, templated.subject, templated.html, undefined, [{ filename, content: pdfBuffer }]);
  } else {
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

  // Keep the local Stripe mirror (the KPI read source) current in real time. Non-fatal:
  // a failure here must never break the money-critical business logic below.
  await syncStripeEventToMirror(event).catch(() => {});

  const obj = event.data.object as Stripe.Invoice;
  const stripeInvoiceId = obj.id;
  const metadata = obj.metadata ?? {};

  try {
    switch (event.type) {
      case "invoice.paid": {
        // A ZERO-VALUE invoice is never evidence that a deal is paid. Stripe emits one
        // automatically whenever a subscription opens with a trial (and for $0 proration
        // lines), and marks it "paid" instantly. On 2026-08-05 that flipped five
        // part-paid proposals to "paid", emailed four clients a receipt and posted false
        // "Paid: $4,500" Slack alerts. Nothing downstream of here is safe to run for $0.
        if ((obj.amount_paid ?? 0) <= 0) {
          console.log(`[webhook] invoice.paid ${stripeInvoiceId}: $0 invoice (subscription trial opener) — ignored`);
          break;
        }
        // Check if this is a deposit instalment payment
        if (metadata.is_deposit === "true" && metadata.proposal_id) {
          // Mark the single instalment this invoice belongs to as paid.
          await db()
            .update(proposalInstalments)
            .set({ status: "paid", paidAt: new Date() })
            .where(eq(proposalInstalments.stripeInvoiceId, stripeInvoiceId));

          // Reconcile against Stripe. Only if the FULL deposit is genuinely collected
          // does this create the subscription; otherwise it records the real partial
          // total and issues the next deposit invoice (deposits are sequential).
          const proposalId = metadata.proposal_id;
          const result = await settleDeposits(proposalId);
          if (result.justCompleted) {
            sendReceiptForProposal(proposalId).catch((e) =>
              console.error("[webhook] Receipt email failed:", e)
            );
            createOnboardingTasks(proposalId).catch(() => {});
            buildProposalPayload(proposalId, { stripeInvoiceId }).then((payload) =>
              dispatchWorkflowEvent("proposal.paid", payload)
            ).catch(() => {});
          }

        // Check if this matches a regular instalment
        } else if (metadata.instalment_number && metadata.proposal_id) {
          await db()
            .update(proposalInstalments)
            .set({ status: "paid", paidAt: new Date() })
            .where(eq(proposalInstalments.stripeInvoiceId, stripeInvoiceId));

          // REGISTER THE CARD FOR THE REST OF THE PLAN, at the moment they first pay.
          // Paying an invoice leaves Stripe holding a card but no agreement to charge it again
          // unattended, which is why instalment plans have needed the client to act and
          // retainers never have. Silent for most clients; awaits contact for the rest.
          // Never throws and never blocks the payment being recorded.
          const authorised = await authoriseFutureCharges(metadata.proposal_id, stripeInvoiceId);
          if (authorised === "needs-the-client") {
            postToSalesChannel(
              `:information_source: A client's bank wants them to approve future automatic ` +
                `payments (proposal ${metadata.proposal_id}). Their instalments will still be ` +
                `charged on the due date; Stripe will ask them to approve the first one.`,
            ).catch(() => {});
          }

          // Check if all instalments are paid → update parent proposal status
          const proposalId = metadata.proposal_id;
          const allInstalments = await db()
            .select()
            .from(proposalInstalments)
            .where(eq(proposalInstalments.proposalId, proposalId));
          // "superseded_by_subscription" is settled too, or these plans sit at partial forever.
          const allPaid = allInstalments.every(
            (i) => i.status === "paid" || i.status === "superseded_by_subscription",
          );
          if (allPaid) {
            await db()
              .update(proposals)
              .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
              .where(eq(proposals.id, proposalId));
            // ONBOARD ONCE. These nine plans were signed and onboarded in July and August;
            // finishing collection now must not hand the rep a second set of "create the Slack
            // channel" tasks for a client who has been live for two months.
            createOnboardingTasksOnce(proposalId).catch(() => {});
            buildProposalPayload(proposalId, { stripeInvoiceId }).then((payload) =>
              dispatchWorkflowEvent("proposal.paid", payload)
            ).catch(() => {});
          } else {
            // Issue the NEXT instalment's invoice. Without this the plan stopped dead after
            // instalment 1 and the rest of the contract was never billed (the 2026-08-05
            // finding: five signed deals, ~$21.8k, with nothing in Stripe to collect it).
            // Sequential by design: issueNextInstalmentInvoice refuses if anything is still
            // open, if a subscription owns the money, or if the row already has an invoice.
            //
            // RE-ENABLED 2026-09-24, on Jack's instruction, after six weeks switched off.
            // It was disabled for the silent 13 August billing-dates release (which could not
            // email anyone mid-change) and nobody came back to it. In that time 9 paying
            // clients accumulated $20,975 that was never billed at all.
            //
            // It now COLLECTS rather than asks: where the client has a payment method on file,
            // Stripe charges it on the due date. Where they do not, it falls back to emailing
            // an invoice. Proven in scripts/stripe-test/prove-auto-collect.mjs (14/14 against a
            // Stripe Test Clock), including that it stops at the final instalment, never debits
            // early, never double-charges, and that a declined payment blocks the next
            // instalment instead of being skipped past.
            // AWAITED, unlike before. This is a Stripe write followed by a DB write; on Vercel
            // the instance can be reclaimed the moment the response is returned, and a kill
            // between the two leaves a charged card attached to a row that still looks
            // unbilled, which a later run would bill AGAIN. The deposit path beside this one
            // has always awaited (see settleDeposits above); this now matches it.
            try {
              await issueNextInstalmentInvoice(proposalId);
            } catch (e) {
              console.error("[webhook] next instalment invoice failed:", e);
              // Silence is what let $20,975 go uncollected for six weeks. Never again.
              postToSalesChannel(
                `:rotating_light: Could not raise the next instalment invoice for proposal ` +
                  `${proposalId}. The client has paid, and the REST OF THEIR PLAN IS NOT BILLED. ` +
                  `Error: ${e instanceof Error ? e.message : String(e)}`,
              ).catch(() => {});
            }
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

          // ── The invoice's subscription id ────────────────────────────────────────────────
          // CORRECTION (2026-08-13): an earlier version of this comment claimed the legacy
          // `Invoice.subscription` field was dead under the pinned API version and that step 2
          // therefore never ran. THAT WAS WRONG. Every stored invoice payload in `stripe_events`
          // carries BOTH `parent.subscription_details.subscription` and the legacy
          // `.subscription`, because the pinned apiVersion in lib/stripe/client.ts governs
          // OUTBOUND calls, not the version Stripe stamps on webhook deliveries (that comes from
          // the endpoint's own version). Step 2 has been live in production all along.
          //
          // Reading `parent.subscription_details.subscription` first is still right — it is the
          // documented location and matches lib/stripe/sync.ts:115 — but this is a tidy-up, NOT
          // a bug fix. KEEP THE LEGACY FALLBACK: it is load-bearing if the endpoint version is
          // ever older than basil.
          const invoiceSubscriptionId: string | null = (() => {
            const parentSub = obj.parent?.subscription_details?.subscription;
            if (parentSub) return typeof parentSub === "string" ? parentSub : parentSub.id;
            const legacy = (obj as Stripe.Invoice & { subscription?: string | { id: string } }).subscription;
            if (legacy) return typeof legacy === "string" ? legacy : legacy.id;
            return null;
          })();

          // ── GUARD: a 90-day "spread" term is collected over THREE invoices ───────────────
          // Marking the proposal paid on a mid-term invoice would end the deal in the data
          // model while the client is still being billed, email them a receipt mid-term, and
          // fire proposal.paid (commission, onboarding, Slack) early. This is the same class of
          // failure as 2026-08-05, when part-paid proposals flipped to "paid", four clients were
          // emailed a receipt and false "Paid" alerts were posted.
          //
          // Skipping requires TWO independent signals to agree, so no single assumption can cause
          // either a missed first payment or a mid-term send:
          //   1. `firstMonthComplete` — set by fulfillNinetyDayCheckout when payment 1 cleared,
          //      i.e. 30+ days before payments 2 and 3, so it is unambiguous for them.
          //   2. `billing_reason` is NOT "subscription_create" — the first invoice of a
          //      subscription. Anything else (cycle, update, …) is by definition not the first.
          //
          // Payment 1 therefore behaves EXACTLY as it does today: signal 1 is false, and even if
          // the checkout and invoice webhooks race and it were true, signal 2 still identifies it
          // as the opening invoice. Payments 2 and 3 need both to be wrong to slip through.
          //
          // ⚠️ OPEN GAP, do not read this as solved: NOTHING currently marks a spread term
          // complete. `maybeCompleteProposal()` is module-private and reachable only via
          // onSplitPaid() over `ninety_day_splits`, and the spread_sub path deliberately creates
          // no ledger rows (the subscription replaces them), so that table is empty account-wide.
          // Before this guard existed the mid-term invoice flipped the proposal to "paid" — the
          // wrong value, but it did at least terminate. Now a fully-collected term sits at
          // "partial" indefinitely. `lib/proposals/status.ts` derives "completed" correctly but
          // is NOT WIRED IN. See tasks/proposal-status-model-plan.md.
          if (invoiceSubscriptionId && obj.billing_reason !== "subscription_create") {
            const [spreadRow] = await db()
              .select({ id: proposals.id, contactName: proposals.contactName })
              .from(proposals)
              .where(and(
                eq(proposals.stripeSubscriptionId, invoiceSubscriptionId),
                eq(proposals.managementOption, "spread"),
                eq(proposals.firstMonthComplete, true),
              ))
              .limit(1);
            if (spreadRow) {
              console.log(
                `[webhook] invoice.paid ${stripeInvoiceId}: mid-term 90-day spread invoice for ` +
                  `${spreadRow.contactName} (proposal ${spreadRow.id}) — not marking paid, no receipt, ` +
                  `no workflow event. Term completion is handled by maybeCompleteProposal().`,
              );
              break;
            }
          }

          const byInvoice = await db()
            .update(proposals)
            .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
            .where(and(eq(proposals.stripeInvoiceId, stripeInvoiceId), notInArray(proposals.status, PAID_TERMINAL_STATUSES)))
            .returning({ id: proposals.id });
          let matchedId: string | null = byInvoice[0]?.id ?? null;

          // 2) the invoice's subscription carries the proposal_id
          if (!matchedId && invoiceSubscriptionId) {
            try {
              const subId = invoiceSubscriptionId;
              const sub = await stripe().subscriptions.retrieve(subId);
              const pid = sub.metadata?.proposal_id;
              if (pid) {
                // Point the proposal at the customer that actually holds this subscription
                // (a Payment Link creates its own customer, distinct from the pre-sign one).
                const subCustomer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
                const r = await db()
                  .update(proposals)
                  .set({ status: "paid", paidAt: new Date(), stripeSubscriptionId: subId, stripeInvoiceId, ...(subCustomer ? { stripeCustomerId: subCustomer } : {}), updatedAt: new Date() })
                  .where(and(eq(proposals.id, pid), notInArray(proposals.status, PAID_TERMINAL_STATUSES)))
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
              .where(and(eq(proposals.stripeCustomerId, custId), notInArray(proposals.status, PAID_TERMINAL_STATUSES)));
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
        // 90-Day Management (upfront/spread) has its own fulfillment: apply auto-rebill + mark paid
        // (upfront), or save the card + schedule months 2 & 3 (spread). Handled here so it never hits
        // the legacy prepaid-cancel logic below. Non-90-day sessions fall through unchanged.
        if (sessionMeta.ninety_day) {
          try {
            const { handled, kind } = await fulfillNinetyDayCheckout(stripe(), session);
            if (handled) {
              const pid = sessionMeta.proposal_id;
              if (pid) {
                // Both are active clients now → onboarding. Only UPFRONT is paid-in-full, so only it
                // gets the "paid" receipt + workflow event; spread stays partial until the term completes.
                createOnboardingTasks(pid).catch(() => {});
                if (kind === "upfront") {
                  sendReceiptForProposal(pid).catch((e) => console.error("[webhook] Receipt email failed:", e));
                  buildProposalPayload(pid).then((payload) => dispatchWorkflowEvent("proposal.paid", payload)).catch(() => {});
                }
              }
              break;
            }
          } catch (e) {
            console.error("[webhook] 90-day fulfillment failed:", e);
            // Falling through is unsafe for 90-day (the legacy path would mis-handle it); stop here.
            break;
          }
        }
        if (sessionMeta.proposal_id) {
          const subId = typeof session.subscription === "string" ? session.subscription : null;
          // A durable Payment Link creates its OWN customer from the email the client enters,
          // so point the proposal at the customer that actually holds the live subscription.
          const payingCustomer = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
          const [updated] = await db()
            .update(proposals)
            .set({
              status: "paid",
              paidAt: new Date(),
              stripeSubscriptionId: subId,
              ...(payingCustomer ? { stripeCustomerId: payingCustomer } : {}),
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
          // A declined payment must NOT flip a signed/paid proposal to "failed" — they signed and
          // can retry the still-open invoice. Keep the status; the Slack alert below notifies us.
          await db()
            .update(proposals)
            .set({ status: "failed", updatedAt: new Date() })
            // "active" and "completed" join the protected list: a live 90-day retainer with ONE
            // declined card must not have the whole proposal flipped to "failed". Same reasoning
            // as signed/paid above. No-op today; no proposal holds either value yet.
            .where(and(
              eq(proposals.stripeInvoiceId, stripeInvoiceId),
              notInArray(proposals.status, ["paid", "signed", "active", "completed"]),
            ));
        }
        // Shout it: a client tried to pay and couldn't. Name, invoice, amount.
        const who = obj.customer_name || obj.customer_email || "A client";
        const amt = ((obj.amount_due ?? 0) / 100).toLocaleString("en-US", { style: "currency", currency: (obj.currency ?? "usd").toUpperCase() });
        postToSalesChannel(
          `:warning: *${who}* tried to pay invoice ${obj.number ?? stripeInvoiceId} (${amt}) but the payment failed (card declined or did not go through). Follow up.`,
        ).catch(() => {});
        break;
      }

      // A DRAFT IS DELETED, NOT VOIDED. This design leaves invoices as drafts for up to 30
      // days, so deleting one is now the most natural way a person cancels a future payment.
      // Without this case the row keeps an id pointing at an invoice that no longer exists:
      // blocked forever, and invisible to the sweep, which only looks for a NULL id.
      case "invoice.deleted":
      case "invoice.voided":
      case "invoice.marked_uncollectible": {
        // AN INSTALMENT INVOICE THAT DIES MUST RELEASE THE ROW.
        //
        // The engine allows one outstanding instalment at a time, and treats "has an invoice id
        // and is not paid" as outstanding. Nothing used to clear that when Stripe voided or
        // wrote off the invoice, so the client would be blocked from ever being billed again,
        // silently and permanently. Production has already received 20 voided and 27
        // payment-failed events, so this is a live path, not a hypothetical one.
        //
        // The id is cleared so the next run can re-issue, and a human is told, because a
        // written-off invoice is a decision someone needs to make, not a retry.
        if (metadata.instalment_number && metadata.proposal_id && !metadata.deposit) {
          // CANCELLED, NOT REOPENED.
          //
          // The obvious move is to clear the invoice id so the client is not blocked. That
          // creates a loop with teeth: the daily sweep looks for exactly "unpaid with no
          // invoice", so the next morning it raises a fresh invoice and, for a client with a
          // card, debits them three days later — a charge a human had deliberately voided.
          //
          // So a killed invoice makes the instalment terminal, and a person decides what
          // happens next. The invoice id is kept as the audit trail of why.
          const [row] = await db()
            .update(proposalInstalments)
            .set({ status: "cancelled" })
            .where(eq(proposalInstalments.stripeInvoiceId, stripeInvoiceId))
            .returning({ id: proposalInstalments.id, n: proposalInstalments.instalmentNumber, amount: proposalInstalments.amount });
          if (row) {
            const [p] = await db().select({ name: proposals.contactName }).from(proposals)
              .where(eq(proposals.id, metadata.proposal_id)).limit(1);
            postToSalesChannel(
              `:warning: *${p?.name ?? metadata.proposal_id}* instalment ${row.n} ($${row.amount}) was ` +
                `${event.type === "invoice.deleted" ? "deleted" : event.type === "invoice.voided" ? "voided" : "written off as uncollectible"} in Stripe, ` +
                `so it is now marked cancelled and will NOT be re-billed automatically. ` +
                `If that money is still owed, re-open the instalment on the proposal.`,
            ).catch(() => {});
          }
          break;
        }
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
          // 90-Day Management proposals ALSO get cancel_at_period_end set by design (the
          // bill-then-stop default), and they carry autoRenew=true, so they must be excluded
          // here too — else paying upfront would wrongly read as churn the same day.
          await db()
            .update(proposals)
            .set({ cancelledAt: new Date(), updatedAt: new Date() })
            .where(and(eq(proposals.stripeSubscriptionId, sub.id), ne(proposals.autoRenew, false), isNull(proposals.managementOption)));
        }
        break;
      }

      case "customer.subscription.deleted": {
        // TERM COMPLETION for a 90-day "spread" retainer.
        //
        // Nothing else does this. `maybeCompleteProposal()` is reachable only through the
        // `ninety_day_splits` ledger, and the spread_sub path deliberately writes no ledger rows
        // (the subscription replaces them), so that table is empty account-wide. Before the
        // mid-term guard in invoice.paid existed, a mid-term invoice flipped the proposal to
        // "paid" — the wrong value at the wrong time, but it did at least terminate. The guard
        // correctly stops that, which left a fully-collected term sitting at "partial" forever.
        //
        // A spread subscription self-cancels at cancel_at (day 90), so its deletion IS the
        // "term is over" signal. Authoritative and needs no invoice-counting guesswork beyond
        // confirming the money actually arrived.
        const sub = event.data.object as Stripe.Subscription;
        const [spread] = await db()
          .select({
            id: proposals.id, contactName: proposals.contactName, status: proposals.status,
            paidAt: proposals.paidAt, autoRebillMode: proposals.autoRebillMode,
          })
          .from(proposals)
          .where(and(
            eq(proposals.stripeSubscriptionId, sub.id),
            eq(proposals.managementOption, "spread"),
          ))
          .limit(1);
        if (!spread) break;
        // Never overwrite a decision a human made. The cron backstop already refuses these; the
        // two paths must agree or they produce different answers for the same subscription.
        if (["completed", "lost", "void"].includes(spread.status)) break;

        // Only "completed" if the term was genuinely COLLECTED. A subscription can also be
        // deleted because the client churned or payment failed out, and calling that completed
        // would turn a loss into a win in every revenue figure. Counted from the mirror, which
        // syncStripeEventToMirror() has already updated for this event further up this handler.
        // `gt(amountPaid, 0)` is load-bearing. Stripe issues a $0 opening invoice on a
        // subscription created with `trial_end` (the split-first-payment path does exactly
        // that), and production already holds 7 such rows with status 'paid'. Counting them as
        // payments would let a client who paid 2 of 3 ($3,000 of $4,500) and then churned be
        // recorded as a completed term. The invoice.paid handler guards against $0 the same way.
        const paidInvoices = await db()
          .select({ id: localStripeInvoices.id, paidAt: localStripeInvoices.paidAt })
          .from(localStripeInvoices)
          .where(and(
            eq(localStripeInvoices.subscriptionId, sub.id),
            eq(localStripeInvoices.status, "paid"),
            gt(localStripeInvoices.amountPaid, 0),
          ));
        const collected = paidInvoices.length;

        // A sub on "monthly" or "full90" has NO cancel_at — stopAfterTerm leaves it running
        // indefinitely — so the only thing that ever deletes it is the client churning. Calling
        // that "completed" would turn a loss into a win in every revenue figure. Only a
        // bill-then-stop term ("none") is designed to end by itself.
        const endsByDesign = (spread.autoRebillMode ?? "none") === "none";
        if (collected >= MONTHS_IN_TERM && endsByDesign) {
          await db()
            .update(proposals)
            .set({
              status: "completed",
              // paidAt was stamped when the first month cleared and MUST be preserved: commission,
              // unit economics and the outstanding-value KPI are all keyed on it, not on status.
              // If paidAt was somehow missed at first payment, backfill it from the EARLIEST
              // real payment, not from now — commission, LTV and every revenue window key on
              // this date, so stamping it at term end backdates the deal by ~90 days.
              ...(spread.paidAt
                ? {}
                : {
                    paidAt: paidInvoices
                      .map((i) => i.paidAt)
                      .filter((d): d is Date => !!d)
                      .sort((a, b) => a.getTime() - b.getTime())[0] ?? new Date(),
                  }),
              updatedAt: new Date(),
            })
            .where(eq(proposals.id, spread.id));
          // Deliberately NO dispatchWorkflowEvent here. proposal.paid already fired when the
          // first month cleared, and re-firing would re-run workflows and re-post Slack. The term
          // ending is not a second sale.
          console.log(
            `[webhook] 90-day spread term COMPLETE for ${spread.contactName} (proposal ${spread.id}): ` +
              `${collected} payments collected, subscription ${sub.id} ended.`,
          );
        } else {
          console.warn(
            `[webhook] Subscription ${sub.id} for ${spread.contactName} (proposal ${spread.id}) ended with ` +
              `only ${collected}/${MONTHS_IN_TERM} payments collected — NOT marking complete. ` +
              `Left at "${spread.status}" for a human to review.`,
          );
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
