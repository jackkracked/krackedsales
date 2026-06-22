import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, projectStatuses } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/status
 * Paid project proposals + their active/complete state. A paid project is ACTIVE
 * by default (no status row); it's only complete once someone marks it here.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db()
    .select({
      id: proposals.id,
      contactName: proposals.contactName,
      amount: proposals.totalAmount,
      paidAt: proposals.paidAt,
      status: projectStatuses.status,
    })
    .from(proposals)
    .leftJoin(projectStatuses, eq(projectStatuses.proposalId, proposals.id))
    .where(and(eq(proposals.type, "project"), eq(proposals.status, "paid")));

  const projects = rows
    .map((r) => ({
      proposalId: r.id,
      clientName: r.contactName,
      amount: r.amount,
      status: (r.status ?? "active") as "active" | "complete",
      paidAt: r.paidAt,
    }))
    // Active first, then by amount.
    .sort((a, b) => {
      const ac = a.status === "complete" ? 1 : 0;
      const bc = b.status === "complete" ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return b.amount - a.amount;
    });

  return NextResponse.json({
    projects,
    activeCount: projects.filter((p) => p.status !== "complete").length,
  });
}

/**
 * POST /api/projects/status  { proposalId, status: "active" | "complete" }
 * Mark a paid project active or complete (admin). Completed projects drop out of
 * the # Active Projects count.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { proposalId?: unknown; status?: unknown } | null;
  const proposalId = typeof body?.proposalId === "string" ? body.proposalId : null;
  const status = body?.status === "complete" ? "complete" : body?.status === "active" ? "active" : null;
  if (!proposalId || !status) {
    return NextResponse.json({ error: "proposalId and status (active|complete) required" }, { status: 400 });
  }

  const now = new Date();
  await db()
    .insert(projectStatuses)
    .values({
      proposalId,
      status,
      completedAt: status === "complete" ? now : null,
      updatedBy: user.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projectStatuses.proposalId,
      set: { status, completedAt: status === "complete" ? now : null, updatedBy: user.id, updatedAt: now },
    });

  return NextResponse.json({ ok: true });
}
