import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { syncFathomForUser } from "@/lib/fathom/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/fathom/sync
 *
 * Syncs the current user's Fathom meetings on demand.
 * Called by the client on page load with a 2-minute cooldown
 * to keep transcripts near-real-time without a paid cron.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [row] = await db()
    .select({ fathomApiKey: users.fathomApiKey })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!row?.fathomApiKey) {
    return NextResponse.json({ synced: 0 });
  }

  try {
    const synced = await syncFathomForUser(user.id, row.fathomApiKey);
    return NextResponse.json({ synced });
  } catch (err) {
    console.error("[fathom/sync] Sync failed for user:", user.id, err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
