import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface CancelRequestBody {
  eventId: string;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CancelRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { eventId } = body;
  if (!eventId) {
    return NextResponse.json({ error: "Missing required field: eventId" }, { status: 400 });
  }

  try {
    await ghl.put(`/calendars/events/appointments/${eventId}`, {
      status: "cancelled",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[calendar/cancel] Failed to cancel appointment:", message);
    return NextResponse.json(
      { error: `Failed to cancel appointment: ${message}` },
      { status: 502 }
    );
  }
}
