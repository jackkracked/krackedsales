import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { getAllRules, unknownRuleTokens } from "@/lib/notifications/store";
import { NOTIF_RULES } from "@/lib/notifications/rules";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), user: null };
  if ((user as { role?: string }).role !== "admin") {
    return { error: NextResponse.json({ error: "Admins only" }, { status: 403 }), user: null };
  }
  return { error: null, user: user as { id: string } };
}

/** All notification rules + their per-rule variable catalogs (for the editor). */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const rules = await getAllRules();
  const variables = Object.fromEntries(NOTIF_RULES.map((r) => [r.key, r.variables]));
  const descriptions = Object.fromEntries(NOTIF_RULES.map((r) => [r.key, r.description]));
  return NextResponse.json({ rules, variables, descriptions });
}

/** Save one rule: enabled, recipients, message. Whitelisted; unknown {{tokens}} rejected. */
export async function PUT(req: NextRequest) {
  const { error, user } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : null;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const [existing] = await db().select().from(notificationRules).where(eq(notificationRules.key, key)).limit(1);
  if (!existing) return NextResponse.json({ error: "Unknown rule" }, { status: 404 });

  const messageTemplate = typeof body.messageTemplate === "string" ? body.messageTemplate : existing.messageTemplate;
  const bad = unknownRuleTokens(key, messageTemplate);
  if (bad.length) return NextResponse.json({ error: `Unknown variables: ${bad.join(", ")}` }, { status: 400 });

  const enabled = typeof body.enabled === "boolean" ? body.enabled : existing.enabled;
  const recipients = ["rep", "gage", "both"].includes(body.recipients) ? body.recipients : existing.recipients;

  const [updated] = await db()
    .update(notificationRules)
    .set({ messageTemplate, enabled, recipients, updatedBy: user.id, updatedAt: new Date() })
    .where(eq(notificationRules.key, key))
    .returning();

  return NextResponse.json({ ok: true, rule: updated });
}
