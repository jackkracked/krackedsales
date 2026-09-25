import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ghlAppointments, proposals, trackerCallOutcomes, trackerCreditDecisions, trackerMonthCloses, trackerMonthSettings,
  trackerOverrides, trackerSettledRows, users,
} from "@/lib/db/schema";
import { editMonthSetting, type SettingsField } from "@/lib/tracker/settings";
import { loadCloses } from "@/lib/tracker/ledger-store";
import { linesToSettle, type MonthView } from "@/lib/tracker/settlement";
import { computeSetter } from "@/lib/tracker/setter";
import { getCloserMonth } from "@/lib/tracker/closer";
import { currentNyMonth, isMonthKey, isMonthOver, monthsBetween, nyMonth, nyMonthRange, TRACKER_GO_LIVE_MONTH } from "@/lib/tracker/months";

/**
 * Every write the pay tracker makes, with its permission rule next to it.
 *
 * THE ACCESS RULES (plan R9, as amended)
 * - A rep acts only on their OWN tracker. An admin acts on anyone's. Enforced here, from the
 *   session actor passed in by the route, never from anything the browser claims about itself.
 * - A CLOSED month is final. Nobody edits its numbers; a correction to one of its rows lands in
 *   the next open month as a dated adjustment (lib/tracker/settlement.ts).
 * - The closer who ran a call may record whether it happened. So may an admin. The setter paid
 *   on it may too, but that is flagged "self-reported" everywhere it shows (plan B1).
 * Every write records who made it and when.
 */

export interface Actor { id: string; role: string; ghlUserId: string | null }

export class TrackerError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const isAdmin = (a: Actor) => a.role === "admin";

function mustActFor(actor: Actor, subjectUserId: string) {
  if (actor.id !== subjectUserId && !isAdmin(actor)) {
    throw new TrackerError(403, "You can only change your own tracker");
  }
}

async function mustBeOpenMonth(month: string) {
  if (!isMonthKey(month)) throw new TrackerError(400, "month must be YYYY-MM");
  if (month < TRACKER_GO_LIVE_MONTH) throw new TrackerError(409, "Months before the tracker went live were paid from the spreadsheet and cannot be changed here");
  if (month > currentNyMonth()) throw new TrackerError(409, "That month has not started yet");
  const closes = await loadCloses();
  if (closes.has(month)) throw new TrackerError(409, `${month} is closed. Corrections go in the current month.`);
}

// ── Did the call happen ───────────────────────────────────────────────────────────────────────

