import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ taskId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { taskId } = await params;
  try {
    const [task] = await db().select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ task });
  } catch (err) {
    console.error("[GET /api/tasks/:id]", err);
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { taskId } = await params;
  const sessionUser = await getSessionUser().catch(() => null);
  try {
    const body = await req.json();

    // Build update payload from whichever fields were sent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: Record<string, any> = {};
    if (body.completed !== undefined) update.completed = body.completed;
    if (body.title !== undefined) update.title = body.title;
    if (body.notes !== undefined) update.notes = body.notes;
    if (body.priority !== undefined) update.priority = body.priority;
    if ("dueDate" in body) {
      update.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }

    const [task] = await db()
      .update(tasks)
      .set(update)
      .where(eq(tasks.id, taskId))
      .returning();

    const action =
      body.completed === true ? "task.completed" : "task.updated";

    logActivity({
      userId: sessionUser?.id ?? "unknown",
      userName: sessionUser?.name ?? "Unknown",
      userEmail: sessionUser?.email ?? "unknown@unknown.com",
      action,
      entityType: "task",
      entityId: taskId,
      entityName: task.title,
      metadata: { ...update },
    });

    return NextResponse.json({ task });
  } catch (err) {
    console.error("[PATCH /api/tasks/:id]", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { taskId } = await params;
  const sessionUser = await getSessionUser().catch(() => null);
  try {
    const [task] = await db()
      .delete(tasks)
      .where(eq(tasks.id, taskId))
      .returning();

    logActivity({
      userId: sessionUser?.id ?? "unknown",
      userName: sessionUser?.name ?? "Unknown",
      userEmail: sessionUser?.email ?? "unknown@unknown.com",
      action: "task.updated",
      entityType: "task",
      entityId: taskId,
      entityName: task?.title ?? taskId,
      metadata: { deleted: true },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/tasks/:id]", err);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
