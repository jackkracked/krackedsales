import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflowRuns, workflowRunLogs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { runId } = await params;
  const [run] = await db()
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .limit(1);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const logs = await db()
    .select()
    .from(workflowRunLogs)
    .where(eq(workflowRunLogs.runId, runId));
  return NextResponse.json({ ...run, logs });
}