export async function recordOutcome(actor: Actor, input: { rowRef: string; outcome: "held" | "no_show" }) {
  if (input.outcome !== "held" && input.outcome !== "no_show") throw new TrackerError(400, "outcome must be held or no_show");
  await assertWriteBudget(actor.id);

  let start: Date;
  let rowKey: string;
  let allowed = isAdmin(actor);
  if (input.rowRef.startsWith("m:")) {
    const manualRowId = mustBeUuid(input.rowRef.slice(2));
    const [claim] = await db().select().from(trackerCreditDecisions)
      .where(eq(trackerCreditDecisions.manualRowId, manualRowId)).limit(1);
    if (!claim?.callAt) throw new TrackerError(404, "No such booking");
    start = claim.callAt;
    rowKey = input.rowRef;
  } else {
    if (!/^[\w-]{1,64}$/.test(input.rowRef)) throw new TrackerError(400, "Unknown appointment");
    const [appt] = await db().select().from(ghlAppointments).where(eq(ghlAppointments.id, input.rowRef)).limit(1);
    if (!appt) throw new TrackerError(404, "No such appointment");
    start = appt.startTime;
    rowKey = `b:${appt.id}`;
    // The closer who ran it.
    allowed ||= !!actor.ghlUserId && appt.assignedUserId === actor.ghlUserId;
  }
  // A setter only for a row on her own LIVE sheet (credited, suggested, or her own claim). Not
  // a row she was rejected from, and never a rival's (H3). What she records is flagged
  // self-reported on every sheet, because only the closer or an admin is proof.
  if (!allowed && actor.role === "setter") {
    const { ledger } = await computeSetter(actor.id);
    allowed = ledger.rows.some((r) => r.rowKey === rowKey);
  }
  if (!allowed) throw new TrackerError(403, "Only the closer who ran this call, the setter on it, or an admin can record it");
  if (start.getTime() > Date.now()) throw new TrackerError(409, "This call has not happened yet");
  await mustBeOpenMonthForRep(actor, nyMonth(start));

  await db().insert(trackerCallOutcomes).values({
    rowRef: input.rowRef, outcome: input.outcome, forStartTime: start, recordedBy: actor.id,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function mustBeUuid(v: string | undefined): string {
  if (!v || !UUID_RE.test(v)) throw new TrackerError(400, "Unknown booking");
  return v;
}

/**
 * A person's writes per minute, across every tracker table. These tables are append-only (the
 * history IS the audit trail), so an unbounded writer could make every tracker slow to open and
 * push month close past its time limit. 60 a minute is far above any human pace.
 */
const WRITES_PER_MINUTE = 60;
async function assertWriteBudget(actorId: string) {
  const since = new Date(Date.now() - 60_000);
  const [[a], [b], [c]] = await Promise.all([
    db().select({ n: sql<number>`count(*)::int` }).from(trackerOverrides).where(and(eq(trackerOverrides.editedBy, actorId), gte(trackerOverrides.editedAt, since))),
    db().select({ n: sql<number>`count(*)::int` }).from(trackerCallOutcomes).where(and(eq(trackerCallOutcomes.recordedBy, actorId), gte(trackerCallOutcomes.recordedAt, since))),
    db().select({ n: sql<number>`count(*)::int` }).from(trackerCreditDecisions).where(and(eq(trackerCreditDecisions.decidedBy, actorId), gte(trackerCreditDecisions.decidedAt, since))),
  ]);
  if ((a?.n ?? 0) + (b?.n ?? 0) + (c?.n ?? 0) >= WRITES_PER_MINUTE) {
    throw new TrackerError(429, "That is a lot of changes at once. Wait a minute and try again.");
  }
}

// ── Whose booking is it ───────────────────────────────────────────────────────────────────────

export async function decideCredit(actor: Actor, input: { appointmentId?: string; manualRowId?: string; setterUserId: string; decision: "claim" | "reject" }) {
  if (input.decision !== "claim" && input.decision !== "reject") throw new TrackerError(400, "decision must be claim or reject");
  if (!input.appointmentId === !input.manualRowId) throw new TrackerError(400, "Give exactly one of appointmentId or manualRowId");
  if (input.manualRowId) mustBeUuid(input.manualRowId);
  if (input.appointmentId && !/^[\w-]{1,64}$/.test(input.appointmentId)) throw new TrackerError(400, "Unknown appointment");
  await assertWriteBudget(actor.id);
  // A rep decides only for themselves. An admin may decide for anyone: that is how a clash
  // between two setters is settled.
  mustActFor(actor, input.setterUserId);

  const [setter] = await db().select({ role: users.role }).from(users).where(eq(users.id, input.setterUserId)).limit(1);
  if (!setter) throw new TrackerError(404, "No such person");
  if (input.decision === "claim" && setter.role !== "setter") throw new TrackerError(409, "Only setters earn a booking bonus");

  if (input.appointmentId) {
    const [appt] = await db().select({ id: ghlAppointments.id, start: ghlAppointments.startTime }).from(ghlAppointments).where(eq(ghlAppointments.id, input.appointmentId)).limit(1);
    if (!appt) throw new TrackerError(404, "No such appointment");
    // A claim on a closed month's call would pay as an adjustment: reps cannot reach back.
    await mustBeOpenMonthForRep(actor, nyMonth(appt.start));
    await db().insert(trackerCreditDecisions).values({
      appointmentId: input.appointmentId, setterUserId: input.setterUserId, decision: input.decision, decidedBy: actor.id,
    });
    return;
  }

  // A manual row: carry its details forward so the latest decision is self-contained.
  const [prev] = await db().select().from(trackerCreditDecisions)
    .where(eq(trackerCreditDecisions.manualRowId, input.manualRowId!))
    .orderBy(desc(trackerCreditDecisions.decidedAt)).limit(1);
  if (!prev) throw new TrackerError(404, "No such booking");
  if (prev.setterUserId !== input.setterUserId) throw new TrackerError(409, "That booking belongs to someone else");
  if (prev.callAt) await mustBeOpenMonthForRep(actor, nyMonth(prev.callAt));
  await db().insert(trackerCreditDecisions).values({
    manualRowId: input.manualRowId, setterUserId: input.setterUserId, decision: input.decision,
    contactId: prev.contactId, contactName: prev.contactName, companyName: prev.companyName,
    bookedAt: prev.bookedAt, callAt: prev.callAt, decidedBy: actor.id,
  });
}

/** Reps may not touch a closed month's money; admins may, and it becomes an adjustment. */
async function mustBeOpenMonthForRep(actor: Actor, month: string) {
  if (isAdmin(actor)) return;
  await mustBeOpenMonth(month);
}

const DAY_MS = 86_400_000;

export async function addManualBooking(actor: Actor, input: {
  setterUserId: string;
  contactId: string | null;
  contactName: string;
  companyName: string | null;
  bookedAt: string | null;
  callAt: string;
  appointmentId?: string | null;
}) {
  mustActFor(actor, input.setterUserId);
  const [setter] = await db().select({ role: users.role }).from(users).where(eq(users.id, input.setterUserId)).limit(1);
  if (!setter || setter.role !== "setter") throw new TrackerError(409, "Only setters earn a booking bonus");

  // The call is on a real appointment: claim THAT, so cancellations and outcomes follow it.
  if (input.appointmentId) {
    return decideCredit(actor, { appointmentId: input.appointmentId, setterUserId: input.setterUserId, decision: "claim" });
  }

  const callAt = new Date(input.callAt);
  const bookedAt = input.bookedAt ? new Date(input.bookedAt) : null;
  if (Number.isNaN(callAt.getTime())) throw new TrackerError(400, "callAt must be a date");
  if (bookedAt && Number.isNaN(bookedAt.getTime())) throw new TrackerError(400, "bookedAt must be a date");
  if (bookedAt && bookedAt.getTime() > callAt.getTime() + DAY_MS) throw new TrackerError(400, "A call cannot be booked after it happens");
  const name = input.contactName.trim().slice(0, 200);
  if (!name) throw new TrackerError(400, "Who was the call with?");
  await mustBeOpenMonthForRep(actor, nyMonth(callAt));

  // One call must never exist twice (plan: a manual row never shadows a real appointment).
  if (input.contactId) {
    const near = await db().select({ id: ghlAppointments.id }).from(ghlAppointments).where(and(
      eq(ghlAppointments.contactId, input.contactId),
      gte(ghlAppointments.startTime, new Date(callAt.getTime() - DAY_MS)),
      lte(ghlAppointments.startTime, new Date(callAt.getTime() + DAY_MS)),
    )).limit(1);
    if (near.length) throw new TrackerError(409, "This call is already in GoHighLevel. Pick it from the list instead, so cancellations and outcomes follow it.");
  }

  await assertWriteBudget(actor.id);
  const manualRowId = randomUUID();
  await db().insert(trackerCreditDecisions).values({
    manualRowId, setterUserId: input.setterUserId, decision: "claim",
    contactId: input.contactId, contactName: name, companyName: input.companyName?.trim().slice(0, 200) || null,
    bookedAt, callAt, decidedBy: actor.id,
  });
  return { manualRowId };
}

/**
 * The row must be on the subject's OWN sheet. Without this, a setter could type an outcome onto
 * a rival's call for the same prospect and quietly restore her own no-show from a row she never
 * sees (security review H1). Worked out by the same engine that draws the page.
 */
async function mustBeSubjectsRow(subjectUserId: string, rowKey: string) {
  const [subject] = await db().select({ role: users.role }).from(users).where(eq(users.id, subjectUserId)).limit(1);
  if (!subject) throw new TrackerError(404, "No such person");
  if (rowKey.startsWith("p:")) {
    const id = mustBeUuid(rowKey.slice(2));
    const [p] = await db().select({ id: proposals.id }).from(proposals)
      .where(and(eq(proposals.id, id), sql`coalesce(${proposals.closedBy}, ${proposals.createdBy}) = ${subjectUserId}`)).limit(1);
    if (!p) throw new TrackerError(403, "That deal is not on this tracker");
    return;
  }
  if (subject.role !== "setter") throw new TrackerError(403, "That booking is not on this tracker");
  if (rowKey.startsWith("m:")) mustBeUuid(rowKey.slice(2));
  const { ledger } = await computeSetter(subjectUserId);
  if (!ledger.rows.some((r) => r.rowKey === rowKey)) throw new TrackerError(403, "That booking is not on this tracker");
}

// ── Cell overrides and notes ──────────────────────────────────────────────────────────────────

/** Fields a person may type over. Money fields are checked against closed months. */
const TEXT_FIELDS = new Set(["company", "contactName", "closer", "notes"]);
const DATE_FIELDS = new Set(["bookedAt", "callAt"]);

async function rowMonth(rowKey: string): Promise<string | null> {
  if (rowKey.startsWith("b:")) {
    const [a] = await db().select({ start: ghlAppointments.startTime }).from(ghlAppointments).where(eq(ghlAppointments.id, rowKey.slice(2))).limit(1);
    return a ? nyMonth(a.start) : null;
  }
  if (rowKey.startsWith("m:")) {
    const [m] = await db().select({ callAt: trackerCreditDecisions.callAt }).from(trackerCreditDecisions).where(eq(trackerCreditDecisions.manualRowId, rowKey.slice(2))).limit(1);
    return m?.callAt ? nyMonth(m.callAt) : null;
  }
  return null;
}

export async function setOverride(actor: Actor, input: { subjectUserId: string; rowKey: string; field: string; value: unknown }) {
  mustActFor(actor, input.subjectUserId);
  const { rowKey, field } = input;
  if (!/^(b|m|p):[\w-]{1,80}$/.test(rowKey)) throw new TrackerError(400, "Unknown row");
  await assertWriteBudget(actor.id);
  await mustBeSubjectsRow(input.subjectUserId, rowKey);
  let value: unknown = input.value;

  if (value === null) {
    // Clearing restores the automatic value. Still recorded, so the history shows it.
  } else if (TEXT_FIELDS.has(field)) {
    if (typeof value !== "string") throw new TrackerError(400, `${field} must be text`);
    value = value.trim().slice(0, field === "notes" ? 2000 : 200);
  } else if (DATE_FIELDS.has(field)) {
    if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) throw new TrackerError(400, `${field} must be a date`);
    value = new Date(value).toISOString();
  } else if (field === "outcome") {
    if (!["held", "no_show", "cancelled"].includes(value as string)) throw new TrackerError(400, "outcome must be held, no_show or cancelled");
  } else if (field === "bonus" || /^commission@\d{4}-(0[1-9]|1[0-2])$/.test(field)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10_000_000) {
      throw new TrackerError(400, "Amounts are whole cents between 0 and 100,000 dollars");
    }
  } else {
    throw new TrackerError(400, "That cell cannot be edited");
  }

  // Money cells in a closed month are final for reps. The month is worked out HERE, from the
  // row itself, never taken from the request.
  const moneyField = field === "outcome" || field === "bonus" || field === "callAt" || field.startsWith("commission@");
  if (moneyField) {
    const month = field.startsWith("commission@") ? field.slice("commission@".length) : await rowMonth(rowKey);
    if (!month) throw new TrackerError(404, "No such row");
    await mustBeOpenMonthForRep(actor, month);
    if (field === "callAt" && typeof value === "string") await mustBeOpenMonthForRep(actor, nyMonth(new Date(value)));
  }

  await db().insert(trackerOverrides).values({
    subjectUserId: input.subjectUserId, rowKey, field, value: value as never, editedBy: actor.id,
  });
}

// ── The three numbers at the top of a month ──────────────────────────────────────────────────

export async function setMonthSetting(actor: Actor, input: { userId: string; month: string; field: SettingsField; value: number | null }) {
  mustActFor(actor, input.userId);
  await mustBeOpenMonth(input.month);
  const { field, value } = input;
  if (field === "basePayCents") {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 10_000_000)) throw new TrackerError(400, "Base pay is whole cents between 0 and 100,000 dollars");
  } else if (field === "bookingBonusCents") {
    if (value === null || !Number.isInteger(value) || value < 0 || value > 100_000) throw new TrackerError(400, "Booking bonus is whole cents between 0 and 1,000 dollars");
  } else if (field === "commissionPct") {
    if (value === null || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new TrackerError(400, "Commission is a percentage between 0 and 100");
  } else {
    throw new TrackerError(400, "Unknown setting");
  }
  return editMonthSetting({ userId: input.userId, month: input.month, field, value, actorId: actor.id });
}

