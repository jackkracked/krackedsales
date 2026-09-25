import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { getCloserMonth, getCloserMonths } from "@/lib/tracker/closer";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracker/closer?month=YYYY-MM&userId=<uuid>
 *
 * THE ACCESS RULE, WHICH IS THE WHOLE POINT
 * This returns somebody's PAY. A rep may read their own and nobody else's; only an admin may
 * pass a `userId` other than their own. The check is on the SESSION, never on anything the
 * client sends, so a rep cannot read Alice's earnings by editing a query string. Asking for
 * someone else's row is a 403, not an empty result, because a silent empty answer would look
 * like a bug and get "fixed" by someone loosening this.
 */
export async function GET(req: NextRequest) {
  const actor = await getSessionUser().catch(() => null);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!actor.isActive) return NextResponse.json({ error: "Account is deactivated" }, { status: 403 });

  const requested = req.nextUrl.searchParams.get("userId") ?? actor.id;
  if (requested !== actor.id && actor.role !== "admin") {
    return NextResponse.json({ error: "You can only view your own tracker" }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  try {
    const [data, months] = await Promise.all([
      getCloserMonth(requested, month),
      getCloserMonths(requested),
    ]);
    if (!data) return NextResponse.json({ error: "No such person" }, { status: 404 });

    // An admin also needs the list of people they can switch between. Nobody else does, and
    // sending it to a rep would leak the roster's pay-bearing roles for no reason.
    let people: Array<{ id: string; name: string; role: string }> | undefined;
    if (actor.role === "admin") {
      people = await db()
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(eq(users.isActive, true))
        .orderBy(asc(users.name));
    }

    // The current month is still running, so every figure in it is a projection rather than a
    // settled amount. The screen says so; this flag is what lets it.
    const isCurrentMonth = month === new Date().toISOString().slice(0, 7);

    return NextResponse.json({ ...data, months, people, isCurrentMonth });
  } catch (err) {
    console.error("[GET /api/tracker/closer]", err);
    return NextResponse.json({ error: "Could not build the tracker" }, { status: 500 });
  }
}
