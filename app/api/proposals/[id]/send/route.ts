import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, stripeCustomers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { hasStripe, stripe } from "@/lib/stripe/client";
import { postToSalesChannel } from "@/lib/proposals/slack-notify";
import { sendProposalLinkEmail, sendRenderedEmail } from "@/lib/email/resend";
import { renderTransactional } from "@/lib/reminders/transactional";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let alertName = "A proposal"; // hoisted so the failure alert can name the client
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const recipientEmail: string | undefined = body?.recipientEmail;

    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    alertName = proposal.contactName;
    if (proposal.status !== "draft") {
      return NextResponse.json({ error: "Proposal already sent" }, { status: 400 });
    }

    // Use override email if provided, fall back to contact email
    const effectiveEmail = recipientEmail || proposal.contactEmail;

    let stripeCustomerId = proposal.stripeCustomerId ?? null;
    const stripeInvoiceId = proposal.stripeInvoiceId ?? null;

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
            // Stripe receipts/invoices go to the separate billing email when one is set.
            email: proposal.billingEmail || effectiveEmail,
            metadata: { ghl_contact_id: proposal.ghlContactId },
          });
          stripeCustomerId = customer.id;
          await db().insert(stripeCustomers).values({
            ghlContactId: proposal.ghlContactId,
            stripeCustomerId: customer.id,
          });
        }
      }

      // Persist the customer id now so the deposit-billing helpers, which re-read the
      // proposal from the DB, can see it before we issue the first deposit invoice.
      if (stripeCustomerId && stripeCustomerId !== proposal.stripeCustomerId) {
        await db()
          .update(proposals)
          .set({ stripeCustomerId, updatedAt: new Date() })
          .where(eq(proposals.id, id));
        proposal.stripeCustomerId = stripeCustomerId;
      }

      // NOTE: no invoices or subscriptions are created on Send anymore. A proposal that has
      // only been sent must never put a live, chargeable, due-dated invoice into Stripe — that
      // is what chased clients for payment before they had signed. All payment setup (the
      // 30-day invoice for single/instalment/deposit, or the subscription pay link) now happens
      // at SIGN time. See app/api/proposals/[id]/sign/route.ts.
    }

    // NOTE: the payment schedule is deliberately NOT frozen here. The 90-day clock starts when
    // the client PAYS the first payment, not when the proposal is sent or signed, and Stripe
    // anchors the subscription to that same moment. Freezing at send would lock in dates
    // computed from `startDate`, which is only ever an estimate: a proposal sent on the 3rd and
    // paid on the 7th would be four days out for the whole term. The freeze happens on first
    // payment instead, in ninety-day-fulfillment.ts, once the real anchor is known.
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

    // Send the proposal link email — await so errors surface to the caller.
    // Prefer the editable "proposal_sent" template; fall back to the built-in email.
    let emailWarning: string | null = null;
    try {
      const ccList = (proposal.ccEmails as string[] | null) ?? [];
      const cc = ccList.filter((e) => e && e !== effectiveEmail);
      const templated = effectiveEmail ? await renderTransactional("proposal_sent", { ...proposal, contactEmail: effectiveEmail }) : null;
      if (templated && effectiveEmail) {
        await sendRenderedEmail(effectiveEmail, templated.subject, templated.html, cc.length ? cc : undefined);
      } else {
        await sendProposalLinkEmail({
          contactName: proposal.contactName,
          contactEmail: effectiveEmail,
          title: proposal.title,
          totalAmount: proposal.totalAmount,
          currency: proposal.currency,
          serviceDescription: proposal.serviceDescription,
          ccEmails: ccList,
          token: proposal.token,
          type: proposal.type,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[send] Proposal link email failed:", msg);
      emailWarning = `Proposal marked sent but email failed to deliver: ${msg}`;
    }

    return NextResponse.json({ success: true, emailWarning });
  } catch (err) {
    console.error("[POST /api/proposals/[id]/send]", err);
    const msg = err instanceof Error ? err.message : "Failed to send proposal";
    postToSalesChannel(`:warning: Couldn't send *${alertName}*'s proposal: ${msg}`).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
