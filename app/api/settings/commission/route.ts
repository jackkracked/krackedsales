import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { commissionSettings } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/commission
 * Returns the global commission payout timing setting.
 */
export async function GET() {
  const rows = await db().select().from(commissionSettings).limit(1);
  const settings = rows[0] ?? { payoutTiming: "full_paid" };
  return NextResponse.json({ payoutTiming: settings.payoutTiming });
}

/**
 * PATCH /api/settings/commission
 * Upserts the global commission payout timing setting.
 * Body: { payoutTiming: "full_paid" | "first_instalment" | "split" }
 */
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { payoutTiming } = await req.json();
  const valid = ["full_paid", "first_instalment", "split"];
  if (!valid.includes(payoutTiming)) {
    return NextResponse.json({ error: "Invalid payoutTiming" }, { status: 400 });
  }

  const rows = await db().select().from(commissionSettings).limit(1);
  if (rows.length > 0) {
    await db()
      .update(commissionSettings)
      .set({ payoutTiming, updatedAt: new Date() });
  } else {
    await db().insert(commissionSettings).values({ payoutTiming });
  }

  return NextResponse.json({ ok: true });
}
