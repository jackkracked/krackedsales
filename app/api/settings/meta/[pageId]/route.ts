import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaPages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;

  await db().delete(metaPages).where(eq(metaPages.pageId, pageId));

  return NextResponse.json({ ok: true });
}
