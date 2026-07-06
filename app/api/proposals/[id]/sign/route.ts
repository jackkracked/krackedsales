import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, slackSettings, agreementTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasStripe, stripe } from "@/lib/stripe/client";
import { clampedTrialEnd } from "@/lib/proposals/deposit-billing";
import { generateAgreementPdf } from "@/lib/pdf/render";
import { sendSignedAgreementEmail } from "@/lib/email/resend";
import { dispatchWorkflowEvent } from "@/lib/workflows/triggers";

const DEFAULT_MANAGEMENT_TERMS = `**Service Collaboration & Cooperation**

To maintain a fair and healthy long-term relationship, Kracked Retention reserves the right to temporarily **pause services** if cooperation or communication from the Client prevents effective service delivery.

---

**Term & Renewal**

This Agreement operates on a **month-to-month basis** and will automatically renew unless terminated in accordance with the Pause & Termination Policy.

---

**Pause & Termination Policy**

- **Notice Requirement:** A minimum of 30 days' written notice must be provided to admin@krackedretention.com.
- **Work Completed in Advance:** Any work already completed or in progress at the time of notice will remain billable.
- **No Immediate Termination:** Pausing without the required notice may result in outstanding invoices.

---

**Privacy & Confidentiality**

Both parties agree to maintain the confidentiality of all business information, data, and assets shared.

---

**Terms of Sale**

- All sales are final and non-refundable.
- The Client retains sole ownership of all Customer Materials upon full payment.

---

**Governing Law**

This Agreement is governed by the laws of the State of Tennessee.`;

