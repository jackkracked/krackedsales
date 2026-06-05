import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { validateKey } from "@/lib/fathom/client";
import { backfillFathom } from "@/lib/fathom/sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/fathom/connect
 *
 * Connect a Fathom API key to the current user's account.
 * Validates the key, saves it, and triggers a 30-day backfill.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const apiKey = body?.apiKey;

  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json(
      { error: "apiKey is required" },
      { status: 400 },
    );
  }

  const valid = await validateKey(apiKey);
  if (!valid) {
    return NextResponse.json(
      { error: "Invalid Fathom API key" },
      { status: 400 },
    );
  }

  await db()
    .update(users)
    .set({ fathomApiKey: apiKey })
    .where(eq(users.id, user.id));

  // Backfill 30 days of Fathom meetings in the background
  waitUntil(
    backfillFathom(user.id, apiKey).catch((err) => {
      console.error("[fathom/connect] Backfill failed:", err);
    }),
  );

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/fathom/connect
 *
 * Disconnect Fathom by clearing the user's API key.
 */
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await db()
    .update(users)
    .set({ fathomApiKey: null })
    .where(eq(users.id, user.id));

  return NextResponse.json({ success: true });
}
