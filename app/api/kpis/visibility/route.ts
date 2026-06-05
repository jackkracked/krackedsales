import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { kpiVisibility } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { asc, and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** GET /api/kpis/visibility — list all visibility settings */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await db()
    .select()
    .from(kpiVisibility)
    .orderBy(asc(kpiVisibility.section), asc(kpiVisibility.position));

  return NextResponse.json({ items });
}

/** POST /api/kpis/visibility — bulk upsert visibility settings */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    items?: Array<{
      section: string;
      metricKey: string;
      visible: boolean;
      position: number;
    }>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  const now = new Date();
  const results = [];

  for (const item of body.items) {
    if (!item.section || !item.metricKey) continue;

    // Check for existing row by section + metricKey
    const [existing] = await db()
      .select()
      .from(kpiVisibility)
      .where(
        and(
          eq(kpiVisibility.section, item.section),
          eq(kpiVisibility.metricKey, item.metricKey)
        )
      )
      .limit(1);

    if (existing) {
      const [updated] = await db()
        .update(kpiVisibility)
        .set({
          visible: item.visible,
          position: item.position,
          updatedAt: now,
        })
        .where(eq(kpiVisibility.id, existing.id))
        .returning();
      results.push(updated);
    } else {
      const [created] = await db()
        .insert(kpiVisibility)
        .values({
          section: item.section,
          metricKey: item.metricKey,
          visible: item.visible,
          position: item.position,
          updatedAt: now,
        })
        .returning();
      results.push(created);
    }
  }

  return NextResponse.json({ items: results });
}
