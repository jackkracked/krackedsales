import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { quickMessages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Persist a new order: sets sortOrder = position in the provided id list. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "No order provided" }, { status: 400 });

  try {
    const now = new Date();
    // Small list — sequential updates are fine and keep it simple/correct.
    await Promise.all(
      ids.map((id, index) =>
        db().update(quickMessages).set({ sortOrder: index, updatedAt: now }).where(eq(quickMessages.id, id)),
      ),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/quick-messages/reorder]", err);
    return NextResponse.json({ error: "Failed to reorder" }, { status: 500 });
  }
}
