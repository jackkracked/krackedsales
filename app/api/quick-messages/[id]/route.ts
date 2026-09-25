import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { quickMessages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Update a quick message (title / body / active / sortOrder). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === "string") patch.title = body.title.trim() || null;
  if (typeof body.body === "string") {
    const text = body.body.trim();
    if (!text) return NextResponse.json({ error: "Message body cannot be empty" }, { status: 400 });
    patch.body = text;
  }
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) patch.sortOrder = body.sortOrder;

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  try {
    const [row] = await db().update(quickMessages).set(patch).where(eq(quickMessages.id, id)).returning();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ quickMessage: row });
  } catch (err) {
    console.error("[PATCH /api/quick-messages/[id]]", err);
    return NextResponse.json({ error: "Failed to update quick message" }, { status: 500 });
  }
}

/** Delete a quick message. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await db().delete(quickMessages).where(eq(quickMessages.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/quick-messages/[id]]", err);
    return NextResponse.json({ error: "Failed to delete quick message" }, { status: 500 });
  }
}
