import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Returns contacts who need a follow-up.
 * Falls back gracefully if the database isn't configured yet.
 */
export async function GET() {
  try {
    const { db } = await import("@/lib/db");
    const { followupContacts } = await import("@/lib/db/schema");
    const { isNull, lte } = await import("drizzle-orm");
    const { subDays } = await import("date-fns");

    const threeDaysAgo = subDays(new Date(), 3);

    const contacts = await db()
      .select()
      .from(followupContacts)
      .where(
        // No response AND demo sent more than 3 days ago
        isNull(followupContacts.lastResponseAt)
      )
      .orderBy(followupContacts.demoSentAt)
      .limit(20);

    const enriched = contacts
      .filter((c) => new Date(c.demoSentAt) <= threeDaysAgo)
      .map((c) => ({
        ...c,
        daysSince: Math.floor(
          (Date.now() - new Date(c.demoSentAt).getTime()) / (1000 * 60 * 60 * 24)
        ),
      }));

    return NextResponse.json({ contacts: enriched });
  } catch (err) {
    // Gracefully return empty list if DB isn't set up
    console.warn("[GET /api/analytics/followups] DB not available:", err);
    return NextResponse.json({ contacts: [] });
  }
}
