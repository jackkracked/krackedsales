import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activityEvents } from "@/lib/db/schema";
import { eq, and, lt, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");
  const userId = searchParams.get("userId");
  const action = searchParams.get("action");
  const cursor = searchParams.get("cursor"); // ISO timestamp — fetch events older than this
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);

  // Build filters
  const filters = [];
  if (entityType && entityId) {
    filters.push(eq(activityEvents.entityType, entityType));
    filters.push(eq(activityEvents.entityId, entityId));
  }
  if (userId) filters.push(eq(activityEvents.userId, userId));
  if (action) filters.push(eq(activityEvents.action, action));
  if (cursor) filters.push(lt(activityEvents.createdAt, new Date(cursor)));

  try {
    const client = db();

    const rows = await client
      .select()
      .from(activityEvents)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(activityEvents.createdAt))
      .limit(limit + 1); // fetch one extra to determine if there's a next page

    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? events[events.length - 1].createdAt.toISOString() : null;

    return NextResponse.json({ events, nextCursor });
  } catch (err) {
    console.error("[GET /api/activity]", err);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}
