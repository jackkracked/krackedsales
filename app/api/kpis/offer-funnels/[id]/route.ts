import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { offerFunnels } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** PATCH /api/kpis/offer-funnels/[id] — update funnel fields */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

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

  const updates: Partial<typeof offerFunnels.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.pipelineIds !== undefined) updates.pipelineIds = body.pipelineIds;
  if (body.campaignFilter !== undefined) updates.campaignFilter = body.campaignFilter;
  if (body.adPlatform !== undefined) updates.adPlatform = body.adPlatform;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
  }

  updates.updatedAt = new Date();

  try {
    const [updated] = await db()
      .update(offerFunnels)
      .set(updates)
      .where(eq(offerFunnels.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Offer funnel not found" }, { status: 404 });
    }

    return NextResponse.json({ item: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[kpis/offer-funnels/[id]] PATCH failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/kpis/offer-funnels/[id] — remove a funnel */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [deleted] = await db()
      .delete(offerFunnels)
      .where(eq(offerFunnels.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Offer funnel not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[kpis/offer-funnels/[id]] DELETE failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
