import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string; noteId: string }> }
) {
  const { contactId, noteId } = await params;
  const body = await req.json();

  try {
    const data = await ghl.put(
      `/contacts/${contactId}/notes/${noteId}/`,
      body
    );
    return NextResponse.json(data);
  } catch (err) {
    console.error("[PUT /api/ghl/contacts/[id]/notes/[noteId]]", err);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}
