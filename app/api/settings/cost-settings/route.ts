import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { costSettings } from "@/lib/db/schema";

export async function GET() {
  const rows = await db().select().from(costSettings).limit(1);
  const settings = rows[0] ?? null;
  return NextResponse.json({
    costPerEmail: settings?.costPerEmail ?? 0,
    costPerAudit: settings?.costPerAudit ?? 0,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const costPerEmail = parseFloat(body.costPerEmail ?? 0);
  const costPerAudit = parseFloat(body.costPerAudit ?? 0);

  if (isNaN(costPerEmail) || costPerEmail < 0) {
    return NextResponse.json({ error: "Cost per email must be a positive number" }, { status: 400 });
  }
  if (isNaN(costPerAudit) || costPerAudit < 0) {
    return NextResponse.json({ error: "Cost per audit must be a positive number" }, { status: 400 });
  }

  await db().delete(costSettings);
  const [row] = await db().insert(costSettings).values({ costPerEmail, costPerAudit }).returning();

  return NextResponse.json({
    costPerEmail: row.costPerEmail,
    costPerAudit: row.costPerAudit,
  });
}
