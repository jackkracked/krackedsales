import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { kpiTargets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// DELETE /api/kpis/targets/[metricKey] — admin only.
// Removes the target for one metric (the card stops showing an over/under badge).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ metricKey: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { metricKey } = await params;
    const key = decodeURIComponent(metricKey);

    const [deleted] = await db()
      .delete(kpiTargets)
      .where(eq(kpiTargets.metricKey, key))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Target not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/kpis/targets/[metricKey]]", err);
    return NextResponse.json({ error: "Failed to delete target" }, { status: 500 });
  }
}
