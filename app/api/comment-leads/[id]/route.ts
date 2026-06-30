import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialLeads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { name, email, phone, website, notes } = body as {
    name?: string;
    email?: string;
    phone?: string;
    website?: string;
    notes?: string;
  };

  try {
    const client = await db();
    const updated = await client
      .update(socialLeads)
      .set({
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(website !== undefined && { website }),
        ...(notes !== undefined && { notes }),
      })
      .where(eq(socialLeads.id, id))
      .returning();

    if (!updated.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ lead: updated[0] });
  } catch (err) {
    console.error("[PATCH /api/comment-leads/[id]]", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
