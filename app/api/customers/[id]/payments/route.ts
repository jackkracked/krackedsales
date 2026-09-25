import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { customers, customerPayments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { reconcileCustomerAggregates } from "@/lib/customers/reconcile";

export const dynamic = "force-dynamic";

const METHODS = new Set(["wire", "bill_com", "check", "ach", "cash", "other"]);

/**
 * Log a MANUAL payment (wire, bill.com, check, etc.) against a customer. Stored in
 * customer_payments with source='manual' and a synthetic `manual_<uuid>` stripe_id, so it
 * flows into the Customers-tab LTV / collected / count aggregates and the slide-over list,
 * and is never touched by the Stripe sync (which upserts by real stripe_id). Admin-only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser().catch(() => null);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const [customer] = await db()
    .select({ dedupeKey: customers.dedupeKey })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // Amount — accept dollars, store cents. Must be a positive number.
  const amount = Number(body.amount);
  if (!isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Enter an amount greater than 0" }, { status: 400 });
  const amountNet = Math.round(amount * 100);

  // Paid date — must be a valid date, not in the future.
  const paidAt = new Date(String(body.paidAt ?? ""));
  if (isNaN(paidAt.getTime())) return NextResponse.json({ error: "Enter a valid payment date" }, { status: 400 });
  if (paidAt.getTime() > Date.now() + 86_400_000) return NextResponse.json({ error: "Payment date can't be in the future" }, { status: 400 });

  const method = typeof body.method === "string" && METHODS.has(body.method) ? body.method : "other";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null;

  const [created] = await db()
    .insert(customerPayments)
    .values({
      dedupeKey: customer.dedupeKey,
      stripeId: `manual_${randomUUID()}`,
      source: "manual",
      amountNet,
      currency: "usd",
      paidAt,
      method,
      note,
      createdBy: user.id,
    })
    .returning();

  await reconcileCustomerAggregates(customer.dedupeKey);

  return NextResponse.json({
    payment: {
      id: created.id,
      at: created.paidAt.toISOString(),
      amount: created.amountNet,
      currency: created.currency ?? "usd",
      source: "manual",
      manual: true,
      method: created.method,
      note: created.note,
      stripeUrl: null,
    },
  }, { status: 201 });
}
