import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, stripeCustomers } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { hasStripe, stripe } from "@/lib/stripe/client";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db()
      .select()
      .from(proposals)
      .orderBy(desc(proposals.createdAt));

    const withInstalments = await Promise.all(
      rows.map(async (p) => {
        if (p.paymentStructure === "instalment") {
          const instalments = await db()
            .select()
            .from(proposalInstalments)
            .where(eq(proposalInstalments.proposalId, p.id));
          return { ...p, instalments };
        }
        return { ...p, instalments: [] };
      })
    );

    return NextResponse.json({ proposals: withInstalments });
  } catch (err) {
    console.error("[GET /api/proposals]", err);
    return NextResponse.json({ error: "Failed to fetch proposals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const {
      type,
      ghlContactId,
      contactName,
      contactEmail,
      opportunityId,
      serviceDescription,
      totalAmount,
      currency = "usd",
      paymentStructure,
      billingInterval,
      billingIntervalCount,
      startDate,
      endDate,
      notes,
      instalments,
    } = body;

    if (!type || !ghlContactId || !contactName || !totalAmount || !paymentStructure) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    let stripeCustomerId: string | null = null;
    let stripeInvoiceId: string | null = null;

    // Create or retrieve Stripe customer
    if (hasStripe() && contactEmail) {
      const existingCustomer = await db()
        .select()
        .from(stripeCustomers)
        .where(eq(stripeCustomers.ghlContactId, ghlContactId))
        .limit(1);

      if (existingCustomer.length > 0) {
        stripeCustomerId = existingCustomer[0].stripeCustomerId;
      } else {
        const customer = await stripe().customers.create({
          name: contactName,
          email: contactEmail,
          metadata: { ghl_contact_id: ghlContactId },
        });
        stripeCustomerId = customer.id;
        await db().insert(stripeCustomers).values({
          ghlContactId,
          stripeCustomerId: customer.id,
        });
      }

      // Create draft invoice for single payment
      if (paymentStructure === "single" && stripeCustomerId) {
        const invoice = await stripe().invoices.create({
          customer: stripeCustomerId,
          collection_method: "send_invoice",
          days_until_due: 7,
          description: serviceDescription ?? undefined,
          metadata: { ghl_contact_id: ghlContactId },
          auto_advance: false,
        });
        await stripe().invoiceItems.create({
          customer: stripeCustomerId,
          invoice: invoice.id,
          amount: Math.round(totalAmount * 100),
          currency,
          description: serviceDescription ?? `${type === "management" ? "Management Retainer" : "Project"} — ${contactName}`,
        });
        stripeInvoiceId = invoice.id;
      }
    }

    const title = `${type === "management" ? "Management Retainer" : "Project"} — ${contactName}`;

    const [proposal] = await db()
      .insert(proposals)
      .values({
        token,
        title,
        type,
        ghlContactId,
        contactName,
        contactEmail: contactEmail ?? null,
        opportunityId: opportunityId ?? null,
        createdBy: user.id,
        totalAmount,
        currency,
        serviceDescription: serviceDescription ?? null,
        notes: notes ?? null,
        paymentStructure,
        billingInterval: billingInterval ?? null,
        billingIntervalCount: billingIntervalCount ?? null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        expiresAt,
        stripeInvoiceId,
        stripeCustomerId,
        updatedAt: new Date(),
      })
      .returning();

    // Create instalment rows
    if (paymentStructure === "instalment" && Array.isArray(instalments)) {
      for (const inst of instalments) {
        let instStripeInvoiceId: string | null = null;
        if (hasStripe() && stripeCustomerId) {
          const inv = await stripe().invoices.create({
            customer: stripeCustomerId,
            collection_method: "send_invoice",
            due_date: Math.floor(new Date(inst.dueDate).getTime() / 1000),
            description: `Instalment ${inst.number} of ${instalments.length} — ${contactName}`,
            metadata: { ghl_contact_id: ghlContactId, proposal_id: proposal.id, instalment_number: String(inst.number) },
            auto_advance: false,
          });
          await stripe().invoiceItems.create({
            customer: stripeCustomerId,
            invoice: inv.id,
            amount: Math.round(inst.amount * 100),
            currency,
            description: `Instalment ${inst.number} — ${serviceDescription ?? contactName}`,
          });
          instStripeInvoiceId = inv.id;
        }
        await db().insert(proposalInstalments).values({
          proposalId: proposal.id,
          instalmentNumber: inst.number,
          amount: inst.amount,
          dueDate: new Date(inst.dueDate),
          stripeInvoiceId: instStripeInvoiceId,
        });
      }
    }

    return NextResponse.json({ proposal });
  } catch (err) {
    console.error("[POST /api/proposals]", err);
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }
}
