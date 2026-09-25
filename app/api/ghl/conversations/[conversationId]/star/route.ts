import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { conversationFlags } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Toggle/set a conversation's starred flag (drives the inbox "Starred" filter). Writes to
 *  conversation_flags (never the GHL mirror, which the sync would clobber) and upserts, so it
 *  works even for a conversation not yet mirrored locally. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;
  const body = (await req.json().catch(() => ({}))) as { starred?: boolean };

  try {
    // Explicit value if provided, else flip the current one.
    let next = body.starred;
    if (typeof next !== "boolean") {
      const [row] = await db()
        .select({ starred: conversationFlags.starred })
        .from(conversationFlags)
        .where(eq(conversationFlags.conversationId, conversationId))
        .limit(1);
      next = !row?.starred;
    }
    await db()
      .insert(conversationFlags)
      .values({ conversationId, starred: next, updatedAt: new Date(), updatedBy: user.id ?? null })
      .onConflictDoUpdate({
        target: conversationFlags.conversationId,
        set: { starred: sql`excluded.starred`, updatedAt: new Date(), updatedBy: user.id ?? null },
      });
    return NextResponse.json({ ok: true, starred: next });
  } catch (err) {
    console.error("[POST /api/ghl/conversations/[id]/star]", err);
    return NextResponse.json({ error: "Failed to update star" }, { status: 500 });
  }
}
