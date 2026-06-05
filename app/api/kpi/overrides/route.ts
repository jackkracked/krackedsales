import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { kpiOverrides } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period");
  if (!period) return NextResponse.json({ overrides: [] });

  const client = db();
  const rows = await client
    .select({ metricKey: kpiOverrides.metricKey, value: kpiOverrides.value })
    .from(kpiOverrides)
    .where(eq(kpiOverrides.period, period));

  return NextResponse.json({ overrides: rows });
}

export async function POST(req: NextRequest) {
  const { metricKey, period, value, note } = await req.json() as {
    metricKey: string;
    period: string;
    value: number;
    note?: string | null;
  };

  const client = db();
  const existing = await client
    .select({ id: kpiOverrides.id })
    .from(kpiOverrides)
    .where(and(eq(kpiOverrides.metricKey, metricKey), eq(kpiOverrides.period, period)));

  if (existing.length > 0) {
    await client
      .update(kpiOverrides)
      .set({ value, note: note ?? null, updatedAt: new Date() })
      .where(and(eq(kpiOverrides.metricKey, metricKey), eq(kpiOverrides.period, period)));
  } else {
    await client.insert(kpiOverrides).values({ metricKey, period, value, note: note ?? null });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { metricKey, period } = await req.json() as {
    metricKey: string;
    period: string;
  };

  const client = db();
  await client
    .delete(kpiOverrides)
    .where(and(eq(kpiOverrides.metricKey, metricKey), eq(kpiOverrides.period, period)));

  return NextResponse.json({ ok: true });
}