// ── Month close ──────────────────────────────────────────────────────────────────────────────

/** The month an admin should close next, or null when nothing is due. */
export async function nextMonthToClose(now: Date = new Date()): Promise<string | null> {
  const closes = await loadCloses();
  const current = currentNyMonth(now);
  return monthsBetween(TRACKER_GO_LIVE_MONTH, current).find((m) => !closes.has(m) && isMonthOver(m, now)) ?? null;
}

export async function closeMonth(actor: Actor, month: string, now: Date = new Date()) {
  if (!isAdmin(actor)) throw new TrackerError(403, "Only an admin can close a month");
  const due = await nextMonthToClose(now);
  if (!due) throw new TrackerError(409, "There is no finished month waiting to be closed");
  if (month !== due) throw new TrackerError(409, `Close ${due} first: months close in order`);

  // Everyone who could be paid: every setter and every closer, active or not (someone who left
  // mid-month is still owed that month).
  const people = await db().select({ id: users.id, role: users.role }).from(users);
  const rows: Array<typeof trackerSettledRows.$inferInsert> = [];
  for (const p of people) {
    let view: MonthView | undefined;
    if (p.role === "setter") {
      view = (await computeSetter(p.id, now)).views.get(month);
    } else {
      const holder: { views?: Map<string, MonthView> } = {};
      await getCloserMonth(p.id, month, now, { viewsOnly: holder });
      view = holder.views?.get(month);
    }
    if (!view) continue;
    for (const l of linesToSettle(view)) {
      const line = view.lines.find((x) => x.key === l.key);
      rows.push({
        userId: p.id, rowKey: l.key, rowRef: l.rowKey, settledInMonth: month,
        bonusCents: line?.kind === "commission" ? 0 : l.cents,
        commissionCents: line?.kind === "commission" ? l.cents : 0,
      });
    }
  }

  // One atomic batch. The close row goes first: if another admin closed it a moment ago, its
  // primary key fails and nothing from this attempt is written.
  const database = db();
  const statements = [
    database.insert(trackerMonthCloses).values({ month, closedBy: actor.id }),
    ...Array.from({ length: Math.ceil(rows.length / 200) }, (_, i) =>
      database.insert(trackerSettledRows).values(rows.slice(i * 200, i * 200 + 200))),
  ];
  try {
    await database.batch(statements as [typeof statements[0], ...typeof statements]);
  } catch (err) {
    const closes = await loadCloses();
    if (closes.has(month)) throw new TrackerError(409, `${month} was just closed by someone else`);
    throw err;
  }
  return { month, settledLines: rows.length };
}

