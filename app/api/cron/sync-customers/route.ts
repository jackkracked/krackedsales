import { NextRequest, NextResponse } from "next/server";
import { syncCustomersFromStripe, linkCustomersToContacts, mirrorCustomerStatusToContacts } from "@/lib/customers/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Daily cron — refreshes the `customers` snapshot from Stripe, links any new payers to a contact,
 * and mirrors each customer's status onto its contact row (Contacts-tab badge). Read-only against
 * Stripe; writes only our own customers / local_contacts rows.
 * Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const synced = await syncCustomersFromStripe();
    const linked = await linkCustomersToContacts();
    const mirrored = await mirrorCustomerStatusToContacts();
    return NextResponse.json({ ok: true, synced, linked, mirrored });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/sync-customers]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
