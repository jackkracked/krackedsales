import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;

  try {
    const data = await ghl.get<Record<string, unknown>>(
      `/conversations/messages/email/${messageId}`
    );
    // Log the full response shape so we can see exactly what GHL returns
    console.log("[email-message] GHL response keys:", Object.keys(data));
    console.log("[email-message] GHL response:", JSON.stringify(data).slice(0, 500));
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/ghl/conversations/messages/email/[id]]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
