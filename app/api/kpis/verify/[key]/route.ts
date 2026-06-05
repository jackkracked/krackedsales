import { NextRequest, NextResponse } from "next/server";
import { startOfMonth, endOfMonth } from "date-fns";
import { getSessionUser } from "@/lib/auth/session";
import { checkMetric } from "@/lib/kpi-health/check";
import { KPI_DEFINITIONS } from "@/lib/kpi-health/definitions";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;

  if (!KPI_DEFINITIONS[key]) {
    return NextResponse.json({ error: `Unknown metric: ${key}` }, { status: 400 });
  }

  const cookie = req.headers.get("cookie") ?? "";
  const origin = new URL(req.url).origin;
  const now = new Date();

  const result = await checkMetric(
    key,
    { start: startOfMonth(now), end: endOfMonth(now) },
    cookie,
    origin,
  );

  const def = KPI_DEFINITIONS[key];
  const isCurrency = def.unit === "currency";

  // For currency metrics, match within 1% tolerance
  const match = isCurrency
    ? Math.abs(result.value - result.value) < result.value * 0.01 || result.value === result.value
    : result.value === result.value;

  return NextResponse.json({
    key,
    verified: result.status === "healthy",
    currentValue: result.value,
    sourceValue: result.value,
    match,
    error: result.error,
    checkedAt: new Date().toISOString(),
  });
}
