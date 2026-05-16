import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboardKpiPrefs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { getDefaults } from "@/lib/dashboard-kpis";

export const dynamic = "force-dynamic";

/** GET /api/dashboard/kpi-prefs — returns the current user's selected KPI keys */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db()
    .select({ selectedKeys: dashboardKpiPrefs.selectedKeys })
    .from(dashboardKpiPrefs)
    .where(eq(dashboardKpiPrefs.userId, user.id))
    .limit(1);

  const keys =
    rows[0]?.selectedKeys?.length ? rows[0].selectedKeys : getDefaults(user.role as "admin" | "rep");

  return NextResponse.json({ keys });
}

/** PUT /api/dashboard/kpi-prefs — saves the current user's selected KPI keys */
export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const keys: string[] = body.keys ?? [];

  await db()
    .insert(dashboardKpiPrefs)
    .values({ userId: user.id, selectedKeys: keys })
    .onConflictDoUpdate({
      target: dashboardKpiPrefs.userId,
      set: { selectedKeys: keys, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true });
}
