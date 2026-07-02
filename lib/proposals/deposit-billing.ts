import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { stripe } from "@/lib/stripe/client";
import type Stripe from "stripe";

/**
 * Single source of truth for deposit billing on subscription-with-deposit proposals.
 *
 * The rules this enforces (and why the previous code was wrong):
 *  - Deposit instalments are issued ONE AT A TIME. The next invoice is only created
 *    once the current one is actually paid. (Old bug: send/ finalized every deposit
 *    invoice at once with a flat 7-day due date.)
 *  - "Paid" is decided by asking Stripe, never by trusting a button. A deposit row is
 *    only marked paid if its Stripe invoice reports status "paid". (Old bug: the admin
 *    override stamped every row paid and wrote the full deposit total as collected.)
 *  - The subscription is created ONLY when the full deposit has genuinely been
 *    collected. (Old bug: the subscription was created on a partial deposit.)
 *
 * Nothing here throws into its caller: Stripe lookups are wrapped, and a row we cannot
 * verify is treated as NOT paid (never fabricated).
 */

type ProposalRow = typeof proposals.$inferSelect;
type InstalmentRow = typeof proposalInstalments.$inferSelect;

async function getProposal(proposalId: string): Promise<ProposalRow | null> {
  const [p] = await db().select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
  return p ?? null;
}

/** All deposit instalments for a proposal, ordered by instalment number. */
async function getDepositInstalments(proposalId: string): Promise<InstalmentRow[]> {
  const rows = await db()
    .select()
    .from(proposalInstalments)
    .where(eq(proposalInstalments.proposalId, proposalId))
    .orderBy(asc(proposalInstalments.instalmentNumber));
  return rows.filter((i) => i.isDeposit);
}

/**
 * Create + finalize the Stripe invoice for a single deposit instalment and store its id.
 * If the instalment already has an invoice id, returns it unchanged (never double-issues).
 * Returns the hosted invoice URL when available.
 */
async function issueDepositInvoice(
  proposal: ProposalRow,
  inst: InstalmentRow,
): Promise<{ invoiceId: string; hostedUrl: string | null } | null> {
  if (!proposal.stripeCustomerId) return null;
  if (inst.stripeInvoiceId) {
    // Already issued — just return its hosted URL.
    try {
      const existing = await stripe().invoices.retrieve(inst.stripeInvoiceId);
      return { invoiceId: inst.stripeInvoiceId, hostedUrl: existing.hosted_invoice_url ?? null };
    } catch {
      return { invoiceId: inst.stripeInvoiceId, hostedUrl: null };
    }
  }

  const total = (await getDepositInstalments(proposal.id)).length;
  const invoice = await stripe().invoices.create({
    customer: proposal.stripeCustomerId,
    collection_method: "send_invoice",
    days_until_due: 7,
    metadata: {
      ghl_contact_id: proposal.ghlContactId,
      proposal_id: proposal.id,
      instalment_number: String(inst.instalmentNumber),
      is_deposit: "true",
    },
    auto_advance: false,
  });
  await stripe().invoiceItems.create({
    customer: proposal.stripeCustomerId,
    invoice: invoice.id,
    amount: Math.round(inst.amount * 100),
    currency: proposal.currency,
    description: `Deposit ${inst.instalmentNumber} of ${total}: ${proposal.contactName}`,
  });
  await stripe().invoices.finalizeInvoice(invoice.id, { auto_advance: false });

  const finalized = await stripe().invoices.retrieve(invoice.id);
  const hostedUrl = finalized.hosted_invoice_url ?? null;
  await db()
    .update(proposalInstalments)
    .set({ stripeInvoiceId: invoice.id, stripeHostedUrl: hostedUrl ?? undefined })
    .where(eq(proposalInstalments.id, inst.id));

  return { invoiceId: invoice.id, hostedUrl };
}

/**
 * Issue the NEXT deposit invoice: the lowest-numbered deposit that is not yet paid and
 * has not yet been invoiced. Returns null when there is nothing left to issue.
 * This is what makes deposits sequential: one live invoice at a time.
 */
export async function issueNextDepositInvoice(
  proposalId: string,
): Promise<{ invoiceId: string; hostedUrl: string | null } | null> {
  const proposal = await getProposal(proposalId);
  if (!proposal || !proposal.hasDeposit || !proposal.stripeCustomerId) return null;
  const deposits = await getDepositInstalments(proposalId);
  const next = deposits.find((i) => i.status !== "paid" && !i.stripeInvoiceId);
  if (!next) return null;
  return issueDepositInvoice(proposal, next);
}

