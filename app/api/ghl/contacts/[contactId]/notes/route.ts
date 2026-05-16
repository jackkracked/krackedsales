import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";
import { getSessionUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

interface GHLNote {
  id: string;
  body: string;
  userId?: string;
  dateAdded?: string;
  createdAt?: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;

  try {
    const data = await ghl.get<{ notes: GHLNote[] }>(
      `/contacts/${contactId}/notes/`
    );
    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/ghl/contacts/[id]/notes]", err);
    return NextResponse.json({ notes: [] }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;
  const reqBody = await req.json();
  const { body, contactName } = reqBody;

  if (!body?.trim()) {
    return NextResponse.json({ error: "Note body is required" }, { status: 400 });
  }

  try {
    const sessionUser = await getSessionUser().catch(() => null);
    const data = await ghl.post(`/contacts/${contactId}/notes/`, { body });

    logActivity({
      userId: sessionUser?.id ?? "unknown",
      userName: sessionUser?.name ?? "Unknown",
      userEmail: sessionUser?.email ?? "unknown@unknown.com",
      action: "note.created",
      entityType: "contact",
      entityId: contactId,
      entityName: contactName,
      metadata: { note_preview: body.slice(0, 100) },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[POST /api/ghl/contacts/[id]/notes]", err);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}
