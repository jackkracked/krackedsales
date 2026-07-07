import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sentReminders } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Who has dripped through each step of a reminder sequence, from the sent_reminders
 * ledger. Returns per-step counts (sent / failed) + the recipients, so an admin can
 * watch clients move through the sequence like an ESP automation view. Read-only, admin.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const rows = await db()
    .select()
    .from(sentReminders)
    .where(eq(sentReminders.templateKey, key))
    .orderBy(desc(sentReminders.sentAt))
    .limit(2000);

  // Group by the STABLE step key so counts follow a step across sequence edits. The
  // "rep_nudge" key is the rep-handoff sentinel, surfaced separately. The client maps
  // each key to its current step via the schedule.
  const byKey = new Map<string, { stepKey: string; sent: number; failed: number; recipients: { email: string | null; sentAt: string; status: string }[] }>();
  let repNudged = 0;
  for (const r of rows) {
    const key = r.stepKey ?? `idx-${r.stepNumber}`;
    if (key === "rep_nudge") { if (r.status === "sent") repNudged++; continue; }
    let g = byKey.get(key);
    if (!g) { g = { stepKey: key, sent: 0, failed: 0, recipients: [] }; byKey.set(key, g); }
    if (r.status === "sent") g.sent++;
    else if (r.status === "failed") g.failed++;
    if (g.recipients.length < 100) {
      g.recipients.push({ email: r.recipientEmail, sentAt: r.sentAt.toISOString(), status: r.status });
    }
  }

  return NextResponse.json({ steps: [...byKey.values()], repNudged });
}
