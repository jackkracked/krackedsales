import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { demoTargets } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const DEFAULTS = {
  copyDays:        2,
  designDays:      5,
  copyRevDays:     2,
  designRevDays:   2,
  internalQaDays:  1,
  fulfillmentDays: 7,
};

export async function GET() {
  const rows = await db().select().from(demoTargets).limit(1).catch(() => []);
  const row = rows[0];

  return NextResponse.json({
    targets: {
      copyDays:        row?.copyDays        ?? DEFAULTS.copyDays,
      designDays:      row?.designDays      ?? DEFAULTS.designDays,
      copyRevDays:     row?.copyRevDays     ?? DEFAULTS.copyRevDays,
      designRevDays:   row?.designRevDays   ?? DEFAULTS.designRevDays,
      internalQaDays:  row?.internalQaDays  ?? DEFAULTS.internalQaDays,
      fulfillmentDays: row?.fulfillmentDays ?? DEFAULTS.fulfillmentDays,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<typeof DEFAULTS>;

  const values = {
    copyDays:        body.copyDays        ?? DEFAULTS.copyDays,
    designDays:      body.designDays      ?? DEFAULTS.designDays,
    copyRevDays:     body.copyRevDays     ?? DEFAULTS.copyRevDays,
    designRevDays:   body.designRevDays   ?? DEFAULTS.designRevDays,
    internalQaDays:  body.internalQaDays  ?? DEFAULTS.internalQaDays,
    fulfillmentDays: body.fulfillmentDays ?? DEFAULTS.fulfillmentDays,
    updatedAt:       new Date(),
  };

  // Upsert the single settings row
  const rows = await db().select().from(demoTargets).limit(1).catch(() => []);
  const existing = rows[0];

  if (existing) {
    await db()
      .update(demoTargets)
      .set(values)
      .where(eq(demoTargets.id, existing.id));
  } else {
    await db().insert(demoTargets).values(values);
  }

  return NextResponse.json({ targets: values });
}
