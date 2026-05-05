import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templateSends } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const { templateId } = await params;
  try {
    const { contactId, conversationId } = await req.json();
    const [send] = await db()
      .insert(templateSends)
      .values({ templateId, contactId, conversationId })
      .returning();
    return NextResponse.json({ send });
  } catch (err) {
    console.error("[POST /api/templates/:id/send]", err);
    return NextResponse.json({ error: "Failed to record send" }, { status: 500 });
  }
}