const DEFAULT_PROJECT_TERMS = `**Additional Scope Pricing**

| Additional Scope | Cost |
|---|---|
| Flow Emails | $300 per email |
| SMS | $100 per SMS/MMS |
| Pop-Up | $150 per Pop-Up |
| Flow Email Edits | $100 per email |

---

**Privacy & Confidentiality**

Both parties agree to maintain the confidentiality of all business information, data, and assets shared.

---

**Terms of Sale**

- All sales are final and non-refundable.
- The Client retains sole ownership of all Customer Materials upon full payment.
- This Agreement is governed by the laws of the State of Tennessee.`;

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { signature, signerName, signerTitle } = body;

    if (!signature) {
      return NextResponse.json({ error: "Signature required" }, { status: 400 });
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
    let hostedUrl: string | null = null;

    if (hasStripe()) {
      if (proposal.paymentStructure === "single" && proposal.stripeInvoiceId) {
        // Invoice was finalized on send — retrieve the hosted URL
        const inv = await stripe().invoices.retrieve(proposal.stripeInvoiceId);
        hostedUrl = inv.hosted_invoice_url ?? null;

      } else if (proposal.paymentStructure === "instalment") {
        // Point to first instalment's hosted invoice
        const instalments = await db()
          .select()
          .from(proposalInstalments)
          .where(eq(proposalInstalments.proposalId, id))
          .orderBy(proposalInstalments.instalmentNumber)
          .limit(1);

        if (instalments.length > 0 && instalments[0].stripeInvoiceId) {
          const inv = await stripe().invoices.retrieve(instalments[0].stripeInvoiceId);
          hostedUrl = inv.hosted_invoice_url ?? null;
          await db()
            .update(proposalInstalments)
            .set({ stripeHostedUrl: hostedUrl ?? undefined })
            .where(eq(proposalInstalments.id, instalments[0].id));
        }

      } else if (proposal.paymentStructure === "subscription" && proposal.hasDeposit && proposal.stripeCustomerId) {
        // Deposit proposal — skip Checkout Session, point to first unpaid deposit invoice
        const depositInstalments = await db()
          .select()
          .from(proposalInstalments)
          .where(eq(proposalInstalments.proposalId, id))
          .orderBy(proposalInstalments.instalmentNumber);

        const firstUnpaid = depositInstalments.find(i => i.isDeposit && i.status === "pending");
        if (firstUnpaid?.stripeInvoiceId) {
          const inv = await stripe().invoices.retrieve(firstUnpaid.stripeInvoiceId);
          hostedUrl = inv.hosted_invoice_url ?? null;
          if (hostedUrl) {
            await db()
              .update(proposalInstalments)
              .set({ stripeHostedUrl: hostedUrl })
              .where(eq(proposalInstalments.id, firstUnpaid.id));
          }
        }

      } else if (proposal.paymentStructure === "subscription" && proposal.stripeCustomerId) {
        // Create a Stripe Checkout Session for recurring subscription (no deposit)
        const interval = (proposal.billingInterval ?? "month") as "day" | "week" | "month" | "year";
        const intervalCount = proposal.billingIntervalCount ?? 1;

        const price = await stripe().prices.create({
          currency: proposal.currency,
          unit_amount: Math.round(proposal.totalAmount * 100),
          recurring: { interval, interval_count: intervalCount },
          product_data: {
            name: proposal.title,
            metadata: { proposal_id: proposal.id },
          },
        });

        // If the rep picked a first-charge date, trial the subscription until then so nothing
        // charges before it. With no date and no deposit, it bills immediately (as before).
        const subTrialEnd = proposal.subscriptionStartDate
          ? clampedTrialEnd(new Date(proposal.subscriptionStartDate))
          : null;

        // Durable Payment Link (preferred): unlike a Checkout Session, it NEVER expires, so a
        // client who signs today but pays in a few days is never stranded (the Epicured incident).
        // Payment Links use a RELATIVE trial (days from payment), so convert the absolute
        // first-charge date to whole days from now, clamped to >= 1.
        const trialDays = subTrialEnd
          ? Math.max(1, Math.ceil((subTrialEnd * 1000 - Date.now()) / 86_400_000))
          : null;

        try {
          // Subscription-mode Payment Links always create their own customer from the email the
          // client enters (Stripe does not allow pinning a pre-made customer here). That can make
          // a duplicate Stripe customer, but reconciliation is by the subscription's proposal_id
          // metadata (see the webhook), so the proposal still flips to paid correctly.
          const link = await stripe().paymentLinks.create({
            line_items: [{ price: price.id, quantity: 1 }],
            metadata: { proposal_id: proposal.id },
            subscription_data: {
              metadata: { proposal_id: proposal.id },
              ...(trialDays ? { trial_period_days: trialDays } : {}),
            },
            after_completion: {
              type: "redirect",
              redirect: { url: `${origin}/p/${proposal.token}?payment=success` },
            },
            restrictions: { completed_sessions: { limit: 1 } },
          }, { idempotencyKey: `plink_${proposal.id}` });
          hostedUrl = link.url;
        } catch (linkErr) {
          // The live key may not yet have `payment_links_write`. Fall back to the previous
          // Checkout Session so signing NEVER breaks. This link expires in 24h (Stripe's cap),
          // so grant the payment-link permission on the key to get the durable link.
          console.error("[sign] Payment Link unavailable, falling back to Checkout Session:", linkErr);
          const session = await stripe().checkout.sessions.create({
            customer: proposal.stripeCustomerId,
            mode: "subscription",
            line_items: [{ price: price.id, quantity: 1 }],
            success_url: `${origin}/p/${proposal.token}?payment=success`,
            cancel_url: `${origin}/p/${proposal.token}`,
            metadata: { proposal_id: proposal.id },
            subscription_data: {
              metadata: { proposal_id: proposal.id },
              ...(subTrialEnd ? { trial_end: subTrialEnd } : {}),
            },
          }, { idempotencyKey: `csess_${proposal.id}` });
          hostedUrl = session.url;
        }
      }
    }

    await db()
      .update(proposals)
      .set({
        status: "signed",
        signedAt: new Date(),
        signedIp: ip,
        signatureData: signature,
        signerTitle: signerTitle?.trim() || null,
        stripeHostedUrl: hostedUrl,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, id));

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

        // Fetch agreement terms
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
          startDate: proposal.startDate,
          endDate: proposal.endDate,
          signedAt: new Date(),
          instalments: allInstalments,
          agreementTerms,
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
