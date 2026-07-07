/**
 * The reminder engine. Runs once daily from a cron. For each enabled reminder
 * template it finds the entities that are due for a step and sends a branded email,
 * exactly once, ever.
 *
 * Safety, per the money/comms review:
 *  - CLAIM FIRST: a `sent_reminders` row is inserted (unique-constrained) BEFORE the
 *    send. A duplicate insert no-ops the step, so a re-run / double-fire can never
 *    double-email. On send failure the row is marked "failed" and retried next run.
 *  - FLOOR: only entities whose anchor date is on/after `activeFrom` (set when the
 *    reminder was turned on) AND within a lookback window are considered, so turning a
 *    reminder on never retro-blasts historical proposals/invoices.
 *  - DATE MATH is calendar-day, in the business timezone (LA), so "2 days after" fires
 *    on the right day regardless of send time or the cron hour.
 *  - NO STRIPE CALLS: pay/sign URLs are read from already-stored columns only.
 *  - PER-ENTITY isolation: one entity throwing never aborts the rest of the batch.
 */
import { db } from "@/lib/db";
import { proposals, proposalInstalments, sentReminders, users, emailTemplates } from "@/lib/db/schema";
import { and, or, eq, isNull, isNotNull, gte, lt, inArray } from "drizzle-orm";
import { getAllTemplates } from "@/lib/reminders/store";
import { resolveVars, type ResolveContext } from "@/lib/reminders/variables";
import { renderEmail } from "@/lib/reminders/render";
import { sendRenderedEmail } from "@/lib/email/resend";
import { postToSalesChannel, slackMentionForEmail } from "@/lib/proposals/slack-notify";
import type { ScheduleStep } from "@/lib/reminders/defaults";

type TemplateRow = typeof emailTemplates.$inferSelect;
type ProposalRow = typeof proposals.$inferSelect;
type InstalmentRow = typeof proposalInstalments.$inferSelect;

const BUSINESS_TZ = "America/Los_Angeles";
const LOOKBACK_DAYS = 45;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://kracked-sales.vercel.app";
const GAGE_EMAIL = "gage@krackedretention.com";

export interface RunSummary {
  sent: number;
  repNudges: number;
  failures: number;
  skipped: number;
}

