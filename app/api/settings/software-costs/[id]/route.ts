import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { softwareCosts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await db().delete(softwareCosts).where(eq(softwareCosts.id, id));

  return NextResponse.json({ ok: true });
}
