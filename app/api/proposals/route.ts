import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
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
        updatedAt: new Date(),
      })
      .returning();

    // Create instalment rows (amounts/dates only — Stripe invoices created on send)
    if (paymentStructure === "instalment" && Array.isArray(instalments)) {
      for (const inst of instalments) {
        await db().insert(proposalInstalments).values({
          proposalId: proposal.id,
          instalmentNumber: inst.number,
          amount: inst.amount,
          dueDate: new Date(inst.dueDate),
        });
      }
    }

    return NextResponse.json({ proposal });
  } catch (err) {
    console.error("[POST /api/proposals]", err);
    const msg = err instanceof Error ? err.message : "Failed to create proposal";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
