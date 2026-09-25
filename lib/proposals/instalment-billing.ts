/**
 * Sequential invoicing for PROJECT instalment plans.
 *
 * The gap this closes: the sign route created instalment #1's invoice and nothing ever
 * created #2 or #3. Five signed deals sat with two thirds of their money uncollected and
 * nothing in Stripe to collect it (found 2026-08-05, ~$21.8k). Deposits already worked
 * this way via deposit-billing.ts; regular instalments were simply never finished.
 *
 * Model, deliberately identical to deposits: ONE live invoice at a time. When an instalment
 * is paid, the next one is issued, dated to its own agreed due date (NOT signing + 30 days,
 * which is what the sign route hardcodes for #1). Nothing is issued ahead of time, so a
 * client never has two open invoices and we can never bill a schedule that later changes.
 *
 * IT COLLECTS, IT DOES NOT ASK. Jack, 2026-09-24: "It's an instalment. It should automatically
 * collect if it's not a subscription. And then stop on the last instalment." So when the client
 * has a payment method saved, Stripe charges it on the due date and nobody has to chase. When
 * they do not, we fall back to emailing them an invoice, because refusing to bill at all is how
 * $20,975 went uncollected in the first place. Measured 2026-09-24: 8 of the 9 affected clients
 * already have a default payment method on file.
 *
 * Everything here is idempotent and refuses rather than guesses:
 *   - an instalment that already has an invoice id is never re-issued
 *   - a proposal on a subscription is skipped (the subscription owns that money)
 *   - a $0 or already-paid row is skipped
 *   - ANY unpaid instalment blocks the next one, so a failed payment can never be skipped past
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe/client";
import { postToSalesChannel } from "@/lib/proposals/slack-notify";

/** How many days before its due date the client receives the invoice. Long enough to be
 *  useful notice, short enough that it doesn't get buried before the money is due. */
export const SEND_LEAD_DAYS = 3;

/**
 * Statuses that mean "this instalment will never be billed again".
 *
 * A WHITELIST, because the fallback direction matters. Production holds 10 rows at
 * `superseded_by_subscription` worth $12,400 (deals moved onto a subscription by
 * scripts/fix-90day-billing.mjs) and NONE of them carries an invoice id. Under the old
 * "settled means paid" test the engine would have seen them as unbilled and raised an invoice
 * for money a subscription is already collecting. They are saved today only by the separate
 * subscription check, which is one line and one script's consistency away from failing.
 *
 * "cancelled" is the terminal state for an instalment somebody deliberately killed: Stripe
 * voided or wrote off its invoice, or a human cancelled it here. Without a terminal state, the
 * void handler had to reset the row to "pending", and the daily sweep then cheerfully raised a
 * NEW invoice three days later, debiting a card a human had just voided. A cancellation has to
 * be able to stay cancelled.
 *
 * Anything NOT in this list and not recognised below stops the engine rather than being billed.
 * An unknown status must never mean "take their money".
 */
const SETTLED = new Set(["paid", "superseded_by_subscription", "cancelled"]);
/** Statuses the engine understands as genuinely still owed. */
const OWED = new Set(["pending", "failed"]);