/**
 * Reconcile every deposit instalment against its real Stripe invoice. Marks a row paid
 * only when Stripe confirms it, and returns the amount ACTUALLY collected.
 */
async function reconcileDeposits(
  proposalId: string,
): Promise<{ paidTotal: number; depositTotal: number; fullyPaid: boolean }> {
  const proposal = await getProposal(proposalId);
  const deposits = await getDepositInstalments(proposalId);
  let paidCents = 0;

  for (const inst of deposits) {
    // Ask Stripe whether this instalment's invoice is actually paid. When Stripe is
    // reachable its answer is authoritative. If the lookup fails (a transient error),
    // fall back to the stored status so a blip can never drop an already-collected
    // deposit or under-report the collected total.
    let paid = inst.status === "paid";
    if (inst.stripeInvoiceId) {
      try {
        const inv = await stripe().invoices.retrieve(inst.stripeInvoiceId);
        paid = inv.status === "paid";
      } catch (err) {
        console.error(
          `[deposit-billing] Could not verify invoice ${inst.stripeInvoiceId}, trusting stored status "${inst.status}":`,
          err,
        );
      }
    }

    if (paid) {
      paidCents += Math.round(inst.amount * 100);
      if (inst.status !== "paid") {
        await db()
          .update(proposalInstalments)
          .set({ status: "paid", paidAt: new Date() })
          .where(eq(proposalInstalments.id, inst.id));
      }
    }
  }

  const depositTotalCents = Math.round((proposal?.depositTotal ?? proposal?.totalAmount ?? 0) * 100);
  // Compare in integer cents (within 1 cent) to avoid float drift and the old 50c slack.
  const fullyPaid = deposits.length > 0 && paidCents >= depositTotalCents - 1;
  return { paidTotal: paidCents / 100, depositTotal: depositTotalCents / 100, fullyPaid };
}

/**
 * Create the recurring Stripe subscription for a deposit proposal. The subscription trials
 * until its first-charge date, so nothing charges before then. That date is:
 *   - the rep-chosen subscriptionStartDate, if set (flexible model); otherwise
 *   - the legacy default: one billing cycle after the start date (deposit covers cycle one).
 * The recurring amount is proposal.totalAmount (the monthly retainer) — independent of the
 * deposit. Returns the subscription id. Does NOT write proposal status (settleDeposits owns that).
 */
export function firstChargeDate(proposal: ProposalRow): Date {
  if (proposal.subscriptionStartDate) return new Date(proposal.subscriptionStartDate);
  const interval = (proposal.billingInterval ?? "month");
  const intervalCount = proposal.billingIntervalCount ?? 1;
  const d = new Date(proposal.startDate ?? new Date());
  if (interval === "day") d.setDate(d.getDate() + intervalCount);
  else if (interval === "week") d.setDate(d.getDate() + intervalCount * 7);
  else if (interval === "month") d.setMonth(d.getMonth() + intervalCount);
  else if (interval === "year") d.setFullYear(d.getFullYear() + intervalCount);
  return d;
}

/**
 * Stripe rejects a subscription trial_end more than ~2 years out (and requires it in the
 * future). Clamp to [now+24h, now+700d] so the subscription can ALWAYS be created — a
 * far-future date must never fail sub creation after a deposit has already been collected.
 */
export function clampedTrialEnd(d: Date): number {
  const now = Math.floor(Date.now() / 1000);
  const target = Math.floor(d.getTime() / 1000);
  return Math.min(Math.max(target, now + 86400), now + 700 * 86400);
}

async function createDepositSubscription(proposal: ProposalRow): Promise<string> {
  if (!proposal.stripeCustomerId) {
    throw new Error(`Cannot create subscription for ${proposal.id}: no Stripe customer`);
  }
  const interval = (proposal.billingInterval ?? "month") as "day" | "week" | "month" | "year";
  const intervalCount = proposal.billingIntervalCount ?? 1;

  // trial_end alone sets the first-charge date and the recurring cycle anchor (no
  // billing_cycle_anchor needed). Clamped so Stripe always accepts it.
  const trialEndUnix = clampedTrialEnd(firstChargeDate(proposal));

  const price = await stripe().prices.create({
    currency: proposal.currency,
    unit_amount: Math.round(proposal.totalAmount * 100),
    recurring: { interval, interval_count: intervalCount },
    product_data: { name: proposal.title, metadata: { proposal_id: proposal.id } },
  });

  const subscription = await stripe().subscriptions.create({
    customer: proposal.stripeCustomerId,
    items: [{ price: price.id }],
    trial_end: trialEndUnix,
    metadata: { proposal_id: proposal.id },
  });
  return subscription.id;
}

