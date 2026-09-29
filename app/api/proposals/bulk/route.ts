import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { runBulk, type BulkAction } from "@/lib/proposals/bulk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIONS: BulkAction[] = ["archive", "unarchive", "lost", "delete"];

/**
 * POST /api/proposals/bulk  { action, ids, reason? }
 * Admin-only (checked here and again in runBulk). Returns one result per proposal, so the bar can
 * say exactly what happened: "12 archived, 2 skipped: signed". Money is never touched in bulk.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.isActive || user.role !== "admin") return NextResponse.json({ error: "Only an admin can do that" }, { status: 403 });
  let body: { action?: string; ids?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }
  if (!ACTIONS.includes(body.action as BulkAction)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!Array.isArray(body.ids)) return NextResponse.json({ error: "ids must be a list" }, { status: 400 });
  try {
    const results = await runBulk({ id: user.id, name: user.name, role: user.role }, body.action as BulkAction,
      body.ids.filter((x): x is string => typeof x === "string"), typeof body.reason === "string" ? body.reason : undefined);
    return NextResponse.json({ results });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status === 500) console.error("[POST /api/proposals/bulk]", err);
    return NextResponse.json({ error: status === 500 ? "Could not complete that" : (err as Error).message }, { status });
  }
}
