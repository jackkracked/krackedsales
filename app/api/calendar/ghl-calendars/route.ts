import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

interface GhlCalendar {
  id: string;
  name: string;
  description?: string;
}

interface GhlCalendarsResponse {
  calendars: GhlCalendar[];
}

/** GET /api/calendar/ghl-calendars — list GHL calendars for the location */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const loc = locationId();
    const data = await ghl.get<GhlCalendarsResponse>(
      `/calendars/?locationId=${loc}`
    );

    return NextResponse.json({
      calendars: (data.calendars ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ghl-calendars] Failed to fetch:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
