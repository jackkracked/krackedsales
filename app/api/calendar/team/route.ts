import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PALETTE = [
  "#6366f1",
  "#06b6d4",
  "#f59e0b",
  "#ef4444",
  "#10b981",
  "#8b5cf6",
];

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await db()
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        ghlUserId: users.ghlUserId,
      })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(asc(users.name));

    const members = rows.map((r, i) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      ghlUserId: r.ghlUserId,
      color: PALETTE[i % PALETTE.length],
    }));

    return NextResponse.json({ members });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[calendar/team] GET failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
