import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { kpiTargets } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type TargetDirection = "higher" | "lower";

// GET /api/kpis/targets — admin only.
// Returns every saved KPI target keyed by metricKey, so a card can look up its
// own target in O(1):  { targets: { [metricKey]: { target, direction } } }.
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await db()
      .select({
        metricKey: kpiTargets.metricKey,
        target: kpiTargets.target,
        direction: kpiTargets.direction,
      })
      .from(kpiTargets);

    const targets: Record<string, { target: number; direction: TargetDirection }> = {};
    for (const row of rows) {
      // Coerce the stored direction back into the strict union; default safely.
      const direction: TargetDirection = row.direction === "lower" ? "lower" : "higher";
      targets[row.metricKey] = { target: row.target, direction };
    }

    return NextResponse.json({ targets });
  } catch (err) {
    console.error("[GET /api/kpis/targets]", err);
    return NextResponse.json({ error: "Failed to load targets" }, { status: 500 });
  }
}

// POST /api/kpis/targets — admin only.
// Upserts one target (unique on metricKey). Whitelisted body — no mass-assignment.
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { metricKey, target, direction } = (body ?? {}) as {
      metricKey?: unknown;
      target?: unknown;
      direction?: unknown;
    };

    if (typeof metricKey !== "string" || metricKey.trim() === "") {
      return NextResponse.json({ error: "metricKey is required" }, { status: 400 });
    }
    if (typeof target !== "number" || !Number.isFinite(target)) {
      return NextResponse.json({ error: "target must be a finite number" }, { status: 400 });
    }
    if (direction !== "higher" && direction !== "lower") {
      return NextResponse.json(
        { error: "direction must be 'higher' or 'lower'" },
        { status: 400 },
      );
    }

    const key = metricKey.trim();

    await db()
      .insert(kpiTargets)
      .values({
        metricKey: key,
        target,
        direction,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: kpiTargets.metricKey,
        set: {
          target: sql`excluded.target`,
          direction: sql`excluded.direction`,
          updatedBy: sql`excluded.updated_by`,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/kpis/targets]", err);
    return NextResponse.json({ error: "Failed to save target" }, { status: 500 });
  }
}
