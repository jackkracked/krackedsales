import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { replyTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const { templateId } = await params;
  try {
    const body = await req.json();
    const [template] = await db()
      .update(replyTemplates)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(replyTemplates.id, templateId))
      .returning();
    return NextResponse.json({ template });
  } catch (err) {
    console.error("[PATCH /api/templates/:id]", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const { templateId } = await params;
  try {
    await db().delete(replyTemplates).where(eq(replyTemplates.id, templateId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/templates/:id]", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
