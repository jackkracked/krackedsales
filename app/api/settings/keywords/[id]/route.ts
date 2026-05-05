import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { keywordTriggers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// ─── PATCH — toggle active status ────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.active !== "boolean") {
    return NextResponse.json(
      { error: "active (boolean) is required" },
      { status: 400 }
    );
  }

  try {
    const client = await db();
    const [updated] = await client
      .update(keywordTriggers)
      .set({ active: body.active })
      .where(eq(keywordTriggers.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
    }

    return NextResponse.json({ keyword: updated });
  } catch (err) {
    console.error(`[Settings /keywords/${id}] PATCH failed:`, err);
    return NextResponse.json(
      { error: "Failed to update keyword" },
      { status: 500 }
    );
  }
}

// ─── DELETE — remove a keyword trigger ───────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const client = await db();
    const deleted = await client
      .delete(keywordTriggers)
      .where(eq(keywordTriggers.id, id))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[Settings /keywords/${id}] DELETE failed:`, err);
    return NextResponse.json(
      { error: "Failed to delete keyword" },
      { status: 500 }
    );
  }
}
