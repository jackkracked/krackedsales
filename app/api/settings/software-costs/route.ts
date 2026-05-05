import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { softwareCosts } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export async function GET() {
  const items = await db()
    .select()
    .from(softwareCosts)
    .orderBy(asc(softwareCosts.createdAt));

  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const { name, monthlyCost } = await req.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const cost = parseFloat(monthlyCost);
  if (isNaN(cost) || cost < 0) {
    return NextResponse.json({ error: "Monthly cost must be a positive number" }, { status: 400 });
  }

  const [created] = await db()
    .insert(softwareCosts)
    .values({ name: name.trim(), monthlyCost: cost })
    .returning();

  return NextResponse.json({ item: created }, { status: 201 });
}
