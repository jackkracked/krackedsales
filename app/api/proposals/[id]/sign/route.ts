import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, slackSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasStripe, stripe } from "@/lib/stripe/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { signature } = body;

    if (!signature) {
      return NextResponse.json({ error: "Signature required" }, { status: 400 });
    }

    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (proposal.status !== "sent") {
      return NextResponse.json({ error: "Proposal is not in sent status" }, { status: 400 });
    }

    // Get client IP
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";

    const origin = req.headers.get("origin") ?? "";
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

      } else if (proposal.paymentStructure === "subscription" && proposal.stripeCustomerId) {
        // Create a Stripe Checkout Session for recurring subscription
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

        const session = await stripe().checkout.sessions.create({
          customer: proposal.stripeCustomerId,
          mode: "subscription",
          line_items: [{ price: price.id, quantity: 1 }],
          success_url: `${origin}/p/${proposal.token}?payment=success`,
          cancel_url: `${origin}/p/${proposal.token}`,
          metadata: { proposal_id: proposal.id },
          subscription_data: {
            metadata: { proposal_id: proposal.id },
          },
        });

        hostedUrl = session.url;
      }
    }

    await db()
      .update(proposals)
      .set({
        status: "signed",
        signedAt: new Date(),
        signedIp: ip,
        signatureData: signature,
        stripeHostedUrl: hostedUrl,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, id));

    // Fire-and-forget: Slack notification
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
    })();

    return NextResponse.json({ hostedUrl });
  } catch (err) {
    console.error("[POST /api/proposals/[id]/sign]", err);
    return NextResponse.json({ error: "Failed to sign proposal" }, { status: 500 });
  }
}