export async function issueNextInstalmentInvoice(
  proposalId: string,
): Promise<{
  invoiceId: string;
  hostedUrl: string | null;
  instalmentNumber: number;
  sendsOn: Date;
  /** True when the money is taken from the card on file rather than emailed as a request. */
  autoCharge: boolean;
} | null> {
  const [proposal] = await db().select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
  if (!proposal) return null;
  if (!proposal.stripeCustomerId) return null;
  // A subscription bills its own cycles. Issuing invoices alongside it would double-charge.
  if (proposal.stripeSubscriptionId) return null;
  if (proposal.paymentStructure !== "instalment") return null;
  // Never bill a deal that is dead. The engine decides to take money, so it carries this rule
  // itself rather than trusting every caller to have filtered first.
  if (proposal.lostAt || proposal.status === "lost" || proposal.status === "void") return null;

  // THE RULE: projects are invoiced, management is subscribed. A management retainer on the
  // instalment path is a category error, and it is precisely how this went wrong in July:
  // four retainers were sold as Projects because that was the only option offering a payment
  // split, so they never created a subscription and stayed invisible to Management MRR until
  // someone hand-typed them into a manual override table.
  // We still bill it (refusing would lose real money, which is the original bug), but it is
  // never allowed to happen quietly — the deal needs converting to a subscription.
  if (proposal.type === "management") {
    postToSalesChannel(
      `:warning: *${proposal.contactName}* is a MANAGEMENT retainer being billed as project instalments. ` +
        `It will collect, but it will NOT count toward Management MRR or churn until it is moved onto a subscription.`,
    ).catch(() => {});
  }

  const rows = await db()
    .select()
    .from(proposalInstalments)
    .where(and(eq(proposalInstalments.proposalId, proposalId)))
    .orderBy(asc(proposalInstalments.instalmentNumber));

  // Deposits have their own sequential engine; never touch them from here.
  const instalments = rows.filter((r) => !r.isDeposit);
  if (instalments.length === 0) return null;

  // Exactly one outstanding instalment at a time.
  //
  // THIS USED TO CHECK ONLY `status === "pending"`, AND THAT WAS A MONEY BUG. A declined
  // auto-charge sets the row to "failed" (see invoice.payment_failed in the webhook), which is
  // not "pending", so the guard let it through and the NEXT instalment was billed while the
  // unpaid one was quietly left behind. The client would be short one payment and nothing would
  // ever say so. Unpaid is unpaid, whatever word is on it.
  const isSettled = (r: { status: string | null }) => SETTLED.has(r.status ?? "");

  // A status nobody has taught this engine about is a reason to stop, not to bill.
  const unknown = instalments.find((r) => !SETTLED.has(r.status ?? "") && !OWED.has(r.status ?? ""));
  if (unknown) {
    postToSalesChannel(
      `:warning: *${proposal.contactName}* instalment ${unknown.instalmentNumber} has an ` +
        `unrecognised status \`${unknown.status}\`. Billing for this client is PAUSED until ` +
        `someone confirms what it means. No invoice was raised.`,
    ).catch(() => {});
    return null;
  }

  const outstanding = instalments.find((r) => !isSettled(r) && r.stripeInvoiceId);
  if (outstanding) return null;

  const next = instalments.find((r) => !isSettled(r) && !r.stripeInvoiceId);
  // STOPS AT THE LAST ONE. When every instalment is settled there is no `next`, so nothing is
  // created, today or on any later run. The agreed number of payments is the number taken.
  if (!next || !(next.amount > 0)) return null;

  // TIMING MATTERS. Finalising now would email the client their next invoice the instant
  // they paid the last one — a month before it is due. That reads as hounding them for
  // money, and it buries the invoice so it is nowhere to be found when it actually falls
  // due. Instead the invoice is created as a DRAFT and Stripe finalises + emails it
  // SEND_LEAD_DAYS before the due date. Proven in scripts/stripe-test/prove-deferred-invoice.mjs
  // (9/9 with a Test Clock: draft on day 0, still draft the day before, sent on the day).
  // C1 GUARD: does an invoice for THIS instalment already exist in Stripe?
  //
  // The idempotency key below is real protection, but Stripe expires keys after 24 hours and
  // the gap between a create and a retry here can be 30 days. If the process died after the
  // Stripe call and before the row was written, the row looks unbilled forever, and a later run
  // would create a SECOND invoice and charge the card again. So we ask Stripe, which is the
  // only party that actually knows. Cheap: one list call against one customer.
  const existing = await stripe().invoices.list({ customer: proposal.stripeCustomerId, limit: 100 });
  // Only a LIVE invoice for the RIGHT MONEY counts. An empty draft (created, then the line
  // item failed) finalises to a $0 "paid" invoice, and binding the row to that would mark the
  // instalment permanently handled while collecting nothing. An uncollectible invoice is a
  // write-off, not an outstanding one.
  const expectedCents = Math.round(next.amount * 100);
  const alreadyRaised = existing.data.find(
    (i) =>
      i.metadata?.instalment_row === next.id &&
      i.status !== "void" &&
      i.status !== "uncollectible" &&
      i.total === expectedCents,
  );
  if (alreadyRaised) {
    // Heal the row rather than bill again, so the engine can move on next time.
    await db()
      .update(proposalInstalments)
      .set({
        stripeInvoiceId: alreadyRaised.id,
        ...(alreadyRaised.hosted_invoice_url ? { stripeHostedUrl: alreadyRaised.hosted_invoice_url } : {}),
      })
      .where(eq(proposalInstalments.id, next.id));
    // Said out loud, not logged. Reaching here means a previous run created an invoice and
    // then failed to record it, which is worth someone knowing about.
    postToSalesChannel(
      `:information_source: *${proposal.contactName}* instalment ${next.instalmentNumber} already had ` +
        `invoice \`${alreadyRaised.id}\` in Stripe but our record had lost it. Record repaired, ` +
        `no second invoice raised and no second charge.`,
    ).catch(() => {});
    return null;
  }

  // Can we simply take the money? A customer with a default payment method has already given
  // us permission to charge it; asking them to click a link every month is friction we chose,
  // not friction they asked for.
  const customer = await stripe().customers.retrieve(proposal.stripeCustomerId);
  const defaultMethod = !("deleted" in customer && customer.deleted)
    ? (customer.invoice_settings?.default_payment_method ?? customer.default_source ?? null)
    : null;
  const autoCharge = Boolean(defaultMethod);

  // No card AND no email is a dead end: Stripe refuses to create a sendable invoice without an
  // address to send it to, and the throw would be swallowed by the caller's catch. Say so
  // instead, because this client is owed money and nothing else will notice.
  const customerEmail = !("deleted" in customer && customer.deleted) ? customer.email : null;
  if (!autoCharge && !customerEmail) {
    postToSalesChannel(
      `:warning: *${proposal.contactName}* is owed instalment ${next.instalmentNumber} ` +
        `($${next.amount}) but has no card on file AND no email in Stripe, so we can neither ` +
        `charge them nor invoice them. Needs a human.`,
    ).catch(() => {});
    return null;
  }

  const dueMs = new Date(next.dueDate).getTime();
  // THE LEAD TIME IS NOTICE, NOT AN EARLY CHARGE.
  //
  // Sending an invoice 3 days ahead is a courtesy: the client sees it before the money is due.
  // But on the auto-charge path, finalising IS taking the money, so the same 3 days would debit
  // a real customer's card three days before the date they agreed. Proven in
  // scripts/stripe-test/prove-auto-collect.mjs, which caught exactly that: the card was charged
  // on the 4th for a payment due on the 7th. Automatic collection lands ON the due date.
  const leadMs = autoCharge ? 0 : SEND_LEAD_DAYS * 86_400_000;
  const nowAt = Math.floor(Date.now() / 1000);
  // NEVER DEBIT A CARD THE SECOND WE NOTICE. An instalment whose date has already passed would
  // otherwise be finalised immediately, and on the auto-charge path finalising IS the charge.
  // Two clients are weeks overdue, and four have two unbilled instalments each, so the whole
  // remaining balance could leave one card within minutes of switching this on. Money that is
  // genuinely owed still does not justify an unannounced debit, so a late instalment gets the
  // same few days of notice a punctual one gets.
  const earliest = nowAt + SEND_LEAD_DAYS * 86_400;
  const sendAt = Math.max(Math.floor((dueMs - leadMs) / 1000), autoCharge ? earliest : 0);
  // AND THE DUE DATE ITSELF MUST BE IN THE FUTURE.
  //
  // Stripe flatly rejects `due_date` in the past: "expects a unix timestamp representing a date
  // and time in the future" (confirmed against the API, 2026-09-24). Flooring only the send
  // instant left this one behind, so any client with no card whose instalment was already
  // overdue would throw on every single attempt: alerted daily, collected never. That is the
  // original failure dressed up as monitoring.
  const dueAt = Math.max(Math.floor(dueMs / 1000), earliest);
  // If the due date is already here (or inside the lead window), there is nothing to defer:
  // it is due, so send it now. Stripe rejects a finalise-at in the past.
  // With the floor above, an auto-charge is always deferred by at least the notice period.
  const deferrable = sendAt > nowAt + 3600;

  const inv = await stripe().invoices.create(
    {
      customer: proposal.stripeCustomerId,
      // `charge_automatically` takes the money from the saved method on the due date.
      // `send_invoice` emails a payment link and waits, and is the fallback for a client with
      // nothing on file. `due_date` is only valid on the send_invoice path; Stripe rejects it
      // alongside charge_automatically, where the finalisation date IS the collection date.
      collection_method: autoCharge ? "charge_automatically" : "send_invoice",
      ...(autoCharge ? {} : { due_date: dueAt }),
      auto_advance: true, // let Stripe send it and chase it; the old code disabled all of that
      ...(deferrable ? { automatically_finalizes_at: sendAt } : {}),
      metadata: {
        ghl_contact_id: proposal.ghlContactId,
        proposal_id: proposal.id,
        instalment_number: String(next.instalmentNumber),
        // The row this invoice belongs to, so a later run can ask Stripe "did I already do
        // this?" without depending on an idempotency key that has long since expired.
        instalment_row: next.id,
        collection: autoCharge ? "auto" : "invoice",
      },
    },
    { idempotencyKey: `inst_inv_${next.id}` },
  );
  await stripe().invoiceItems.create(
    {
      customer: proposal.stripeCustomerId,
      invoice: inv.id,
      amount: Math.round(next.amount * 100),
      currency: proposal.currency,
      description: `Instalment ${next.instalmentNumber} of ${instalments.length} — ${proposal.contactName}`,
    },
    { idempotencyKey: `inst_item_${next.id}` },
  );

  // Only finalise immediately when the money is genuinely due now. Otherwise leave it as a
  // draft for Stripe to act on at `automatically_finalizes_at`; a draft has no hosted URL yet,
  // which is expected and gets filled in on finalisation.
  //
  // On the auto-charge path, finalising is what TAKES THE MONEY, so this is the moment a real
  // charge happens. It is reached only when the due date has arrived.
  // WRITE THE LINK FIRST. Finalising is what takes the money, so if the process dies between
  // the two, the row must already know which invoice is its own. The old order left a charged
  // card attached to a row that still looked unbilled.
  await db()
    .update(proposalInstalments)
    .set({ stripeInvoiceId: inv.id })
    .where(eq(proposalInstalments.id, next.id));

  let hostedUrl: string | null = null;
  if (!deferrable) {
    try {
      await stripe().invoices.finalizeInvoice(inv.id, { auto_advance: true });
      hostedUrl = (await stripe().invoices.retrieve(inv.id)).hosted_invoice_url ?? null;
      if (hostedUrl) {
        await db().update(proposalInstalments).set({ stripeHostedUrl: hostedUrl })
          .where(eq(proposalInstalments.id, next.id));
      }
    } catch (e) {
      // The row now points at a draft that will never be sent or paid, and "has an invoice id"
      // is what blocks this client from ever being billed again. Release it so the next run can
      // retry, and say so, rather than leaving a silent permanent stop.
      await db().update(proposalInstalments).set({ stripeInvoiceId: null })
        .where(eq(proposalInstalments.id, next.id));
      postToSalesChannel(
        `:rotating_light: *${proposal.contactName}* instalment ${next.instalmentNumber} ` +
          `($${next.amount}) could not be finalised in Stripe, so it was NOT collected. ` +
          `The draft \`${inv.id}\` is left for inspection and we will retry. ` +
          `Error: ${e instanceof Error ? e.message : String(e)}`,
      ).catch(() => {});
      throw e;
    }
  }

  return {
    invoiceId: inv.id,
    hostedUrl,
    instalmentNumber: next.instalmentNumber,
    sendsOn: deferrable ? new Date(sendAt * 1000) : new Date(),
    autoCharge,
  };
}

