import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/me/timezone
 * Update the current user's timezone.
 * Body: { timezone: "America/Los_Angeles" }
 */
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { timezone } = body;

  if (!timezone || typeof timezone !== "string") {
    return NextResponse.json({ error: "timezone is required" }, { status: 400 });
  }

  // Validate it's a real IANA timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }

  await db()
    .update(users)
    .set({ timezone })
    .where(eq(users.id, user.id));

  return NextResponse.json({ ok: true, timezone });
}
