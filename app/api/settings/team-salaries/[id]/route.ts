import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamSalaries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getSessionUser().catch(() => null);
  return user?.role === "admin";
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({} as { role?: unknown; monthlyAmount?: unknown; active?: unknown }));
  const set: { role?: string; monthlyAmount?: number; active?: boolean } = {};
  if (typeof body.role === "string" && body.role.trim()) set.role = body.role.trim().slice(0, 60);
  if (body.monthlyAmount != null) {
    const amount = parseFloat(String(body.monthlyAmount));
    if (isNaN(amount) || amount < 0) return NextResponse.json({ error: "Monthly amount must be a positive number" }, { status: 400 });
    set.monthlyAmount = amount;
  }
  if (typeof body.active === "boolean") set.active = body.active;
  if (Object.keys(set).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  const [updated] = await db().update(teamSalaries).set(set).where(eq(teamSalaries.id, id)).returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  await db().delete(teamSalaries).where(eq(teamSalaries.id, id));
  return NextResponse.json({ ok: true });
}