/**
 * What an admin should look at before freezing a month: every pay number a rep changed on THEIR
 * OWN sheet, and every call outcome a setter recorded herself. Jack chose to let reps edit their
 * own numbers (2026-09-25); this is the check that goes with that trust, shown at the one moment
 * it matters.
 */
export async function closeReviewFor(month: string): Promise<string[]> {
  const { start, end } = nyMonthRange(month);
  const people = await db().select({ id: users.id, name: users.name, role: users.role }).from(users);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";
  const lines: string[] = [];

  const settings = await db().select().from(trackerMonthSettings).where(eq(trackerMonthSettings.month, month));
  const LABEL: Record<string, string> = { basePayCents: "base pay", bookingBonusCents: "booking bonus", commissionPct: "commission rate" };
  for (const r of settings) {
    if (r.editedBy !== r.userId || r.editedFields.length === 0) continue;
    lines.push(`${name(r.userId)} changed their own ${r.editedFields.map((f) => LABEL[f] ?? f).join(" and ")}`);
  }

  const MONEY = ["bonus", "outcome", "callAt", `commission@${month}`];
  const ovs = await db().select().from(trackerOverrides).where(and(
    inArray(trackerOverrides.field, MONEY), gte(trackerOverrides.editedAt, start),
  ));
  const selfEdits = new Map<string, number>();
  for (const o of ovs) if (o.editedBy === o.subjectUserId) selfEdits.set(o.editedBy, (selfEdits.get(o.editedBy) ?? 0) + 1);
  for (const [id, n] of selfEdits) lines.push(`${name(id)} corrected ${n} pay ${n === 1 ? "cell" : "cells"} on their own sheet`);

  const setterIds = new Set(people.filter((p) => p.role === "setter").map((p) => p.id));
  const outs = await db().select().from(trackerCallOutcomes).where(and(gte(trackerCallOutcomes.forStartTime, start), lt(trackerCallOutcomes.forStartTime, end)));
  const selfOutcomes = new Map<string, number>();
  for (const o of outs) if (setterIds.has(o.recordedBy)) selfOutcomes.set(o.recordedBy, (selfOutcomes.get(o.recordedBy) ?? 0) + 1);
  for (const [id, n] of selfOutcomes) lines.push(`${name(id)} marked ${n} ${n === 1 ? "call" : "calls"} as happened or not, instead of the closer`);
  return lines;
}
