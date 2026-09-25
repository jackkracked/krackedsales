import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamSalaries } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getSessionUser().catch(() => null);
  return user?.role === "admin";
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const items = await db().select().from(teamSalaries).orderBy(asc(teamSalaries.createdAt));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { role, monthlyAmount } = await req.json();
  if (!role?.trim()) return NextResponse.json({ error: "Role is required" }, { status: 400 });
  const amount = parseFloat(monthlyAmount);
  if (isNaN(amount) || amount < 0) return NextResponse.json({ error: "Monthly amount must be a positive number" }, { status: 400 });
  const [created] = await db().insert(teamSalaries).values({ role: role.trim().slice(0, 60), monthlyAmount: amount }).returning();
  return NextResponse.json({ item: created }, { status: 201 });
}
