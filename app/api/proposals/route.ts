import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import crypto from "crypto";
import { logActivity } from "@/lib/activity/logger";
import { addPeriod } from "@/lib/proposals/billing";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db()
      .select({
        id: proposals.id,
        token: proposals.token,
        title: proposals.title,
        type: proposals.type,
        ghlContactId: proposals.ghlContactId,
        contactName: proposals.contactName,
        contactEmail: proposals.contactEmail,
        opportunityId: proposals.opportunityId,
        createdBy: proposals.createdBy,
        createdByName: users.name,
        status: proposals.status,
        totalAmount: proposals.totalAmount,
        currency: proposals.currency,
        serviceDescription: proposals.serviceDescription,
        notes: proposals.notes,
        paymentStructure: proposals.paymentStructure,
        billingInterval: proposals.billingInterval,
        billingIntervalCount: proposals.billingIntervalCount,
        autoRenew: proposals.autoRenew,
        listAmount: proposals.listAmount,
        discountType: proposals.discountType,
        discountValue: proposals.discountValue,
        startDate: proposals.startDate,
        endDate: proposals.endDate,
        expiresAt: proposals.expiresAt,
        hasDeposit: proposals.hasDeposit,
        depositTotal: proposals.depositTotal,
        depositsPaidTotal: proposals.depositsPaidTotal,
        subscriptionCreatedAt: proposals.subscriptionCreatedAt,
        stripeInvoiceId: proposals.stripeInvoiceId,
        stripeSubscriptionId: proposals.stripeSubscriptionId,
        stripeCustomerId: proposals.stripeCustomerId,
        stripeHostedUrl: proposals.stripeHostedUrl,
        signedAt: proposals.signedAt,
        sentAt: proposals.sentAt,
        paidAt: proposals.paidAt,
        cancelledAt: proposals.cancelledAt,
        createdAt: proposals.createdAt,
        updatedAt: proposals.updatedAt,
      })
      .from(proposals)
      .leftJoin(users, eq(proposals.createdBy, users.id))
      .orderBy(desc(proposals.createdAt));

    const withInstalments = await Promise.all(
      rows.map(async (p) => {
        if (p.paymentStructure === "instalment" || p.hasDeposit) {
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
      hasDeposit,
      depositInstalments,
      autoRenew,
      listAmount,
      discountType,
      discountValue,
    } = body;

    if (!type || !ghlContactId || !contactName || !totalAmount || !paymentStructure) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // ── Billing-model guardrail (Gate 6: never persist an inconsistent state) ──
    // Management: auto-renew ON => recurring subscription; OFF => paid-in-full single charge.
    // Projects are always one-off (single/instalment) and auto-renew does not apply.
    const isManagement = type === "management";
    const resolvedAutoRenew = isManagement ? autoRenew !== false : false;
    // Management is ALWAYS a Stripe subscription. Auto-renew OFF becomes a
    // self-cancelling subscription (one charge, cancels at term end) so it still
    // counts toward Management Clients / MRR, normalized to the monthly run-rate.
    const resolvedPaymentStructure = isManagement ? "subscription" : paymentStructure;
    // Deposits only make sense for a recurring (auto-renew ON) subscription.
    const resolvedHasDeposit = isManagement && resolvedAutoRenew ? hasDeposit ?? false : false;

    // Stripe caps a subscription's billing period at one year. A management term longer
    // than that can't be one billing period (recurring OR pay-in-full), so reject it here
    // with a clear message rather than letting it 500 at sign time after the price is built.
    if (isManagement) {
      const iv = billingInterval ?? "month";
      const ct = billingIntervalCount ?? 1;
      const tooLong =
        (iv === "month" && ct > 12) ||
        (iv === "week" && ct > 52) ||
        (iv === "day" && ct > 365) ||
        (iv === "year" && ct > 1);
      if (tooLong) {
        return NextResponse.json(
          { error: "A billing period can be at most one year. Use a term of 12 months or less." },
          { status: 400 }
        );
      }
    }
    // ── Authoritative money (Gate 6: the server re-derives every dollar; it never
    //    trusts the client's arithmetic) ──
    // When a discount is present, recompute the billed total from list price + discount
    // here, so a malformed payload can never persist (and later charge) a wrong amount.
    const hasDiscount =
      typeof listAmount === "number" && listAmount > 0 && typeof discountValue === "number" && discountValue > 0;
    let billed: number;
    if (hasDiscount) {
      const rawDiscount = discountType === "fixed" ? discountValue : listAmount * (discountValue / 100);
      const clampedDiscount = Math.min(Math.max(rawDiscount, 0), listAmount);
      billed = Math.round((listAmount - clampedDiscount) * 100) / 100;
    } else {
      billed = Math.round((Number(totalAmount) || 0) * 100) / 100;
    }
    if (!(billed > 0)) {
      return NextResponse.json({ error: "Billed amount must be greater than zero" }, { status: 400 });
    }

    // Payment schedules must reconcile to the billed total — enforced server-side, not just in the UI.
    if (resolvedPaymentStructure === "instalment" && Array.isArray(instalments) && instalments.length > 0) {
      const sum = instalments.reduce((acc: number, i: { amount?: number }) => acc + (Number(i.amount) || 0), 0);
      if (Math.abs(sum - billed) > 0.01) {
        return NextResponse.json({ error: "Instalment amounts must add up to the total." }, { status: 400 });
      }
    }
    if (resolvedHasDeposit && Array.isArray(depositInstalments) && depositInstalments.length > 0) {
      const sum = depositInstalments.reduce((acc: number, i: { amount?: number }) => acc + (Number(i.amount) || 0), 0);
      if (Math.abs(sum - billed) > 0.01) {
        return NextResponse.json({ error: "Deposit amounts must add up to one billing cycle." }, { status: 400 });
      }
    }

    // For a fixed-term (auto-renew OFF) management proposal, derive the term end date.
    const startDt = startDate ? new Date(startDate + "T12:00:00.000Z") : new Date();
    const resolvedEndDate =
      isManagement && !resolvedAutoRenew && billingIntervalCount
        ? addPeriod(startDt, billingInterval ?? "month", billingIntervalCount)
        : endDate
        ? new Date(endDate + "T12:00:00.000Z")
        : null;

    const token = crypto.randomBytes(32).toString("hex");
    // Default expiry: today (rep can change it in the preview)
    const todayNoon = new Date();
    todayNoon.setUTCHours(12, 0, 0, 0);
    const expiresAt = todayNoon;

    const title = `${type === "management" ? "Management Retainer" : "Project"} — ${contactName}`;

    // Save proposal to DB — Stripe is handled at send time
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
        totalAmount: billed,
        currency,
        serviceDescription: serviceDescription ?? null,
        notes: notes ?? null,
        paymentStructure: resolvedPaymentStructure,
        billingInterval: billingInterval ?? null,
        billingIntervalCount: billingIntervalCount ?? null,
        autoRenew: resolvedAutoRenew,
        listAmount: hasDiscount ? listAmount : null,
        discountType: hasDiscount ? (discountType ?? null) : null,
        discountValue: hasDiscount ? discountValue : null,
        startDate: startDate ? new Date(startDate + "T12:00:00.000Z") : todayNoon,
        endDate: resolvedEndDate,
        expiresAt,
        hasDeposit: resolvedHasDeposit,
        depositTotal: resolvedHasDeposit ? billed : null,
        updatedAt: new Date(),
      })
      .returning();

    // Create instalment rows (amounts/dates only — Stripe invoices created on send)
    if (resolvedPaymentStructure === "instalment" && Array.isArray(instalments)) {
      for (const inst of instalments) {
        await db().insert(proposalInstalments).values({
          proposalId: proposal.id,
          instalmentNumber: inst.number,
          amount: inst.amount,
          dueDate: new Date(inst.dueDate + "T12:00:00.000Z"),
        });
      }
    }

    // Create deposit instalment rows for subscription proposals with deposits
    if (resolvedHasDeposit && Array.isArray(depositInstalments)) {
      for (const inst of depositInstalments) {
        await db().insert(proposalInstalments).values({
          proposalId: proposal.id,
          instalmentNumber: inst.number,
          amount: inst.amount,
          dueDate: new Date(inst.dueDate + "T12:00:00.000Z"),
          isDeposit: true,
        });
      }
    }

    logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: "proposal.created",
      entityType: "proposal",
      entityId: proposal.id,
      entityName: contactName,
      metadata: { total_amount: totalAmount, currency, type, opportunity_id: opportunityId },
    });

    return NextResponse.json({ proposal });
  } catch (err) {
    console.error("[POST /api/proposals]", err);
    const msg = err instanceof Error ? err.message : "Failed to create proposal";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
