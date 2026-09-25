import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customers, customerPayments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { reconcileCustomerAggregates } from "@/lib/customers/reconcile";

export const dynamic = "force-dynamic";

const METHODS = new Set(["wire", "bill_com", "check", "ach", "cash", "other"]);

/** Load a payment and confirm it is a MANUAL row belonging to this customer. Stripe rows are read-only. */
async function loadManualPayment(customerId: string, paymentId: string) {
  const [customer] = await db().select({ dedupeKey: customers.dedupeKey }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return { error: NextResponse.json({ error: "Customer not found" }, { status: 404 }) };
  const [payment] = await db().select().from(customerPayments).where(eq(customerPayments.id, paymentId)).limit(1);
  if (!payment || payment.dedupeKey !== customer.dedupeKey) return { error: NextResponse.json({ error: "Payment not found" }, { status: 404 }) };
  if (payment.source !== "manual") return { error: NextResponse.json({ error: "Only manually-added payments can be changed" }, { status: 403 }) };
  return { payment };
}

/** Edit a manual payment. Admin-only. Stripe payments cannot be edited. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const user = await getSessionUser().catch(() => null);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, paymentId } = await params;
  const loaded = await loadManualPayment(id, paymentId);
  if (loaded.error) return loaded.error;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const set: Partial<typeof customerPayments.$inferInsert> = {};

  if (body.amount != null) {
    const amount = Number(body.amount);
    if (!isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Enter an amount greater than 0" }, { status: 400 });
    set.amountNet = Math.round(amount * 100);
  }
  if (body.paidAt != null) {
    const paidAt = new Date(String(body.paidAt));
    if (isNaN(paidAt.getTime())) return NextResponse.json({ error: "Enter a valid payment date" }, { status: 400 });
    if (paidAt.getTime() > Date.now() + 86_400_000) return NextResponse.json({ error: "Payment date can't be in the future" }, { status: 400 });
    set.paidAt = paidAt;
  }
  if (typeof body.method === "string") set.method = METHODS.has(body.method) ? body.method : "other";
  if (body.note !== undefined) set.note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null;

  if (Object.keys(set).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const [updated] = await db().update(customerPayments).set(set).where(eq(customerPayments.id, paymentId)).returning();
  await reconcileCustomerAggregates(updated.dedupeKey);
  return NextResponse.json({
    payment: {
      id: updated.id,
      at: updated.paidAt.toISOString(),
      amount: updated.amountNet,
      currency: updated.currency ?? "usd",
      source: "manual",
      manual: true,
      method: updated.method,
      note: updated.note,
      stripeUrl: null,
    },
  });
}

/** Delete a manual payment. Admin-only. Stripe payments cannot be deleted. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const user = await getSessionUser().catch(() => null);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, paymentId } = await params;
  const loaded = await loadManualPayment(id, paymentId);
  if (loaded.error) return loaded.error;

  await db().delete(customerPayments).where(eq(customerPayments.id, paymentId));
  await reconcileCustomerAggregates(loaded.payment.dedupeKey);
  return NextResponse.json({ ok: true });
}
