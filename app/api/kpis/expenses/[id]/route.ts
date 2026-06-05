import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { manualExpenses } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** PATCH /api/kpis/expenses/[id] — update an expense */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: {
    name?: string;
    amount?: number;
    month?: string;
    category?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof manualExpenses.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.amount !== undefined) {
    const parsedAmount = parseFloat(String(body.amount));
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }
    updates.amount = parsedAmount;
  }
  if (body.month !== undefined) updates.month = body.month;
  if (body.category !== undefined) updates.category = body.category;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
  }

  try {
    const [updated] = await db()
      .update(manualExpenses)
      .set(updates)
      .where(eq(manualExpenses.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    return NextResponse.json({ item: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[kpis/expenses/[id]] PATCH failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/kpis/expenses/[id] — remove an expense */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [deleted] = await db()
      .delete(manualExpenses)
      .where(eq(manualExpenses.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[kpis/expenses/[id]] DELETE failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
