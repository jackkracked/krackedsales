import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activityEvents, callDispositions } from "@/lib/db/schema";
import { eq, and, lt, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

/** Prettify a rep email into a display name: "jane.doe@x.com" → "Jane Doe". */
function nameFromEmail(email: string | null): string {
  if (!email) return "A rep";
  const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return local.replace(/\b\w/g, (c) => c.toUpperCase()) || "A rep";
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");
  const userId = searchParams.get("userId");
  const action = searchParams.get("action");
  const contactId = searchParams.get("contactId"); // merge this contact's call outcomes
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

    let merged: typeof rows = rows;

    // Merge the contact's call outcomes (logged against the call event, not the
    // opportunity, so they'd otherwise never surface here) as synthesized events
    // the ActivityRow already knows how to render via action "call.dispositioned".
    if (contactId) {
      const dispRows = await client
        .select({
          id: callDispositions.id,
          contactId: callDispositions.contactId,
          contactName: callDispositions.contactName,
          repEmail: callDispositions.repEmail,
          outcome: callDispositions.outcome,
          notes: callDispositions.notes,
          dispositionedAt: callDispositions.dispositionedAt,
        })
        .from(callDispositions)
        .where(eq(callDispositions.contactId, contactId));

      const synthesized = dispRows
        .filter((d) => (cursor ? d.dispositionedAt < new Date(cursor) : true))
        .map((d) => ({
          id: `calldisp_${d.id}`,
          userId: "",
          userName: nameFromEmail(d.repEmail),
          userEmail: d.repEmail ?? "",
          action: "call.dispositioned",
          entityType: entityType ?? "contact",
          entityId: entityId ?? d.contactId ?? "",
          entityName: d.contactName,
          metadata: { outcome: d.outcome, has_notes: !!d.notes },
          createdAt: d.dispositionedAt,
        })) as unknown as typeof rows;

      merged = [...rows, ...synthesized].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    const hasMore = merged.length > limit;
    const events = hasMore ? merged.slice(0, limit) : merged;
    const nextCursor = hasMore ? events[events.length - 1].createdAt.toISOString() : null;

    return NextResponse.json({ events, nextCursor });
  } catch (err) {
    console.error("[GET /api/activity]", err);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}
