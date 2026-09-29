import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { CreditError, setCredit, type CreditChange, type CreditItem } from "@/lib/proposals/credit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/proposals/credit  { items: CreditItem[], change: CreditChange }
 *
 * Changes who is credited as closer or setter on one or many proposals. Admin-only: checked on
 * the session here and again inside setCredit. Compare-and-set per proposal; the response lists
 * every proposal with ok or the reason it was skipped.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.isActive || user.role !== "admin") return NextResponse.json({ error: "Only an admin can change who is credited" }, { status: 403 });
  let body: { items?: unknown; change?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }

  // Rebuild everything from known fields only (mass-assignment guard).
  const items: CreditItem[] = (Array.isArray(body.items) ? body.items : []).flatMap((raw) => {
    const i = raw as Record<string, unknown>;
    if (typeof i?.proposalId !== "string") return [];
    const es = i.expectedSetter as { mode?: unknown; userIds?: unknown } | undefined;
    return [{
      proposalId: i.proposalId,
      expectedCloser: typeof i.expectedCloser === "string" ? i.expectedCloser : i.expectedCloser === null ? null : undefined,
      expectedSetter: es && typeof es.mode === "string"
        ? { mode: es.mode, userIds: Array.isArray(es.userIds) ? es.userIds.filter((x): x is string => typeof x === "string") : [] }
        : undefined,
    }];
  });
  const c = body.change ?? {};
  let change: CreditChange;
  if (c.field === "closer" && c.action === "assign" && typeof c.userId === "string") change = { field: "closer", action: "assign", userId: c.userId };
  else if (c.field === "closer" && c.action === "confirm") change = { field: "closer", action: "confirm" };
  else if (c.field === "setter" && c.action === "assign" && typeof c.userId === "string") change = { field: "setter", action: "assign", userId: c.userId };
  else if (c.field === "setter" && c.action === "none") change = { field: "setter", action: "none" };
  else if (c.field === "setter" && c.action === "confirm") change = { field: "setter", action: "confirm" };
  else return NextResponse.json({ error: "Unknown change" }, { status: 400 });

  try {
    return NextResponse.json({ results: await setCredit({ id: user.id, role: user.role }, items, change) });
  } catch (err) {
    if (err instanceof CreditError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/proposals/credit]", err);
    return NextResponse.json({ error: "Could not save that change" }, { status: 500 });
  }
}
