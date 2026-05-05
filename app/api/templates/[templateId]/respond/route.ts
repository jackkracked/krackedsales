import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templateResponses, templateSends } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Called when a contact replies after receiving a template */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const { templateId } = await params;
  try {
    const { contactId } = await req.json();

    // Find the most recent send for this contact+template
    const [lastSend] = await db()
      .select()
      .from(templateSends)
      .where(eq(templateSends.templateId, templateId))
      .orderBy(desc(templateSends.sentAt))
      .limit(1);

    if (!lastSend) return NextResponse.json({ ok: false, reason: "no send found" });

    const [response] = await db()
      .insert(templateResponses)
      .values({ sendId: lastSend.id })
      .returning();

    return NextResponse.json({ response });
  } catch (err) {
    console.error("[POST /api/templates/:id/respond]", err);
    return NextResponse.json({ error: "Failed to record response" }, { status: 500 });
  }
}
