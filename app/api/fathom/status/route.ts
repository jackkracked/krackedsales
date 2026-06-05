import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/fathom/status
 *
 * Returns whether the current user has a Fathom API key connected.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [row] = await db()
    .select({ fathomApiKey: users.fathomApiKey })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const connected = !!row?.fathomApiKey;

  return NextResponse.json({ connected });
}
