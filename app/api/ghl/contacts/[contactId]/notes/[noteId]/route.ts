import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";
import { getSessionUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string; noteId: string }> }
) {
  const { contactId, noteId } = await params;
  const reqBody = await req.json();
  const sessionUser = await getSessionUser().catch(() => null);

  try {
    const data = await ghl.put(
      `/contacts/${contactId}/notes/${noteId}/`,
      reqBody
    );

    logActivity({
      userId: sessionUser?.id ?? "unknown",
      userName: sessionUser?.name ?? "Unknown",
      userEmail: sessionUser?.email ?? "unknown@unknown.com",
      action: "note.updated",
      entityType: "contact",
      entityId: contactId,
      entityName: reqBody.contactName,
      metadata: { note_id: noteId, note_preview: reqBody.body?.slice(0, 100) },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[PUT /api/ghl/contacts/[id]/notes/[noteId]]", err);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}
