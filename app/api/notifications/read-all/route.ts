import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { eq, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** POST /api/notifications/read-all — mark every unread notification as read */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await db()
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.userId, user.id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/notifications/read-all]", err);
    return NextResponse.json({ error: "Failed to mark all read" }, { status: 500 });
  }
}
