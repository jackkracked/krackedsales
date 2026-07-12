/**
 * GET/POST the unit-economics assumptions (the editable "dials"). Admin-only — this is deep
 * financial data (founder comp, margins). GET seeds from defaults when nothing is saved yet.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { loadAssumptions, saveAssumptions } from "@/lib/unit-economics/persist";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ assumptions: await loadAssumptions() });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const incoming = (body as { assumptions?: unknown })?.assumptions ?? body;
  try {
    const assumptions = await saveAssumptions(incoming, user.id ?? null);
    return NextResponse.json({ assumptions });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Save failed" }, { status: 400 });
  }
}
