import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emailTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { getAllTemplates, unknownTokens } from "@/lib/reminders/store";
import { VAR_CATALOG, PREVIEW_SCENARIOS } from "@/lib/reminders/variables";
import type { ScheduleStep } from "@/lib/reminders/defaults";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), user: null };
  if ((user as { role?: string }).role !== "admin") {
    return { error: NextResponse.json({ error: "Admins only" }, { status: 403 }), user: null };
  }
  return { error: null, user: user as { id: string } };
}

/** All templates + the variable catalog + preview scenarios that drive the editor. */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const templates = await getAllTemplates();
  return NextResponse.json({ templates, variables: VAR_CATALOG, scenarios: PREVIEW_SCENARIOS });
}

/** Sanitize an incoming schedule into a clean array of steps. */
function cleanSchedule(input: unknown): ScheduleStep[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).map((s) => {
    const step = s as { delayDays?: unknown; anchor?: unknown };
    const delayDays = Math.max(0, Math.min(365, Math.round(Number(step.delayDays) || 0)));
    const anchor = step.anchor === "due" ? "due" : "sent";
    return { delayDays, anchor };
  });
}

/** Save one template. Whitelisted fields only; unknown {{tokens}} are rejected. */
export async function PUT(req: NextRequest) {
  const { error, user } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : null;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const [existing] = await db().select().from(emailTemplates).where(eq(emailTemplates.key, key)).limit(1);
  if (!existing) return NextResponse.json({ error: "Unknown template" }, { status: 404 });

  const subject = typeof body.subject === "string" ? body.subject : existing.subject;
  const bodyTemplate = typeof body.bodyTemplate === "string" ? body.bodyTemplate : existing.bodyTemplate;
  const ctaLabel = typeof body.ctaLabel === "string" ? body.ctaLabel : existing.ctaLabel;

  // Reject any variable the catalog doesn't know, so a raw {{token}} can never reach a client.
  const bad = unknownTokens(subject, bodyTemplate, ctaLabel);
  if (bad.length) {
    return NextResponse.json({ error: `Unknown variables: ${bad.join(", ")}` }, { status: 400 });
  }

  const enabled = typeof body.enabled === "boolean" ? body.enabled : existing.enabled;
  const notifyRep = typeof body.notifyRep === "boolean" ? body.notifyRep : existing.notifyRep;
  const schedule = body.schedule !== undefined ? cleanSchedule(body.schedule) : (existing.schedule as ScheduleStep[]);

  // Late-enable guard: turning a reminder ON (or editing while on) sets the floor to now,
  // so it only ever reminds entities from this moment forward, never the historical backlog.
  const turningOn = enabled && !existing.enabled;
  const activeFrom = turningOn ? new Date() : existing.activeFrom;

  const [updated] = await db()
    .update(emailTemplates)
    .set({ subject, bodyTemplate, ctaLabel, schedule, enabled, notifyRep, activeFrom, updatedBy: user.id, updatedAt: new Date() })
    .where(eq(emailTemplates.key, key))
    .returning();

  return NextResponse.json({ ok: true, template: updated });
}
