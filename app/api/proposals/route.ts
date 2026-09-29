import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import crypto from "crypto";
import { logActivity } from "@/lib/activity/logger";
import { addPeriod } from "@/lib/proposals/billing";
import { getTemplateSections } from "@/lib/proposals/templates";
import { normalizeDeliverables } from "@/lib/proposals/normalize";
import { getProposalCredits } from "@/lib/proposals/credit";

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
        managementOption: proposals.managementOption,
        autoRebillMode: proposals.autoRebillMode,
        firstPaymentSplit: proposals.firstPaymentSplit,
        contractStartAt: proposals.contractStartAt,
        scheduleSnapshot: proposals.scheduleSnapshot,
        listAmount: proposals.listAmount,
        discountType: proposals.discountType,
        discountValue: proposals.discountValue,
        discountScope: proposals.discountScope,
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

    // WHO IS CREDITED, from the same ledger that pays people (lib/proposals/credit.ts). If it
    // cannot be computed the list still loads, and says so, rather than showing a guess.
    let credits: Awaited<ReturnType<typeof getProposalCredits>> | null = null;
    let creditError: string | null = null;
    try {
      credits = await getProposalCredits(rows.map((r) => r.id));
    } catch (err) {
      console.error("[GET /api/proposals] credit", err);
      creditError = "Could not work out who is credited right now";
    }
    // Names for the credit chips go to everyone; roles and who is active only to admins, who
    // need them for the pickers (security review L4).
    const viewer = await getSessionUser().catch(() => null);
    const people = await db()
      .select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive })
      .from(users);
    const team = viewer?.role === "admin" ? people : people.map((u) => ({ id: u.id, name: u.name, role: "", isActive: true }));

    return NextResponse.json({
      proposals: withInstalments.map((p) => ({ ...p, credit: credits?.get(p.id) ?? null })),
      team,
      creditError,
    });
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
      discountScope,
      subscriptionStartDate,
      managementOption,
      autoRebillMode,
      ccEmails,
      billingEmail,
      firstPaymentSplit,
      deliverables,
    } = body;

    if (!type || !ghlContactId || !contactName || !totalAmount || !paymentStructure) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // ── Validate + sanitize the new config fields (Gate 6: never persist junk / injection) ──
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = (e: unknown): string | null => {
      if (typeof e !== "string") return null;
      const v = e.replace(/[\r\n]/g, "").trim().toLowerCase();
      return EMAIL_RE.test(v) ? v : null;
    };
    const cleanBillingEmail = billingEmail ? cleanEmail(billingEmail) : null;
    if (billingEmail && !cleanBillingEmail) {
      return NextResponse.json({ error: "Invalid billing email" }, { status: 400 });
    }
    // CC: valid emails only, deduped (incl. vs contact email), capped at 5.
    const contactLower = (contactEmail ?? "").toLowerCase();
    const cleanCc = Array.isArray(ccEmails)
      ? [...new Set(ccEmails.map(cleanEmail).filter((e): e is string => !!e && e !== contactLower))].slice(0, 5)
      : [];
    // 90-day management config — only meaningful for management; ignored otherwise.
    const resolvedManagementOption =
      type === "management" && (managementOption === "upfront" || managementOption === "spread")
        ? managementOption : null;
    const resolvedAutoRebillMode =
      ["none", "monthly", "full90"].includes(autoRebillMode) ? autoRebillMode : "none";

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
    // "first_payment" means the discount comes off ONCE, so the recurring price stays whole and
    // the discount is carried separately (see migration 0051). Subtracting it here as well would
    // charge it on every payment — the exact bug this scope exists to prevent.
    const resolvedScope: "recurring" | "first_payment" | "total" =
      discountScope === "first_payment" || discountScope === "total" ? discountScope : "recurring";
    let billed: number;
    if (hasDiscount && resolvedScope !== "first_payment") {
      const rawDiscount = discountType === "fixed" ? discountValue : listAmount * (discountValue / 100);
      const clampedDiscount = Math.min(Math.max(rawDiscount, 0), listAmount);
      billed = Math.round((listAmount - clampedDiscount) * 100) / 100;
    } else if (hasDiscount) {
      // Full price. Trust listAmount over totalAmount so the two can never disagree.
      billed = Math.round(listAmount * 100) / 100;
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
    // Deposit is now ANY amount, independent of the monthly retainer: the deposit total is
    // simply the sum of its payments. Each payment must be a valid non-negative number.
    let depositSum = 0;
    if (resolvedHasDeposit && Array.isArray(depositInstalments) && depositInstalments.length > 0) {
      for (const i of depositInstalments as { amount?: number }[]) {
        const a = Number(i.amount);
        if (!Number.isFinite(a) || a < 0) {
          return NextResponse.json({ error: "Each deposit payment must be a valid non-negative amount." }, { status: 400 });
        }
      }
      depositSum =
        Math.round(depositInstalments.reduce((acc: number, i: { amount?: number }) => acc + (Number(i.amount) || 0), 0) * 100) / 100;
      if (!(depositSum > 0)) {
        return NextResponse.json({ error: "Deposit amount must be greater than zero." }, { status: 400 });
      }
    }

    // First-month split for "Pay every 30 days": 2-4 portions that ADD UP to the monthly amount,
    // portion 1 charged at signup (offsetDays 0), the rest auto-charged off-session on their dates.
    let resolvedFirstPaymentSplit: { amount: number; offsetDays: number }[] | null = null;
    if (resolvedManagementOption === "spread" && Array.isArray(firstPaymentSplit) && firstPaymentSplit.length > 1) {
      const portions = firstPaymentSplit.slice(0, 4).map((p: { amount?: number; offsetDays?: number }, i: number) => ({
        amount: Math.round((Number(p.amount) || 0) * 100) / 100,
        offsetDays: i === 0 ? 0 : Math.max(0, Math.round(Number(p.offsetDays) || 0)),
      }));
      if (portions.some((p) => p.amount <= 0)) {
        return NextResponse.json({ error: "Each first-payment portion must be greater than zero." }, { status: 400 });
      }
      const sum = Math.round(portions.reduce((a, p) => a + p.amount, 0) * 100) / 100;
      if (Math.abs(sum - billed) > 0.01) {
        return NextResponse.json({ error: `The first-payment split ($${sum}) must add up to the monthly amount ($${billed}).` }, { status: 400 });
      }
      resolvedFirstPaymentSplit = portions;
    }

    // The subscription first-charge date must be within ~18 months. Stripe caps a trial at
    // ~2 years from sign time; reject well under that so a deposit can never be collected and
    // then leave the subscription unable to be created.
    if (subscriptionStartDate) {
      const scd = new Date(subscriptionStartDate + "T12:00:00.000Z");
      const maxOut = new Date();
      maxOut.setMonth(maxOut.getMonth() + 18);
      if (isNaN(scd.getTime()) || scd.getTime() > maxOut.getTime()) {
        return NextResponse.json({ error: "The subscription's first charge date must be within 18 months." }, { status: 400 });
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
    // Proposals never expire. (The old default expired a proposal the SAME day it was created,
    // which killed links before clients could sign and forced delete+resend.) Kept nullable so
    // the signing page's expiry banner simply never renders.
    const todayNoon = new Date();
    todayNoon.setUTCHours(12, 0, 0, 0); // still the default start date below
    const expiresAt = null;

    const title = `${type === "management" ? "Management Retainer" : "Project"} — ${contactName}`;

    // Snapshot the active template copy onto the proposal now, so later template edits never alter
    // this proposal. Structured deliverables are validated from the builder payload.
    const contentSnapshot = await getTemplateSections(type === "project" ? "project" : "management");
    const cleanDeliverables = normalizeDeliverables(deliverables);

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
        discountScope: hasDiscount ? resolvedScope : null,
        startDate: startDate ? new Date(startDate + "T12:00:00.000Z") : todayNoon,
        // Rep-chosen date the recurring subscription's first charge lands. Null = legacy
        // behaviour (first charge one billing cycle after start, i.e. deposit covers cycle 1).
        subscriptionStartDate: subscriptionStartDate ? new Date(subscriptionStartDate + "T12:00:00.000Z") : null,
        endDate: resolvedEndDate,
        expiresAt,
        hasDeposit: resolvedHasDeposit,
        depositTotal: resolvedHasDeposit ? depositSum : null,
        // 90-day management config + recipients (billing engine consumes these at sign; stored now).
        managementOption: resolvedManagementOption,
        autoRebillMode: resolvedAutoRebillMode,
        firstPaymentSplit: resolvedFirstPaymentSplit,
        ccEmails: cleanCc.length ? cleanCc : null,
        billingEmail: cleanBillingEmail,
        deliverables: cleanDeliverables,
        content: contentSnapshot,
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
