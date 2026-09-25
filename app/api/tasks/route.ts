import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks, users } from "@/lib/db/schema";
import { eq, asc, desc, and, or, SQL } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/activity/logger";
import { sendSlackDm, taskDmBlocks } from "@/lib/slack/dm";
import { createNotification } from "@/lib/notifications";

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
      // Mine means BOTH: tasks I hold, and tasks I handed to someone else. Jack, 2026-09-22:
      // an admin who delegates should not lose sight of the work in his own list.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conditions.push(or(eq(tasks.userId, user.id as any), eq(tasks.assignedByUserId, user.id as any))!);
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

    // `meId` so the list can tell YOUR tasks from ones you delegated, without a
    // second request and without needing the admin-only roster.
    return NextResponse.json({ tasks: rows, meId: user.id });
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
      assigneeId,
    } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // ── Who owns this task ────────────────────────────────────────────────────────────
    // Default is self. Handing work to someone else is an ADMIN action: the picker is
    // hidden for everyone else, and this is the check that actually enforces it, because a
    // hidden control is not a permission.
    let owner = { id: sessionUser?.id ?? null, name: sessionUser?.name ?? null, slackUserId: null as string | null, timezone: null as string | null };
    let assignedBy: { id: string; name: string } | null = null;

    if (assigneeId && assigneeId !== sessionUser?.id) {
      if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      if (sessionUser.role !== "admin") {
        return NextResponse.json({ error: "Only admins can assign tasks to someone else" }, { status: 403 });
      }
      const [assignee] = await db()
        .select({ id: users.id, name: users.name, isActive: users.isActive, slackUserId: users.slackUserId, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, assigneeId))
        .limit(1);
      if (!assignee) return NextResponse.json({ error: "That person does not exist" }, { status: 400 });
      if (!assignee.isActive) return NextResponse.json({ error: "That person is deactivated" }, { status: 400 });

      owner = { id: assignee.id, name: assignee.name, slackUserId: assignee.slackUserId, timezone: assignee.timezone };
      assignedBy = { id: sessionUser.id, name: sessionUser.name };
    } else if (sessionUser) {
      // Self-created. `getSessionUser` does not carry the Slack id or timezone, so read them:
      // Jack, 2026-09-22, chose to notify on EVERY task, not only delegated ones, so a task
      // you write for yourself gets a DM too. Without this lookup the owner's slackUserId
      // would be null and the DM would silently never send — which is the ambiguity that
      // made Gage's test look broken when it was working as designed.
      const [me] = await db()
        .select({ slackUserId: users.slackUserId, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, sessionUser.id))
        .limit(1);
      owner = { ...owner, slackUserId: me?.slackUserId ?? null, timezone: me?.timezone ?? null };
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
        userId: (owner.id as any) ?? null,
        userName: owner.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assignedByUserId: (assignedBy?.id as any) ?? null,
        assignedByName: assignedBy?.name ?? null,
      })
      .returning();

    // ── Tell the assignee ─────────────────────────────────────────────────────────────
    // Only when it is someone else's task; nobody needs a DM about their own note.
    // Never allowed to fail the request: the task is already saved and is the real record.
    let slackDelivered = false;
    if (owner.id) {
      if (owner.slackUserId) {
        const { text, blocks } = taskDmBlocks({
          // Who it came from changes the wording. A task you wrote yourself should not read
          // as though somebody handed it to you.
          heading: assignedBy ? `${assignedBy.name} assigned you a task` : "New task",
          title: task.title,
          dueDate: task.dueDate,
          priority: task.priority,
          contactName: task.contactName,
          timezone: owner.timezone,
        });
        slackDelivered = await sendSlackDm({ slackUserId: owner.slackUserId, text, blocks });
      }
      // The in-app notification is only for work HANDED to you. You do not need to be told
      // about a note you just typed while looking at the screen you typed it on.
      if (assignedBy) {
        await createNotification(
          owner.id,
          "task_assigned",
          `${assignedBy.name} assigned you: ${task.title}`,
          task.contactName ? `Related to ${task.contactName}` : undefined,
          "/tasks",
          `assigned::${task.id}`,
        ).catch((e) => console.error("[tasks] notification failed", e));
      }
    }

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

    // `slackDelivered` lets the UI tell the truth about what actually happened rather than
    // implying a DM that never left.
    return NextResponse.json({ task, slackDelivered });
  } catch (err) {
    console.error("[POST /api/tasks]", err);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
