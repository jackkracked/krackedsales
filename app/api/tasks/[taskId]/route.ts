import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  try {
    const body = await req.json();
    const [task] = await db()
      .update(tasks)
      .set({ completed: body.completed })
      .where(eq(tasks.id, taskId))
      .returning();

    return NextResponse.json({ task });
  } catch (err) {
    console.error("[PATCH /api/tasks/:id]", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
