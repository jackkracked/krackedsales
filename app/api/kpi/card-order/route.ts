import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { kpiCardOrder } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const client = db();
  const rows = await client
    .select({
      section:  kpiCardOrder.section,
      cardKey:  kpiCardOrder.cardKey,
      position: kpiCardOrder.position,
    })
    .from(kpiCardOrder)
    .orderBy(kpiCardOrder.section, kpiCardOrder.position);

  return NextResponse.json({ order: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    order: Array<{ section: string; cardKey: string; position: number }>;
  };

  const client = db();

  // Delete existing rows for affected sections, then re-insert
  const sections = [...new Set(body.order.map((o) => o.section))];
  for (const section of sections) {
    await client.delete(kpiCardOrder).where(eq(kpiCardOrder.section, section));
  }

  if (body.order.length > 0) {
    await client.insert(kpiCardOrder).values(
      body.order.map((o) => ({
        section:  o.section,
        cardKey:  o.cardKey,
        position: o.position,
      }))
    );
  }

  return NextResponse.json({ ok: true });
}
