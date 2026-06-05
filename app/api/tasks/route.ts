import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq, asc, desc, and, SQL } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser().catch(() => null);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = req.nextUrl;
    const view = searchParams.get("view") ?? "my";
    const status = searchParams.get("status") ?? "open";
    const priority = searchParams.get("priority") ?? "all";
    const sort = searchParams.get("sort") ?? "dueDate";

    // Build filter conditions
    const conditions: SQL[] = [];

    // View: "my" filters to current user, "team" returns all (admin only)
    if (view === "team" && user.role === "admin") {
      // no user filter — show all
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conditions.push(eq(tasks.userId, user.id as any));
    }

    // Status filter
    if (status === "open") {
      conditions.push(eq(tasks.completed, false));
    } else if (status === "completed") {
      conditions.push(eq(tasks.completed, true));
    }
    // "all" — no status filter

    // Priority filter
    if (priority !== "all") {
      conditions.push(eq(tasks.priority, priority));
    }

    // Sort
    const orderBy =
      sort === "priority" ? asc(tasks.priority) :
      sort === "createdAt" ? desc(tasks.createdAt) :
      asc(tasks.dueDate); // default

    const rows = await db()
      .select()
      .from(tasks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orderBy);

    return NextResponse.json({ tasks: rows });
  } catch (err) {
    console.error("[GET /api/tasks]", err);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sessionUser = await getSessionUser().catch(() => null);
    const body = await req.json();
    const {
      title,
      notes,
      dueDate,
      contactId,
      contactName,
      opportunityId,
      opportunityName,
      priority,
    } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const [task] = await db()
      .insert(tasks)
      .values({
        title: title.trim(),
        notes: notes?.trim() || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        contactId: contactId || null,
        contactName: contactName || null,
        opportunityId: opportunityId || null,
        opportunityName: opportunityName || null,
        priority: (priority as string) || "medium",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userId: (sessionUser?.id as any) ?? null,
        userName: sessionUser?.name ?? null,
      })
      .returning();

    logActivity({
      userId: sessionUser?.id ?? "unknown",
      userName: sessionUser?.name ?? "Unknown",
      userEmail: sessionUser?.email ?? "unknown@unknown.com",
      action: "task.created",
      entityType: "task",
      entityId: task.id,
      entityName: task.title,
      metadata: {
        contact_name: task.contactName,
        opportunity_id: task.opportunityId,
        priority: task.priority,
      },
    });

    return NextResponse.json({ task });
  } catch (err) {
    console.error("[POST /api/tasks]", err);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