/**
 * Register the client's card for the rest of their instalment plan.
 *
 * WHY THIS EXISTS
 * Jack, 2026-09-24: "I want you to charge their card because it's in our contract. They're going
 * to get automatically rebilled, so we already have permission." The contract says so, but
 * Stripe was never told, and Stripe is what the bank listens to.
 *
 * An instalment plan's first payment goes out as an emailed invoice, and paying an invoice does
 * NOT create a rebilling mandate: Stripe keeps the card but has no record that the customer
 * agreed to be charged again while they are not there. Our retainer path has always done this
 * properly (see ninety-day-billing.ts, `setup_future_usage: "off_session"`), which is exactly
 * why retainers have never had this problem and instalment plans have.
 *
 * Verified against the SDK on 2026-09-24: an Invoice cannot carry `setup_future_usage` at all.
 * Stripe's own guidance is to use a SetupIntent, which is what this does, the moment the first
 * instalment is paid.
 *
 * WHAT THE CLIENT SEES
 * For a US, Canadian or Link customer: nothing. It is agreed silently and every later instalment
 * is charged without them lifting a finger.
 *
 * For a UK or European card, the bank may insist the cardholder approves it. We do NOT email
 * them out of the blue: the attempt simply does not complete, we record that, and Stripe asks
 * them to approve at the first charge instead. Either way it is asked once, early, rather than
 * standing between us and every future payment.
 *
 * NEVER THROWS, and never blocks anything. Failing to register the card loses an optimisation,
 * not a payment: the charge is still attempted on the due date regardless.
 */
