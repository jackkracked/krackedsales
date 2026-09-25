import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getSetterMonth } from "@/lib/tracker/setter";
import { getCloserMonth } from "@/lib/tracker/closer";
import { closeReviewFor, nextMonthToClose } from "@/lib/tracker/actions";
import { loadCloses } from "@/lib/tracker/ledger-store";
import { currentNyMonth, isMonthKey, TRACKER_GO_LIVE_MONTH } from "@/lib/tracker/months";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/tracker?month=YYYY-MM&userId=<uuid>
 *
 * One person's pay for one month: the setter view for a setter, the closer view for anyone else.
 *
 * THE ACCESS RULE, WHICH IS THE WHOLE POINT
 * This returns somebody's PAY. A rep may read their own and nobody else's; only an admin may pass
 * another `userId`. Checked on the SESSION, never on anything the client sends. Asking for someone
 * else's is a 403, not an empty result, because a silent empty answer looks like a bug and gets
 * "fixed" by someone loosening this.
 */
export async function GET(req: NextRequest) {
  const actor = await getSessionUser().catch(() => null);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!actor.isActive) return NextResponse.json({ error: "Account is deactivated" }, { status: 403 });
  const isAdmin = actor.role === "admin";
  if (!isAdmin && !(await can(actor.id, actor.role, "view_tracker"))) {
    return NextResponse.json({ error: "The pay tracker is not switched on for you yet" }, { status: 403 });
  }

  const requested = req.nextUrl.searchParams.get("userId") ?? actor.id;
  if (requested !== actor.id && !isAdmin) {
    return NextResponse.json({ error: "You can only view your own tracker" }, { status: 403 });
  }
  const month = req.nextUrl.searchParams.get("month") ?? currentNyMonth();
  if (!isMonthKey(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });

  try {
    const [subject] = await db().select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, requested)).limit(1);
    if (!subject) return NextResponse.json({ error: "No such person" }, { status: 404 });

    const data = subject.role === "setter"
      ? { ...(await getSetterMonth(subject.id, month)), name: subject.name }
      : await getCloserMonth(subject.id, month);
    if (!data) return NextResponse.json({ error: "No such person" }, { status: 404 });

    // Only an admin needs the roster and the close task. Sending the roster to a rep would leak
    // who is on pay-bearing roles for no reason.
    let people: Array<{ id: string; name: string; role: string }> | undefined;
    let nextToClose: string | null = null;
    let closeReview: string[] = [];
    if (isAdmin) {
      people = await db().select({ id: users.id, name: users.name, role: users.role })
        .from(users).where(eq(users.isActive, true)).orderBy(asc(users.name));
      nextToClose = await nextMonthToClose();
      if (nextToClose) closeReview = await closeReviewFor(nextToClose);
    }

    const closes = await loadCloses();
    const isSelf = subject.id === actor.id;
    const monthOpen = month >= TRACKER_GO_LIVE_MONTH && month <= currentNyMonth() && !closes.has(month);
    const close = closes.get(month);

    return NextResponse.json({
      data,
      people,
      nextToClose,
      closeReview,
      viewer: {
        id: actor.id,
        isAdmin,
        isSelf,
        canEdit: (isSelf || isAdmin) && monthOpen,
        // An admin may correct a row even in a closed month: the correction never rewrites that
        // month, it lands in the next open one as an adjustment.
        canCorrectRows: ((isSelf || isAdmin) && monthOpen) || (isAdmin && month >= TRACKER_GO_LIVE_MONTH),
        canRecordOutcomes: true,
      },
      closedAt: close?.closedAt ?? null,
    });
  } catch (err) {
    console.error("[GET /api/tracker]", err);
    return NextResponse.json({ error: "Could not build the tracker" }, { status: 500 });
  }
}
