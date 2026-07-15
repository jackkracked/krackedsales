import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, slackSettings, agreementTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasStripe, stripe } from "@/lib/stripe/client";
import { clampedTrialEnd, issueNextDepositInvoice } from "@/lib/proposals/deposit-billing";
import { postToSalesChannel } from "@/lib/proposals/slack-notify";
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
    if (hasStripe()) {
      try {
        // Ensure a Stripe customer exists (send usually makes it; create here if missing).
        let customerId = proposal.stripeCustomerId ?? null;
        if (!customerId && proposal.contactEmail) {
          const c = await stripe().customers.create({
            name: proposal.contactName,
            email: proposal.contactEmail,
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
