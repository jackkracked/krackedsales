import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, slackSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasStripe, stripe } from "@/lib/stripe/client";
import { clampedTrialEnd, issueNextDepositInvoice } from "@/lib/proposals/deposit-billing";
import { createUpfrontCheckout, createSpreadCheckout, createSpreadSubscriptionCheckout, type AutoRebillMode } from "@/lib/proposals/ninety-day-billing";
import { firstPaymentDiscount, type BillingTerms } from "@/lib/proposals/billing";
import { postToSalesChannel } from "@/lib/proposals/slack-notify";
import { generateAgreementPdf } from "@/lib/pdf/render";
import { resolveProposalContent } from "@/lib/proposals/templates";
import { sendSignedAgreementEmail } from "@/lib/email/resend";
import { dispatchWorkflowEvent } from "@/lib/workflows/triggers";
import sharp from "sharp";

/** A real signature needs meaningful ink AND spread — rejects a single dot/tap. Fails open
 *  (allows) only if the image can't be analysed, so a genuine signer is never blocked. */
async function isRealSignature(dataUri: string): Promise<boolean> {
  try {
    if (!dataUri.startsWith("data:image")) return false;
    const buf = Buffer.from(dataUri.split(",")[1] ?? "", "base64");
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let ink = 0, minX = info.width, maxX = -1, minY = info.height, maxY = -1;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * ch + 3] > 20) { ink++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
    }
    return ink >= 100 && maxX - minX >= 40 && maxY - minY >= 12;
  } catch (e) {
    console.error("[sign] signature analysis failed, allowing:", e);
    return true;
  }
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { signature, signerName, signerTitle } = body;

    if (!signature) {
      return NextResponse.json({ error: "Signature required" }, { status: 400 });
    }
    if (!(await isRealSignature(signature))) {
      return NextResponse.json({ error: "Please draw your full signature, not just a dot." }, { status: 400 });
    }

    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (proposal.status !== "sent") {
      return NextResponse.json({ error: "Proposal is not in sent status" }, { status: 400 });
    }

    // Use signerName if provided and different, otherwise keep the original contactName
    const resolvedSignerName: string = (signerName && signerName.trim()) ? signerName.trim() : proposal.contactName;

    // Get client IP
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";

    // Always resolve an ABSOLUTE base URL. A missing Origin header would otherwise make the
    // Stripe redirect/success URLs relative, which Stripe rejects — silently forcing the
    // Payment Link back to a 24h Checkout Session (the exact stranding bug we're fixing).
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ||
      req.headers.get("origin") ||
      "https://kracked-sales.vercel.app";
    // ── Record the signature FIRST. A Stripe hiccup must NEVER block a client from signing
    //    (that is the exact failure that killed July). Payment setup happens next, best-effort.
    await db()
      .update(proposals)
      .set({
        status: "signed",
        signedAt: new Date(),
        signedIp: ip,
        signatureData: signature,
        signerTitle: signerTitle?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, id));

    // ── Set up the payment path AT SIGN (never on send). Invoices carry a 30-day due date.
    //    If anything fails we alert #kracked-ai-sales and carry on — the signature is saved and
    //    the client sees success; the team follows up manually.
    let hostedUrl: string | null = null;

    /** Remember the one-off discount coupon, so a resumed or re-signed checkout REUSES it instead
     *  of minting a second one and stacking two discounts on the same deal. */
    const persistCoupon = async (couponId: string | null) => {
      if (!couponId || couponId === proposal.stripeDiscountCouponId) return;
      await db().update(proposals)
        .set({ stripeDiscountCouponId: couponId, updatedAt: new Date() })
        .where(eq(proposals.id, proposal.id));
    };
    if (hasStripe()) {
      try {
        // Ensure a Stripe customer exists (send usually makes it; create here if missing).
        let customerId = proposal.stripeCustomerId ?? null;
        if (!customerId && proposal.contactEmail) {
          const c = await stripe().customers.create({
            name: proposal.contactName,
            // Stripe receipts/invoices go to the separate billing email when one is set.
            email: proposal.billingEmail ?? proposal.contactEmail,
            metadata: { ghl_contact_id: proposal.ghlContactId },
          });
          customerId = c.id;
          await db().update(proposals).set({ stripeCustomerId: customerId }).where(eq(proposals.id, id));
          proposal.stripeCustomerId = customerId;
        }

        if (proposal.paymentStructure === "single") {
          // Single invoice, DUE IN 30 DAYS. Reuse an existing invoice (older proposals), else create.
          if (proposal.stripeInvoiceId) {
            const inv = await stripe().invoices.retrieve(proposal.stripeInvoiceId);
            hostedUrl = inv.hosted_invoice_url ?? null;
          } else if (customerId) {
            const invoice = await stripe().invoices.create({
              customer: customerId,
              collection_method: "send_invoice",
              days_until_due: 30,
              metadata: { ghl_contact_id: proposal.ghlContactId, proposal_id: proposal.id },
              auto_advance: false,
            });
            await stripe().invoiceItems.create({
              customer: customerId,
              invoice: invoice.id,
              amount: Math.round(proposal.totalAmount * 100),
              currency: proposal.currency,
              description:
                proposal.serviceDescription ??
                `${proposal.type === "management" ? "Management Retainer" : "Project"} — ${proposal.contactName}`,
            });
            await stripe().invoices.finalizeInvoice(invoice.id, { auto_advance: false });
            const fin = await stripe().invoices.retrieve(invoice.id);
            hostedUrl = fin.hosted_invoice_url ?? null;
            await db().update(proposals).set({ stripeInvoiceId: invoice.id }).where(eq(proposals.id, id));
          }

        } else if (proposal.paymentStructure === "instalment") {
          // First instalment invoice, DUE IN 30 DAYS. Reuse if it exists, else create.
          const instalments = await db()
            .select()
            .from(proposalInstalments)
            .where(eq(proposalInstalments.proposalId, id))
            .orderBy(proposalInstalments.instalmentNumber);
          const first = instalments[0];
          if (first?.stripeInvoiceId) {
            const inv = await stripe().invoices.retrieve(first.stripeInvoiceId);
            hostedUrl = inv.hosted_invoice_url ?? null;
            if (hostedUrl) {
              await db().update(proposalInstalments).set({ stripeHostedUrl: hostedUrl }).where(eq(proposalInstalments.id, first.id));
            }
          } else if (first && customerId) {
            const inv = await stripe().invoices.create({
              customer: customerId,
              collection_method: "send_invoice",
              days_until_due: 30,
              metadata: { ghl_contact_id: proposal.ghlContactId, proposal_id: proposal.id, instalment_number: String(first.instalmentNumber) },
              auto_advance: false,
            });
            await stripe().invoiceItems.create({
              customer: customerId,
              invoice: inv.id,
              amount: Math.round(first.amount * 100),
              currency: proposal.currency,
              description: `Instalment ${first.instalmentNumber} of ${instalments.length} — ${proposal.contactName}`,
            });
            await stripe().invoices.finalizeInvoice(inv.id, { auto_advance: false });
            const fin = await stripe().invoices.retrieve(inv.id);
            hostedUrl = fin.hosted_invoice_url ?? null;
            await db()
              .update(proposalInstalments)
              .set({ stripeInvoiceId: inv.id, stripeHostedUrl: hostedUrl ?? undefined })
              .where(eq(proposalInstalments.id, first.id));
          }

        } else if (proposal.type === "management" && proposal.managementOption === "upfront" && customerId) {
          // 90-Day Management, pay upfront: one Checkout that charges the full 90-day amount and
          // creates a subscription. The webhook applies the auto-rebill stop. totalAmount is the
          // MONTHLY figure; the engine multiplies by the 3-month term.
          // A "first_payment" discount here comes off the single 90-day charge, once. It returns 0
          // for a recurring discount (already inside totalAmount), so this changes nothing for
          // every proposal written before the scope existed.
          const upfrontOneOff = firstPaymentDiscount(proposal as unknown as BillingTerms);
          const { url, couponId } = await createUpfrontCheckout(stripe(), {
            customerId,
            monthlyAmountCents: Math.round(proposal.totalAmount * 100),
            currency: proposal.currency,
            proposalId: proposal.id,
            productName: proposal.title,
            successUrl: `${origin}/p/${proposal.token}?payment=success`,
            cancelUrl: `${origin}/p/${proposal.token}`,
            autoRebillMode: (proposal.autoRebillMode ?? "none") as AutoRebillMode,
            oneOffDiscountCents: Math.round(upfrontOneOff * 100),
            existingCouponId: proposal.stripeDiscountCouponId ?? null,
          });
          await persistCoupon(couponId);
          hostedUrl = url;

        } else if (proposal.type === "management" && proposal.managementOption === "spread" && customerId) {
          // 90-Day Management, spread: Checkout saves the card + charges the first payment; the webhook
          // stores the card + schedules the rest. If the first month is SPLIT, the Checkout charges only
          // portion 1; the remaining portions (then months 2 & 3) are auto-charged off-session.
          const fpSplit = Array.isArray(proposal.firstPaymentSplit) && proposal.firstPaymentSplit.length > 1
            ? (proposal.firstPaymentSplit as { amount: number }[]) : null;

          if (!fpSplit) {
            // THE NORMAL CASE: a monthly subscription billed 3 times, then stopped. Gives the
            // client an invoice per payment, counts toward Management MRR with no manual patch,
            // and lets Stripe do the charging, retrying and chasing.
            // Proven 14/14 in scripts/stripe-test/prove-spread-subscription.mjs.
            // A "first_payment" discount is passed as a ONE-OFF coupon, never by lowering the
            // monthly amount — that would discount every month and turn $250 off into $750 off
            // across a 90-day term. firstPaymentDiscount() returns 0 for a recurring discount,
            // which is already inside totalAmount, so this is a no-op for existing proposals.
            const oneOff = firstPaymentDiscount(proposal as unknown as BillingTerms);
            const { url, couponId } = await createSpreadSubscriptionCheckout(stripe(), {
              customerId,
              monthlyAmountCents: Math.round(proposal.totalAmount * 100),
              currency: proposal.currency,
              proposalId: proposal.id,
              productName: proposal.title,
              successUrl: `${origin}/p/${proposal.token}?payment=success`,
              cancelUrl: `${origin}/p/${proposal.token}`,
              autoRebillMode: (proposal.autoRebillMode ?? "none") as AutoRebillMode,
              oneOffDiscountCents: Math.round(oneOff * 100),
              existingCouponId: proposal.stripeDiscountCouponId ?? null,
            });
            await persistCoupon(couponId);
            hostedUrl = url;
          } else {
            // SPLIT FIRST PAYMENT: a subscription's first cycle is a single charge, so it cannot
            // express "portion 1 now, portion 2 in N days". So the FIRST MONTH is collected as
            // card charges (portion 1 here, the rest off-session on their dates), and the moment
            // the last portion clears, onFirstMonthCollected starts a real subscription for the
            // remaining months — invoices, MRR and Stripe-native dunning from that point.
            // Proven 17/17 with uneven portions in prove-split-first-payment.mjs:
            // $600 now, $900 at +14d, then $1,500 at +30 and +60, stops, exactly $4,500.
            // A first-payment discount comes off the FIRST PORTION only, as a coupon on this
            // charge. $600 + $400 with $250 off collects $350 then $400 — matching the schedule
            // the client signed, where only row 0 is reduced (managementSchedule in billing.ts).
            const splitOneOff = firstPaymentDiscount(proposal as unknown as BillingTerms);
            const { url, couponId } = await createSpreadCheckout(stripe(), {
              customerId,
              firstChargeCents: Math.round((fpSplit[0]?.amount ?? 0) * 100),
              currency: proposal.currency,
              proposalId: proposal.id,
              productName: proposal.title,
              successUrl: `${origin}/p/${proposal.token}?payment=success`,
              cancelUrl: `${origin}/p/${proposal.token}`,
              oneOffDiscountCents: Math.round(splitOneOff * 100),
              existingCouponId: proposal.stripeDiscountCouponId ?? null,
            });
            await persistCoupon(couponId);
            hostedUrl = url;
            postToSalesChannel(
              `:information_source: *${proposal.contactName}* signed a 90-day retainer with a SPLIT first payment. ` +
                `The first month collects as card charges on their agreed dates; once the last portion clears, ` +
                `a subscription takes over for the remaining months (invoices + Management MRR from that point).`,
            ).catch(() => {});
          }

        } else if (proposal.paymentStructure === "subscription" && proposal.hasDeposit && customerId) {
          // First deposit invoice (30-day, set in deposit-billing). Deposits stay sequential via
          // the webhook; the recurring subscription is created once the full deposit is collected.
          const res = await issueNextDepositInvoice(id);
          hostedUrl = res?.hostedUrl ?? null;

        } else if (proposal.paymentStructure === "subscription" && customerId) {
          // Recurring subscription (no deposit) — a durable Payment Link that never expires, with
          // a Checkout Session fallback. Paying it creates the real recurring subscription.
          const interval = (proposal.billingInterval ?? "month") as "day" | "week" | "month" | "year";
          const intervalCount = proposal.billingIntervalCount ?? 1;
          const price = await stripe().prices.create({
            currency: proposal.currency,
            unit_amount: Math.round(proposal.totalAmount * 100),
            recurring: { interval, interval_count: intervalCount },
            product_data: { name: proposal.title, metadata: { proposal_id: proposal.id } },
          });
          const subTrialEnd = proposal.subscriptionStartDate ? clampedTrialEnd(new Date(proposal.subscriptionStartDate)) : null;
          const trialDays = subTrialEnd ? Math.max(1, Math.ceil((subTrialEnd * 1000 - Date.now()) / 86_400_000)) : null;
          try {
            const link = await stripe().paymentLinks.create({
              line_items: [{ price: price.id, quantity: 1 }],
              metadata: { proposal_id: proposal.id },
              subscription_data: {
                metadata: { proposal_id: proposal.id },
                ...(trialDays ? { trial_period_days: trialDays } : {}),
              },
              after_completion: { type: "redirect", redirect: { url: `${origin}/p/${proposal.token}?payment=success` } },
              restrictions: { completed_sessions: { limit: 1 } },
            }, { idempotencyKey: `plink_${proposal.id}` });
            hostedUrl = link.url;
          } catch (linkErr) {
            console.error("[sign] Payment Link unavailable, falling back to Checkout Session:", linkErr);
            const session = await stripe().checkout.sessions.create({
              customer: customerId,
              mode: "subscription",
              line_items: [{ price: price.id, quantity: 1 }],
              success_url: `${origin}/p/${proposal.token}?payment=success`,
              cancel_url: `${origin}/p/${proposal.token}`,
              metadata: { proposal_id: proposal.id },
              subscription_data: { metadata: { proposal_id: proposal.id }, ...(subTrialEnd ? { trial_end: subTrialEnd } : {}) },
            }, { idempotencyKey: `csess_${proposal.id}` });
            hostedUrl = session.url;
          }
        }

        if (hostedUrl) {
          await db().update(proposals).set({ stripeHostedUrl: hostedUrl, updatedAt: new Date() }).where(eq(proposals.id, id));
        }
      } catch (payErr) {
        const emsg = payErr instanceof Error ? payErr.message : String(payErr);
        console.error("[sign] payment setup failed (signature is saved):", emsg);
        postToSalesChannel(
          `:warning: *${proposal.contactName}* signed their proposal (${proposal.title}) but we couldn't set up their payment: ${emsg}. Please set it up manually.`,
        ).catch(() => {});
      }
    }

    dispatchWorkflowEvent("proposal.signed", {
      proposalId: id,
      contactName: proposal.contactName,
      contactEmail: proposal.contactEmail ?? null,
      contactId: proposal.ghlContactId,
      opportunityId: proposal.opportunityId ?? null,
      proposalTitle: proposal.title,
      proposalType: proposal.type,
      totalAmount: proposal.totalAmount,
      currency: proposal.currency,
      serviceDescription: proposal.serviceDescription ?? null,
      paymentStructure: proposal.paymentStructure,
      signerTitle: signerTitle?.trim() ?? null,
      signedAt: new Date().toISOString(),
      stripeCustomerId: proposal.stripeCustomerId ?? null,
    }).catch(() => {});

    // Fire-and-forget: Slack + email
    (async () => {
      try {
        const [slack] = await db().select().from(slackSettings).limit(1);
        if (slack?.demoWebhookUrl && slack.enabled) {
          const amount = new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: proposal.currency.toUpperCase(),
          }).format(proposal.totalAmount);
          await fetch(slack.demoWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `🎉 New client signed! *${proposal.contactName}* signed *${proposal.title}* (${amount})`,
            }),
          });
        }
      } catch (e) {
        console.error("[sign] Slack notification failed:", e);
      }

      try {
        // Fetch instalments for PDF
        const allInstalments =
          proposal.paymentStructure === "instalment"
            ? await db()
                .select()
                .from(proposalInstalments)
                .where(eq(proposalInstalments.proposalId, id))
            : [];

        // Terms + acceptance from the effective per-proposal content (snapshot -> template ->
        // defaults), the single source of truth shared with the web page and the /pdf route.
        const content = await resolveProposalContent(proposal);

        const pdfBuffer = await generateAgreementPdf({
          id: proposal.id,
          title: proposal.title,
          type: proposal.type,
          contactName: resolvedSignerName,
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
          // 90-Day Management display fields — without these the emailed signed PDF would show the
          // monthly figure / "one month" instead of the 90-day total, contradicting the web page.
          managementOption: proposal.managementOption,
          autoRebillMode: proposal.autoRebillMode,
          firstPaymentSplit: proposal.firstPaymentSplit as Array<{ amount: number; offsetDays?: number }> | null,
          contractStartAt: proposal.contractStartAt,
          scheduleSnapshot: proposal.scheduleSnapshot,
          endDate: proposal.endDate,
          signedAt: new Date(),
          instalments: allInstalments,
          agreementTerms: content.terms,
          acceptance: content.acceptance,
          deliverables: proposal.deliverables,
          scopeIntro: content.scopeIntro,
          serviceLabel: content.serviceLabel,
          signatureData: signature,
        });

        await sendSignedAgreementEmail(
          {
            contactName: resolvedSignerName,
            contactEmail: proposal.contactEmail,
            title: proposal.title,
            totalAmount: proposal.totalAmount,
            currency: proposal.currency,
          },
          pdfBuffer
        );
      } catch (e) {
        console.error("[sign] Email notification failed:", e);
      }
    })();

    return NextResponse.json({ hostedUrl });
  } catch (err) {
    console.error("[POST /api/proposals/[id]/sign]", err);
    return NextResponse.json({ error: "Failed to sign proposal" }, { status: 500 });
  }
}
