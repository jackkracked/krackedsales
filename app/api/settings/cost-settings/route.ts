import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { costSettings } from "@/lib/db/schema";

export async function GET() {
  const rows = await db().select().from(costSettings).limit(1);
  const settings = rows[0] ?? null;
  return NextResponse.json({ costPerEmail: settings?.costPerEmail ?? 0 });
}

export async function POST(req: NextRequest) {
  const { costPerEmail } = await req.json();

  const cost = parseFloat(costPerEmail);
  if (isNaN(cost) || cost < 0) {
    return NextResponse.json({ error: "Cost per email must be a positive number" }, { status: 400 });
  }

  // Upsert — delete existing row then insert fresh (simple single-row pattern)
  await db().delete(costSettings);
  const [row] = await db().insert(costSettings).values({ costPerEmail: cost }).returning();

  return NextResponse.json({ costPerEmail: row.costPerEmail });
}
