import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import {
  addManualBooking, closeMonth, decideCredit, recordOutcome, setMonthSetting, setOverride, TrackerError, type Actor,
} from "@/lib/tracker/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/tracker/actions  { action, ...input }
 *
 * Every change to the pay tracker goes through here and then through lib/tracker/actions.ts,
 * where each permission rule sits beside the write it guards. The actor always comes from the
 * SESSION. Any `userId` in the body is the person being acted ON, and the actions module refuses
 * it unless it is the actor themself or the actor is an admin.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.isActive) return NextResponse.json({ error: "Account is deactivated" }, { status: 403 });
  if (user.role !== "admin" && !(await can(user.id, user.role, "view_tracker"))) {
    return NextResponse.json({ error: "The pay tracker is not switched on for you yet" }, { status: 403 });
  }
  const actor: Actor = { id: user.id, role: user.role, ghlUserId: user.ghlUserId };

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);

  try {
    switch (body.action) {
      case "outcome":
        await recordOutcome(actor, { rowRef: str("rowRef") ?? "", outcome: body.outcome as "held" | "no_show" });
        return NextResponse.json({ ok: true });
      case "credit":
        await decideCredit(actor, {
          appointmentId: str("appointmentId"), manualRowId: str("manualRowId"),
          setterUserId: str("setterUserId") ?? "", decision: body.decision as "claim" | "reject",
        });
        return NextResponse.json({ ok: true });
      case "manual":
        return NextResponse.json({ ok: true, ...(await addManualBooking(actor, {
          setterUserId: str("setterUserId") ?? "",
          contactId: str("contactId") ?? null,
          contactName: str("contactName") ?? "",
          companyName: str("companyName") ?? null,
          bookedAt: str("bookedAt") ?? null,
          callAt: str("callAt") ?? "",
          appointmentId: str("appointmentId") ?? null,
        })) });
      case "override":
        await setOverride(actor, { subjectUserId: str("subjectUserId") ?? "", rowKey: str("rowKey") ?? "", field: str("field") ?? "", value: body.value ?? null });
        return NextResponse.json({ ok: true });
      case "setting":
        return NextResponse.json({ ok: true, settings: await setMonthSetting(actor, {
          userId: str("userId") ?? "", month: str("month") ?? "",
          field: body.field as "basePayCents" | "bookingBonusCents" | "commissionPct",
          value: body.value === null ? null : Number(body.value),
        }) });
      case "close":
        return NextResponse.json({ ok: true, ...(await closeMonth(actor, str("month") ?? "")) });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof TrackerError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/tracker/actions]", body.action, err);
    return NextResponse.json({ error: "Could not save that change" }, { status: 500 });
  }
}
