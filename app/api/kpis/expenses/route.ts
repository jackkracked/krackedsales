import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { manualExpenses } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { eq, asc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** GET /api/kpis/expenses?month=YYYY-MM — list expenses for a month with total */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Query param 'month' is required (format: YYYY-MM)" },
      { status: 400 }
    );
  }

  const items = await db()
    .select()
    .from(manualExpenses)
    .where(eq(manualExpenses.month, month))
    .orderBy(asc(manualExpenses.createdAt));

  const [{ total }] = await db()
    .select({ total: sql<number>`coalesce(sum(${manualExpenses.amount}), 0)` })
    .from(manualExpenses)
    .where(eq(manualExpenses.month, month));

  return NextResponse.json({ items, total: Number(total) });
}

/** POST /api/kpis/expenses — create a manual expense */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const { name, amount, month, category } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const parsedAmount = parseFloat(String(amount));
  if (isNaN(parsedAmount) || parsedAmount < 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Month is required (format: YYYY-MM)" }, { status: 400 });
  }

  const [created] = await db()
    .insert(manualExpenses)
    .values({
      name: name.trim(),
      amount: parsedAmount,
      month,
      category: category ?? null,
    })
    .returning();

  return NextResponse.json({ item: created }, { status: 201 });
}