// ── date helpers (calendar-day math in the business timezone) ──────────────────
function dateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDaysStr(s: string, n: number): string {
  const d = new Date(`${s}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function reminderFloor(activeFrom: Date | null, now: Date): Date {
  const lookback = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  return activeFrom && activeFrom > lookback ? activeFrom : lookback;
}
function isHttpsUrl(u: string | null | undefined): u is string {
  // Reject <>"' as well as whitespace so a URL can never break out of an href attribute.
  return !!u && /^https:\/\/[^\s<>"']+$/.test(u);
}
const STALE_SENDING_MS = 15 * 60 * 1000;
function scheduleOf(t: TemplateRow): ScheduleStep[] {
  return Array.isArray(t.schedule) ? (t.schedule as ScheduleStep[]) : [];
}

interface StepTarget {
  template: TemplateRow;
  entityId: string;
  referenceDate: Date;
  recipient: string;
  ctaUrl: string | null;
  ctx: ResolveContext;
}

/**
 * Claim + send ONE step. Returns "sent" | "skip" | "fail". The unique (entity, template,
 * step) row is the at-most-once guarantee; a failed row is re-claimed on a later run.
 */
async function sendStep(t: StepTarget, stepNumber: number, summary: RunSummary): Promise<void> {
  const target = and(
    eq(sentReminders.entityId, t.entityId),
    eq(sentReminders.templateKey, t.template.key),
    eq(sentReminders.stepNumber, stepNumber),
  );

  // Claim the slot. If the row already exists and isn't a prior failure, skip.
  const claimed = await db()
    .insert(sentReminders)
    .values({ entityId: t.entityId, templateKey: t.template.key, stepNumber, recipientEmail: t.recipient, status: "sending" })
    .onConflictDoNothing({ target: [sentReminders.entityId, sentReminders.templateKey, sentReminders.stepNumber] })
    .returning({ id: sentReminders.id });

  let rowId: string;
  if (claimed.length) {
    rowId = claimed[0].id;
  } else {
    // Row exists: retry only if it previously FAILED, or was left "sending" by a crash
    // mid-batch (older than the stale window). A fresh "sending"/"sent" row is skipped.
    // The WHERE + RETURNING keeps this race-safe against a concurrent run.
    const staleBefore = new Date(Date.now() - STALE_SENDING_MS);
    const reclaim = await db().update(sentReminders)
      .set({ status: "sending", error: null, recipientEmail: t.recipient, sentAt: new Date() })
      .where(and(
        target,
        or(eq(sentReminders.status, "failed"), and(eq(sentReminders.status, "sending"), lt(sentReminders.sentAt, staleBefore))),
      ))
      .returning({ id: sentReminders.id });
    if (!reclaim.length) { summary.skipped++; return; }
    rowId = reclaim[0].id;
  }

  // A reminder with a CTA must have a real link; never send a broken/no-action email.
  if (t.template.ctaLabel && !isHttpsUrl(t.ctaUrl)) {
    await db().update(sentReminders).set({ status: "failed", error: "missing or invalid CTA url" }).where(eq(sentReminders.id, rowId));
    summary.failures++;
    return;
  }

  try {
    const values = resolveVars(t.ctx);
    const { subject, html } = renderEmail(t.template, values, { ctaUrl: t.ctaUrl });
    await sendRenderedEmail(t.recipient, subject, html);
    await db().update(sentReminders).set({ status: "sent", sentAt: new Date() }).where(eq(sentReminders.id, rowId));
    summary.sent++;
  } catch (e) {
    await db().update(sentReminders).set({ status: "failed", error: String(e).slice(0, 500) }).where(eq(sentReminders.id, rowId));
    summary.failures++;
  }
}

/** Every due step for one entity, in order. Isolated so one failure never aborts the batch. */
async function processEntity(t: StepTarget, now: Date, summary: RunSummary): Promise<void> {
  try {
    const schedule = scheduleOf(t.template);
    if (!schedule.length) return;
    const today = dateStr(now);
    const refStr = dateStr(t.referenceDate);

    for (let i = 0; i < schedule.length; i++) {
      const dueStr = addDaysStr(refStr, Number(schedule[i].delayDays) || 0);
      if (today >= dueStr) await sendStep(t, i, summary);
    }

    // After the last step's day, if the entity is still unresolved (it wouldn't be in
    // the query otherwise), nudge the rep once. step_number -1 is the dedup sentinel.
    if (t.template.notifyRep) {
      const lastDue = addDaysStr(refStr, Number(schedule[schedule.length - 1].delayDays) || 0);
      if (today >= lastDue) await nudgeRep(t, summary);
    }
  } catch (e) {
    console.error(`[reminders] entity ${t.entityId} failed:`, e);
    summary.failures++;
  }
}

async function nudgeRep(t: StepTarget, summary: RunSummary): Promise<void> {
  const claimed = await db()
    .insert(sentReminders)
    .values({ entityId: t.entityId, templateKey: t.template.key, stepNumber: -1, status: "sending" })
    .onConflictDoNothing({ target: [sentReminders.entityId, sentReminders.templateKey, sentReminders.stepNumber] })
    .returning({ id: sentReminders.id });
  if (!claimed.length) return; // already nudged

  const rowId = claimed[0].id;
  try {
    const mention = await slackMentionForEmail(GAGE_EMAIL, "Gage");
    const isInvoice = t.template.key === "invoice_reminder";
    const client = t.ctx.proposal.contactName;
    const what = isInvoice ? "still hasn't paid" : "still hasn't signed";
    const link = isInvoice ? (isHttpsUrl(t.ctaUrl) ? t.ctaUrl : "") : `${APP_URL}/p/${t.ctx.proposal.token}`;
    await postToSalesChannel(
      `${mention} *${client}* ${what} after all reminders. Might be worth a personal follow-up.${link ? `\n${link}` : ""}`,
    );
    await db().update(sentReminders).set({ status: "sent", sentAt: new Date() }).where(eq(sentReminders.id, rowId));
    summary.repNudges++;
  } catch (e) {
    await db().update(sentReminders).set({ status: "failed", error: String(e).slice(0, 500) }).where(eq(sentReminders.id, rowId));
  }
}

/** Main entry: run all enabled reminders for `now`. Safe to call repeatedly (idempotent). */
export async function runReminders(now: Date = new Date()): Promise<RunSummary> {
  const summary: RunSummary = { sent: 0, repNudges: 0, failures: 0, skipped: 0 };
  const templates = await getAllTemplates();
  const byKey = new Map(templates.map((t) => [t.key, t]));

  // rep-name lookup for context / value resolution
  const userRows = await db().select({ id: users.id, name: users.name }).from(users);
  const userName = new Map(userRows.map((u) => [u.id, u.name] as const));
  const repNameFor = (p: ProposalRow) => (p.createdBy ? userName.get(p.createdBy) ?? null : null);

  // ── Proposal reminders (sent, still unsigned) ────────────────────────────────
  const propTpl = byKey.get("proposal_reminder");
  if (propTpl?.enabled) {
    const floor = reminderFloor(propTpl.activeFrom, now);
    const rows = await db().select().from(proposals).where(and(
      eq(proposals.status, "sent"),
      isNull(proposals.signedAt),
      isNotNull(proposals.contactEmail),
      isNotNull(proposals.sentAt),
      gte(proposals.sentAt, floor),
    ));
    for (const p of rows) {
      if (!p.contactEmail || !p.sentAt) continue;
      await processEntity({
        template: propTpl,
        entityId: p.id,
        referenceDate: p.sentAt,
        recipient: p.contactEmail,
        ctaUrl: `${APP_URL}/p/${p.token}`,
        ctx: { proposal: p, repName: repNameFor(p) },
      }, now, summary);
    }
  }

  // ── Invoice reminders (paused by default) ────────────────────────────────────
  const invTpl = byKey.get("invoice_reminder");
  if (invTpl?.enabled) {
    const floor = reminderFloor(invTpl.activeFrom, now);

    // Arm 1: pending instalments (deposits + project instalments), anchored on due date.
    const instRows = await db()
      .select({ inst: proposalInstalments, prop: proposals })
      .from(proposalInstalments)
      .innerJoin(proposals, eq(proposalInstalments.proposalId, proposals.id))
      .where(and(
        eq(proposalInstalments.status, "pending"),
        isNotNull(proposalInstalments.dueDate),
        gte(proposalInstalments.dueDate, floor),
        isNotNull(proposals.contactEmail),
        // Never dun a cancelled deal: lost/void proposals leave instalments "pending",
        // so exclude any proposal that isn't in a live, money-owed state.
        inArray(proposals.status, ["sent", "signed", "partial", "overdue"]),
      ));
    for (const { inst, prop } of instRows as { inst: InstalmentRow; prop: ProposalRow }[]) {
      if (!prop.contactEmail || !inst.dueDate) continue;
      const payUrl = inst.stripeHostedUrl ?? prop.stripeHostedUrl ?? null;
      await processEntity({
        template: invTpl,
        entityId: inst.id,
        referenceDate: inst.dueDate,
        recipient: prop.contactEmail,
        ctaUrl: payUrl,
        ctx: { proposal: prop, instalment: inst, repName: repNameFor(prop) },
      }, now, summary);
    }

    // Arm 2: signed-but-unpaid subscription/single with NO instalment row (Payment Link).
    const signedUnpaid = await db().select().from(proposals).where(and(
      eq(proposals.status, "signed"),
      isNull(proposals.paidAt),
      inArray(proposals.paymentStructure, ["subscription", "single"]),
      eq(proposals.hasDeposit, false),
      isNotNull(proposals.contactEmail),
      isNotNull(proposals.signedAt),
      gte(proposals.signedAt, floor),
    ));
    for (const p of signedUnpaid) {
      if (!p.contactEmail || !p.signedAt || !isHttpsUrl(p.stripeHostedUrl)) continue;
      await processEntity({
        template: invTpl,
        entityId: p.id,
        referenceDate: p.signedAt,
        recipient: p.contactEmail,
        ctaUrl: p.stripeHostedUrl,
        ctx: { proposal: p, repName: repNameFor(p) },
      }, now, summary);
    }
  }

  return summary;
}