export async function authoriseFutureCharges(proposalId: string, stripeInvoiceId: string): Promise<
  "already-authorised" | "authorised" | "needs-the-client" | "no-card" | "failed"
> {
  try {
    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
    if (!proposal?.stripeCustomerId) return "no-card";
    // Done once per client. Re-confirming on every instalment would pester them for nothing.
    if (proposal.stripePaymentMethodId) return "already-authorised";

    const invoice = await stripe().invoices.retrieve(stripeInvoiceId, { expand: ["payments"] });
    // The invoice's own payment tells us which card actually paid, rather than guessing.
    const pi = (invoice as unknown as { payments?: { data?: Array<{ payment?: { payment_intent?: string } }> } })
      .payments?.data?.[0]?.payment?.payment_intent;
    let paymentMethodId: string | null = null;
    if (pi) {
      const intent = await stripe().paymentIntents.retrieve(pi);
      paymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id ?? null;
    }
    if (!paymentMethodId) {
      const pms = await stripe().paymentMethods.list({ customer: proposal.stripeCustomerId, limit: 1 });
      paymentMethodId = pms.data[0]?.id ?? null;
    }
    if (!paymentMethodId) return "no-card";

    // Make it the card the later invoices will reach for. Without this, an automatic charge has
    // nothing to charge even when a card is sitting on the customer.
    await stripe().customers.update(proposal.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    try {
      const si = await stripe().setupIntents.create(
        {
          customer: proposal.stripeCustomerId,
          payment_method: paymentMethodId,
          usage: "off_session",
          // `usage: off_session` is the agreement itself: this card may be charged when the
          // customer is not present. Confirming it now means we learn whether their bank will
          // allow that today, rather than discovering it on a due date.
          confirm: true,
          // Without this Stripe refuses, because the account has payment methods enabled that
          // would bounce the customer to another site to approve, and there is no customer here
          // to bounce. We are only ever registering a card they have already used.
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata: { proposal_id: proposalId },
        },
        { idempotencyKey: `inst_mandate_${proposalId}` },
      );

      if (si.status === "succeeded") {
        await db().update(proposals).set({ stripePaymentMethodId: paymentMethodId })
          .where(eq(proposals.id, proposalId));
        return "authorised";
      }
      // requires_action: their bank wants the cardholder. Recorded, not chased.
      console.warn(`[instalment-billing] ${proposal.contactName}: card needs the client to approve (${si.status})`);
      return "needs-the-client";
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "authentication_required" || code === "setup_intent_authentication_failure") {
        console.warn(`[instalment-billing] ${proposal.contactName}: bank requires the cardholder to approve`);
        return "needs-the-client";
      }
      throw e;
    }
  } catch (e) {
    // Losing this costs us a smoother charge, never the charge itself.
    console.error("[instalment-billing] could not register the card for future charges:", e);
    return "failed";
  }
}
