import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { kpiTargets } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { resolveCadence, type Cadence, type CadenceTargets } from "@/lib/kpi/pacing";

export const dynamic = "force-dynamic";

type TargetDirection = "higher" | "lower";

/** What a card needs to render a pace-adjusted badge for any window. */
interface TargetRecord {
  /** Legacy single value = the monthly target, kept so any un-migrated reader still works. */
  target: number;
  direction: TargetDirection;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  anchor: Cadence;
}

function coerceCadence(v: unknown): Cadence {
  return v === "daily" || v === "weekly" ? v : "monthly";
}

// GET /api/kpis/targets — admin only.
// Returns every saved target keyed by metricKey:
//   { targets: { [metricKey]: { target, direction, daily, weekly, monthly, anchor } } }
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
        daily: kpiTargets.targetDaily,
        weekly: kpiTargets.targetWeekly,
        monthly: kpiTargets.targetMonthly,
        anchor: kpiTargets.anchorCadence,
      })
      .from(kpiTargets);

    const targets: Record<string, TargetRecord> = {};
    for (const row of rows) {
      const direction: TargetDirection = row.direction === "lower" ? "lower" : "higher";
      // Monthly falls back to the legacy single value for rows saved before cadences existed.
      const monthly = row.monthly ?? row.target;
      targets[row.metricKey] = {
        target: monthly,
        direction,
        daily: row.daily,
        weekly: row.weekly,
        monthly,
        anchor: coerceCadence(row.anchor),
      };
    }

    return NextResponse.json({ targets });
  } catch (err) {
    console.error("[GET /api/kpis/targets]", err);
    return NextResponse.json({ error: "Failed to load targets" }, { status: 500 });
  }
}

/** A cadence input: a finite number, or null (clears that slot). Rejects anything else. */
function parseCadenceValue(v: unknown): number | null | "invalid" {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return "invalid";
}

// POST /api/kpis/targets — admin only.
// Upserts one target (unique on metricKey). Whitelisted body — no mass-assignment.
// Accepts the cadence shape { metricKey, direction, anchor, daily, weekly, monthly } and
// also tolerates the legacy { metricKey, target, direction } (treated as a monthly anchor).
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

    const b = (body ?? {}) as Record<string, unknown>;

    if (typeof b.metricKey !== "string" || b.metricKey.trim() === "") {
      return NextResponse.json({ error: "metricKey is required" }, { status: 400 });
    }
    if (b.direction !== "higher" && b.direction !== "lower") {
      return NextResponse.json({ error: "direction must be 'higher' or 'lower'" }, { status: 400 });
    }

    // Parse each cadence; legacy `target` seeds monthly when no monthly is supplied.
    const daily = parseCadenceValue(b.daily);
    const weekly = parseCadenceValue(b.weekly);
    let monthly = parseCadenceValue(b.monthly);
    if (daily === "invalid" || weekly === "invalid" || monthly === "invalid") {
      return NextResponse.json({ error: "cadence targets must be numbers or null" }, { status: 400 });
    }
    if (monthly === null) {
      const legacy = parseCadenceValue(b.target);
      if (legacy !== "invalid" && legacy !== null) monthly = legacy;
    }

    const anchor = coerceCadence(b.anchor);
    const cadences: CadenceTargets = { daily, weekly, monthly };

    // At least one cadence must be set, and it must be a positive goal.
    const monthlyResolved = resolveCadence(cadences, "monthly");
    if (monthlyResolved == null) {
      return NextResponse.json({ error: "Set at least one cadence target" }, { status: 400 });
    }
    if (!(monthlyResolved > 0)) {
      return NextResponse.json({ error: "Target must be greater than 0" }, { status: 400 });
    }

    const key = b.metricKey.trim().slice(0, 200);

    await db()
      .insert(kpiTargets)
      .values({
        metricKey: key,
        target: monthlyResolved, // legacy column = monthly, keeps old readers honest
        direction: b.direction,
        targetDaily: daily,
        targetWeekly: weekly,
        targetMonthly: monthly,
        anchorCadence: anchor,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: kpiTargets.metricKey,
        set: {
          target: sql`excluded.target`,
          direction: sql`excluded.direction`,
          targetDaily: sql`excluded.target_daily`,
          targetWeekly: sql`excluded.target_weekly`,
          targetMonthly: sql`excluded.target_monthly`,
          anchorCadence: sql`excluded.anchor_cadence`,
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
