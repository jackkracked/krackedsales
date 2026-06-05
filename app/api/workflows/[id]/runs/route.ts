import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflowRuns } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await db()
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, id))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(50);
  return NextResponse.json(rows);
}
