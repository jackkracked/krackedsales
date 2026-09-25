import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { quickMessages } from "@/lib/db/schema";
import { asc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** List all quick messages, ordered for display (sortOrder, then oldest first). */
export async function GET() {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await db()
      .select()
      .from(quickMessages)
      .orderBy(asc(quickMessages.sortOrder), asc(quickMessages.createdAt));
    return NextResponse.json({ quickMessages: rows });
  } catch (err) {
    console.error("[GET /api/quick-messages]", err);
    return NextResponse.json({ error: "Failed to load quick messages" }, { status: 500 });
  }
}

/** Create a quick message. New rows go to the end of the list. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { title?: unknown; body?: unknown };
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!text) return NextResponse.json({ error: "Message body is required" }, { status: 400 });

  try {
    // Place new items last so the curated "top 5 in chat" order is preserved.
    const [{ max }] = await db()
      .select({ max: sql<number>`coalesce(max(${quickMessages.sortOrder}), -1)` })
      .from(quickMessages);
    const [row] = await db()
      .insert(quickMessages)
      .values({
        title: title || null,
        body: text,
        sortOrder: (max ?? -1) + 1,
        createdBy: user.id ?? null,
      })
      .returning();
    return NextResponse.json({ quickMessage: row });
  } catch (err) {
    console.error("[POST /api/quick-messages]", err);
    return NextResponse.json({ error: "Failed to create quick message" }, { status: 500 });
  }
}
