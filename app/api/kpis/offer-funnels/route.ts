import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { offerFunnels } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** GET /api/kpis/offer-funnels — list all offer funnels ordered by createdAt */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await db()
    .select()
    .from(offerFunnels)
    .orderBy(asc(offerFunnels.createdAt));

  return NextResponse.json({ funnels: items });
}

/** POST /api/kpis/offer-funnels — create a new offer funnel */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    name?: string;
    pipelineIds?: string[];
    campaignFilter?: string;
    adPlatform?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, pipelineIds, campaignFilter, adPlatform } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const [created] = await db()
    .insert(offerFunnels)
    .values({
      name: name.trim(),
      pipelineIds: pipelineIds ?? [],
      campaignFilter: campaignFilter ?? null,
      adPlatform: adPlatform ?? "meta",
    })
    .returning();

  return NextResponse.json({ item: created }, { status: 201 });
}
