import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, stripeCustomers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { hasStripe, stripe } from "@/lib/stripe/client";
import { sendProposalLinkEmail } from "@/lib/email/resend";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const recipientEmail: string | undefined = body?.recipientEmail;

    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (proposal.status !== "draft") {
      return NextResponse.json({ error: "Proposal already sent" }, { status: 400 });
    }

    // Use override email if provided, fall back to contact email
    const effectiveEmail = recipientEmail || proposal.contactEmail;

    let stripeCustomerId = proposal.stripeCustomerId ?? null;
    let stripeInvoiceId = proposal.stripeInvoiceId ?? null;

    if (hasStripe() && effectiveEmail) {
      // Create or retrieve Stripe customer
      if (!stripeCustomerId) {
        const existing = await db()
          .select()
          .from(stripeCustomers)
          .where(eq(stripeCustomers.ghlContactId, proposal.ghlContactId))
          .limit(1);

        if (existing.length > 0) {
          stripeCustomerId = existing[0].stripeCustomerId;
        } else {
          const customer = await stripe().customers.create({
            name: proposal.contactName,
            email: effectiveEmail,
            metadata: { ghl_contact_id: proposal.ghlContactId },
          });
          stripeCustomerId = customer.id;
          await db().insert(stripeCustomers).values({
            ghlContactId: proposal.ghlContactId,
            stripeCustomerId: customer.id,
          });
        }
      }

      if (proposal.paymentStructure === "single") {
        // Create invoice + item, then finalize
        if (!stripeInvoiceId) {
          const invoice = await stripe().invoices.create({
            customer: stripeCustomerId,
            collection_method: "send_invoice",
            days_until_due: 7,
            metadata: { ghl_contact_id: proposal.ghlContactId, proposal_id: proposal.id },
            auto_advance: false,
          });
          await stripe().invoiceItems.create({
            customer: stripeCustomerId,
            invoice: invoice.id,
            amount: Math.round(proposal.totalAmount * 100),
            currency: proposal.currency,
            description:
              proposal.serviceDescription ??
              `${proposal.type === "management" ? "Management Retainer" : "Project"} — ${proposal.contactName}`,
          });
          stripeInvoiceId = invoice.id;
        }
        await stripe().invoices.finalizeInvoice(stripeInvoiceId, { auto_advance: false });

      } else if (proposal.paymentStructure === "instalment") {
        // Create + finalize each instalment invoice
        const instalments = await db()
          .select()
          .from(proposalInstalments)
          .where(eq(proposalInstalments.proposalId, id))
          .orderBy(proposalInstalments.instalmentNumber);

        for (const inst of instalments) {
          let instInvoiceId = inst.stripeInvoiceId;
          if (!instInvoiceId) {
            const inv = await stripe().invoices.create({
              customer: stripeCustomerId,
              collection_method: "send_invoice",
              days_until_due: 7,
              metadata: {
                ghl_contact_id: proposal.ghlContactId,
                proposal_id: proposal.id,
                instalment_number: String(inst.instalmentNumber),
              },
              auto_advance: false,
            });
            await stripe().invoiceItems.create({
              customer: stripeCustomerId,
              invoice: inv.id,
              amount: Math.round(inst.amount * 100),
              currency: proposal.currency,
              description: `Instalment ${inst.instalmentNumber} of ${instalments.length} — ${proposal.contactName}`,
            });
            instInvoiceId = inv.id;
            await db()
              .update(proposalInstalments)
              .set({ stripeInvoiceId: instInvoiceId })
              .where(eq(proposalInstalments.id, inst.id));
          }
          await stripe().invoices.finalizeInvoice(instInvoiceId, { auto_advance: false });
        }
      } else if (proposal.paymentStructure === "subscription" && proposal.hasDeposit) {
        // Create + finalize deposit instalment invoices (subscription created when all deposits paid)
        const depositInstalments = await db()
          .select()
          .from(proposalInstalments)
          .where(eq(proposalInstalments.proposalId, id))
          .orderBy(proposalInstalments.instalmentNumber);

        for (const inst of depositInstalments.filter(i => i.isDeposit)) {
          let instInvoiceId = inst.stripeInvoiceId;
          if (!instInvoiceId) {
            const inv = await stripe().invoices.create({
              customer: stripeCustomerId,
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
              customer: stripeCustomerId,
              invoice: inv.id,
              amount: Math.round(inst.amount * 100),
              currency: proposal.currency,
              description: `Deposit ${inst.instalmentNumber} of ${depositInstalments.filter(i => i.isDeposit).length} — ${proposal.contactName}`,
            });
            instInvoiceId = inv.id;
            await db()
              .update(proposalInstalments)
              .set({ stripeInvoiceId: instInvoiceId })
              .where(eq(proposalInstalments.id, inst.id));
          }
          await stripe().invoices.finalizeInvoice(instInvoiceId, { auto_advance: false });
        }
      }
      // Subscription without deposit: Stripe Checkout Session created at sign time
    }

    await db()
      .update(proposals)
      .set({
        status: "sent",
        sentAt: new Date(),
        stripeCustomerId,
        stripeInvoiceId,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, id));

    logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: "proposal.sent",
      entityType: "proposal",
      entityId: proposal.id,
      entityName: proposal.contactName,
      metadata: { total_amount: proposal.totalAmount, currency: proposal.currency },
    });

    // Send the proposal link email — await so errors surface to the caller
    let emailWarning: string | null = null;
    try {
      await sendProposalLinkEmail({
        contactName: proposal.contactName,
        contactEmail: effectiveEmail,
        title: proposal.title,
        totalAmount: proposal.totalAmount,
        currency: proposal.currency,
        serviceDescription: proposal.serviceDescription,
        token: proposal.token,
        type: proposal.type,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[send] Proposal link email failed:", msg);
      emailWarning = `Proposal marked sent but email failed to deliver: ${msg}`;
    }

    return NextResponse.json({ success: true, emailWarning });
  } catch (err) {
    console.error("[POST /api/proposals/[id]/send]", err);
    const msg = err instanceof Error ? err.message : "Failed to send proposal";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
