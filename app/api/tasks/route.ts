import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq, asc, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser().catch(() => null);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db()
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.completed, false),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          eq(tasks.userId, user.id as any)
        )
      )
      .orderBy(asc(tasks.dueDate));

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
