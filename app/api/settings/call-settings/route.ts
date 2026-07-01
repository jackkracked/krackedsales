import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { callSettings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** GET the Calls-page calendar allowlist (empty array = show all calendars). */
export async function GET() {
  const rows = await db().select().from(callSettings).limit(1);
  const allowedCalendarIds = (rows[0]?.allowedCalendarIds as string[] | undefined) ?? [];
  return NextResponse.json({ allowedCalendarIds });
}

/** POST { allowedCalendarIds: string[] } — which calendars' Meet calls to show. */
export async function POST(req: NextRequest) {
  let body: { allowedCalendarIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const raw = body.allowedCalendarIds;
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "allowedCalendarIds must be an array of strings" }, { status: 400 });
  }
  const allowedCalendarIds = [...new Set(raw as string[])];

  await db().delete(callSettings);
  const [row] = await db().insert(callSettings).values({ allowedCalendarIds }).returning();
  return NextResponse.json({ allowedCalendarIds: row.allowedCalendarIds });
}