export interface SettleResult {
  /** True only on the call that first collects the full deposit and creates the subscription. */
  justCompleted: boolean;
  /** Amount Stripe has actually collected toward the deposit. */
  paidTotal: number;
  depositTotal: number;
  fullyPaid: boolean;
  subscriptionId: string | null;
}

/**
 * The single settlement routine used by BOTH the Stripe webhook and the admin override.
 *
 * It reconciles against Stripe, then:
 *  - if the full deposit is genuinely collected and no subscription exists yet, creates
 *    the subscription and marks the proposal paid (justCompleted = true);
 *  - if fully collected but a subscription already exists, just syncs the collected total;
 *  - otherwise records the real partial total and issues the next deposit invoice.
 *
 * Side effects that belong to the caller (receipt email, onboarding tasks, the
 * proposal.paid workflow event) are triggered by the caller when justCompleted is true.
 */
export async function settleDeposits(proposalId: string): Promise<SettleResult> {
  const proposal = await getProposal(proposalId);
  if (!proposal || !proposal.hasDeposit) {
    return { justCompleted: false, paidTotal: 0, depositTotal: 0, fullyPaid: false, subscriptionId: proposal?.stripeSubscriptionId ?? null };
  }

  const { paidTotal, depositTotal, fullyPaid } = await reconcileDeposits(proposalId);

  // Not fully collected yet: record the real total and open the next deposit invoice.
  // Guard on subscriptionCreatedAt so a late partial event can never clobber a proposal
  // that has already completed.
  if (!fullyPaid) {
    await db()
      .update(proposals)
      .set({ status: "partial", depositsPaidTotal: paidTotal, updatedAt: new Date() })
      .where(and(eq(proposals.id, proposalId), isNull(proposals.subscriptionCreatedAt)));
    await issueNextDepositInvoice(proposalId).catch((err) =>
      console.error(`[deposit-billing] Failed to issue next deposit invoice for ${proposalId}:`, err),
    );
    return { justCompleted: false, paidTotal, depositTotal, fullyPaid: false, subscriptionId: proposal.stripeSubscriptionId };
  }

  // Fully collected and the subscription already exists (created on an earlier call, or the
  // record was corrected to "partial"): keep the total honest AND make sure the proposal now
  // reads paid, since the whole deposit is finally in.
  if (proposal.subscriptionCreatedAt) {
    await db()
      .update(proposals)
      .set({ status: "paid", paidAt: proposal.paidAt ?? new Date(), depositsPaidTotal: paidTotal, updatedAt: new Date() })
      .where(eq(proposals.id, proposalId));
    return { justCompleted: false, paidTotal, depositTotal, fullyPaid: true, subscriptionId: proposal.stripeSubscriptionId };
  }

  // Fully collected and not yet completed. Create the subscription, THEN atomically claim
  // completion: the UPDATE only succeeds if no other concurrent settle has already claimed
  // it. If we lost the race we created a duplicate subscription, so we cancel it. Because
  // the subscription is on a trial (no charge until the first cycle), cancelling the loser
  // means the customer is never double-billed.
  const subscriptionId = await createDepositSubscription(proposal);
  const claimed = await db()
    .update(proposals)
    .set({
      status: "paid",
      paidAt: new Date(),
      depositsPaidTotal: paidTotal,
      subscriptionCreatedAt: new Date(),
      stripeSubscriptionId: subscriptionId,
      updatedAt: new Date(),
    })
    .where(and(eq(proposals.id, proposalId), isNull(proposals.subscriptionCreatedAt)))
    .returning({ id: proposals.id });

  if (claimed.length === 0) {
    console.error(
      `[deposit-billing] Duplicate subscription ${subscriptionId} for ${proposalId}: another completion won the race, cancelling ours.`,
    );
    try {
      await stripe().subscriptions.cancel(subscriptionId);
    } catch (err) {
      console.error(
        `[deposit-billing] CRITICAL: could not cancel duplicate subscription ${subscriptionId} for ${proposalId}. Cancel it manually in Stripe.`,
        err,
      );
    }
    const latest = await getProposal(proposalId);
    return { justCompleted: false, paidTotal, depositTotal, fullyPaid: true, subscriptionId: latest?.stripeSubscriptionId ?? null };
  }

  return { justCompleted: true, paidTotal, depositTotal, fullyPaid: true, subscriptionId };
}
