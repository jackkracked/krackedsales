import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposalCreditChanges, proposals, users } from "@/lib/db/schema";
import { acquireJobLock, releaseJobLock } from "@/lib/jobs/lock";
import { loadSetterFacts } from "@/lib/tracker/facts";
import { buildSetterLedger, type ProposalSetter } from "@/lib/tracker/setter-rules";

/**
 * Who is credited on a proposal: the CLOSER and the SETTER. Plan: tasks/proposal-roles-plan.md.
 *
 * ONE SOURCE OF TRUTH
 * Every pay, KPI, leaderboard, Today and notification surface reads the closer through
 * `closerSql` and the setter through the Pay Tracker's ledger, which honours an admin's assignment
 * here and falls back to the booking rule otherwise. A number cannot credit one person on one
 * screen and someone else on another.
 */

/** The closer, in SQL. NULL `closed_by` means nobody has said otherwise: whoever created it. */
export const closerSql = sql`coalesce(${proposals.closedBy}, ${proposals.createdBy})`;

/** Who may be picked. Role-restricted so a person is always paid on the sheet month close
 *  computes for them (review B2). Admins close deals (Gage), so they are closers too. */
export const CLOSER_ROLES = ["closer", "admin", "rep"] as const;
export const SETTER_ROLES = ["setter"] as const;

/** Month close and credit changes never interleave (review B3): both take this one lock. */
export const PAY_LEDGER_LOCK = "pay-ledger";

export interface CreditView {
  closer: {
    userId: string | null;
    /** Nobody has confirmed it; it is the creator by default. */
    suggested: boolean;
    reason: "created it" | "confirmed" | "assigned";
    confirmedBy: string | null;
    confirmedAt: Date | null;
  };
  setter: {
    mode: "assigned" | "none" | "suggested";
    /** Assigned: one. Suggested: whoever the booking credits (2+ = two people claim it). */
    userIds: string[];
    /** Suggested only. "credited" = the booking is proven; "suggested" = still a guess; "clash". */
    state: "credited" | "suggested" | "clash" | null;
    bookedAt: Date | null;
    confirmedBy: string | null;
    confirmedAt: Date | null;
  };
}

/** Credit for many proposals at once. The setter answer comes from the SAME ledger that pays. */
export async function getProposalCredits(ids?: string[]): Promise<Map<string, CreditView>> {
  const rows = await db()
    .select({
      id: proposals.id, createdBy: proposals.createdBy, closedBy: proposals.closedBy,
      closerConfirmedBy: proposals.closerConfirmedBy, closerConfirmedAt: proposals.closerConfirmedAt,
      setterMode: proposals.setterMode, setterUserId: proposals.setterUserId,
      setterConfirmedBy: proposals.setterConfirmedBy, setterConfirmedAt: proposals.setterConfirmedAt,
    })
    .from(proposals)
    .where(ids && ids.length ? inArray(proposals.id, ids) : sql`true`);

  // The booking rule does not depend on WHOSE sheet it is, so any id reads the same answer.
  const { facts } = await loadSetterFacts("00000000-0000-0000-0000-000000000000");
  const setters: Map<string, ProposalSetter> = buildSetterLedger(facts).proposalSetters;

  const out = new Map<string, CreditView>();
  for (const r of rows) {
    const confirmedCloser = !!r.closerConfirmedAt;
    const ps = setters.get(r.id);
    const mode = r.setterMode === "assigned" || r.setterMode === "none" ? r.setterMode : "suggested";
    out.set(r.id, {
      closer: {
        userId: r.closedBy ?? r.createdBy,
        suggested: !confirmedCloser,
        reason: !confirmedCloser ? "created it" : r.closedBy && r.closedBy !== r.createdBy ? "assigned" : "confirmed",
        confirmedBy: r.closerConfirmedBy, confirmedAt: r.closerConfirmedAt,
      },
      setter: {
        mode,
        userIds: mode === "assigned" ? (r.setterUserId ? [r.setterUserId] : []) : mode === "none" ? [] : ps?.setterIds ?? [],
        state: mode === "suggested" ? ps?.state ?? null : null,
        bookedAt: mode === "suggested" ? ps?.bookedAt ?? null : null,
        confirmedBy: r.setterConfirmedBy, confirmedAt: r.setterConfirmedAt,
      },
    });
  }
  return out;
}

// ── Writes ───────────────────────────────────────────────────────────────────────────────────

export class CreditError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** What to do. The same change applies to every proposal in the request. */
export type CreditChange =
  | { field: "closer"; action: "assign"; userId: string }
  | { field: "closer"; action: "confirm" }
  | { field: "setter"; action: "assign"; userId: string }
  | { field: "setter"; action: "none" }
  | { field: "setter"; action: "confirm" };

/** One proposal, with the credit the admin was LOOKING AT for it (compare-and-set, review S4). */
export interface CreditItem {
  proposalId: string;
  /** Closer changes: the closer's user id as shown. */
  expectedCloser?: string | null;
  /** Setter changes: the setter mode and ids as shown. */
  expectedSetter?: { mode: string; userIds: string[] };
}

export interface CreditResult { proposalId: string; ok: boolean; reason?: string }

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Apply one change to many proposals. Admin-only; the route checks the session, this re-checks.
 *
 * COMPARE-AND-SET (review S4): each proposal is only changed if its credit is still what the
 * admin saw. A suggestion can move when a booking is confirmed elsewhere; confirming the old one
 * would pay the wrong person. Such rows are skipped and reported, never forced.
 */
export async function setCredit(
  actor: { id: string; role: string },
  items: CreditItem[],
  change: CreditChange,
): Promise<CreditResult[]> {
  if (actor.role !== "admin") throw new CreditError(403, "Only an admin can change who is credited");
  const expectedFor = new Map(items.map((i) => [i.proposalId, i]));
  const ids = [...new Set(items.map((i) => i.proposalId))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) throw new CreditError(400, "Pick at least one proposal");
  if (ids.length > 500) throw new CreditError(400, "Up to 500 proposals at a time");

  // The person being credited must exist, be active, and hold a role that is paid on the
  // matching sheet. Checked here, not only in the picker.
  if (change.action === "assign") {
    const [u] = await db().select({ role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, change.userId)).limit(1);
    if (!u) throw new CreditError(404, "No such person");
    if (!u.isActive) throw new CreditError(409, "That person is not active");
    const allowed: readonly string[] = change.field === "closer" ? CLOSER_ROLES : SETTER_ROLES;
    if (!allowed.includes(u.role)) {
      throw new CreditError(409, change.field === "closer" ? "Only closers and admins can be the closer" : "Only setters can be the setter");
    }
  }

  if (!(await acquireJobLock(PAY_LEDGER_LOCK, 120))) {
    throw new CreditError(409, "Pay for a month is being closed right now. Try again in a minute.");
  }
  try {
    const current = await getProposalCredits(ids);
    const now = new Date();
    const results: CreditResult[] = [];
    const statements = [];
    const database = db();

    for (const id of ids) {
      const c = current.get(id);
      if (!c) { results.push({ proposalId: id, ok: false, reason: "Not found" }); continue; }

      const seen = expectedFor.get(id);
      if (change.field === "closer") {
        if (!seen || seen.expectedCloser === undefined || c.closer.userId !== seen.expectedCloser) {
          results.push({ proposalId: id, ok: false, reason: "The closer changed since you looked" });
          continue;
        }
        const to = change.action === "assign" ? change.userId : c.closer.userId;
        if (!to) { results.push({ proposalId: id, ok: false, reason: "No closer to confirm" }); continue; }
        if (change.action === "confirm" && !c.closer.suggested) { results.push({ proposalId: id, ok: true }); continue; }
        statements.push(
          database.update(proposals).set({ closedBy: to, closerConfirmedBy: actor.id, closerConfirmedAt: now }).where(eq(proposals.id, id)),
          database.insert(proposalCreditChanges).values({
            proposalId: id, field: "closer", fromUserId: c.closer.userId, toUserId: to,
            action: change.action, changedBy: actor.id, changedAt: now,
          }),
        );
        results.push({ proposalId: id, ok: true });
        continue;
      }

      // Setter.
      const exp = seen?.expectedSetter;
      if (!exp || c.setter.mode !== exp.mode || !sameSet(c.setter.userIds, exp.userIds)) {
        results.push({ proposalId: id, ok: false, reason: "The setter changed since you looked" });
        continue;
      }
      let toMode: "assigned" | "none";
      let toUser: string | null;
      if (change.action === "assign") { toMode = "assigned"; toUser = change.userId; }
      else if (change.action === "none") { toMode = "none"; toUser = null; }
      else {
        // Confirm what is there. Two people claiming the booking is a decision, not a confirm.
        if (c.setter.mode !== "suggested") { results.push({ proposalId: id, ok: true }); continue; }
        if (c.setter.state === "clash" || c.setter.userIds.length > 1) {
          results.push({ proposalId: id, ok: false, reason: "Two setters claim this booking: pick one" });
          continue;
        }
        toMode = c.setter.userIds.length ? "assigned" : "none";
        toUser = c.setter.userIds[0] ?? null;
      }
      statements.push(
        database.update(proposals).set({
          setterMode: toMode, setterUserId: toUser, setterConfirmedBy: actor.id, setterConfirmedAt: now,
        }).where(eq(proposals.id, id)),
        database.insert(proposalCreditChanges).values({
          proposalId: id, field: "setter",
          fromUserId: c.setter.userIds.length === 1 ? c.setter.userIds[0] : null, toUserId: toUser,
          fromMode: c.setter.mode, toMode, action: change.action, changedBy: actor.id, changedAt: now,
        }),
      );
      results.push({ proposalId: id, ok: true });
    }

    // Every update and its audit row land together, or not at all.
    if (statements.length) await database.batch(statements as [typeof statements[0], ...typeof statements]);
    return results;
  } finally {
    await releaseJobLock(PAY_LEDGER_LOCK, { status: "ok", detail: "credit change" }).catch(() => {});
  }
}

/** The audit trail for one proposal, newest first. */
export async function creditHistory(proposalId: string) {
  return db().select().from(proposalCreditChanges)
    .where(and(eq(proposalCreditChanges.proposalId, proposalId)))
    .orderBy(sql`${proposalCreditChanges.changedAt} desc`)
    .limit(50);
}

/** The closer of a proposal row, the same rule as `closerSql`. */
export function closerIdOf(p: { closedBy?: string | null; createdBy?: string | null }): string | null {
  return p.closedBy ?? p.createdBy ?? null;
}

/**
 * Who should RECEIVE work or messages about a deal: its closer, unless the closer has left, in
 * which case whoever created it (review S7). Credit and pay never use this: someone who left is
 * still owed and still credited. Only routing falls back.
 */
export async function routeToCloser(p: { closedBy?: string | null; createdBy?: string | null }): Promise<string | null> {
  const closer = closerIdOf(p);
  if (!closer) return null;
  if (!p.closedBy || p.closedBy === p.createdBy) return closer;
  const [u] = await db().select({ isActive: users.isActive }).from(users).where(eq(users.id, closer)).limit(1);
  return u?.isActive ? closer : p.createdBy ?? closer;
}

/**
 * Signed deals each SETTER is firmly credited with in [start, end] (by signature date): an admin's
 * assignment, or a proven booking. An unconfirmed owner-guess is NOT counted, so this number only
 * ever moves when credit is real. Shared by the leaderboard and its drill-down so the list under
 * a number always matches it.
 */
export async function dealsSetBy(start: Date | null, end: Date): Promise<Map<string, Array<{ id: string; contactName: string; title: string; totalAmount: number; signedAt: Date; status: string }>>> {
  const signed = await db()
    .select({ id: proposals.id, contactName: proposals.contactName, title: proposals.title, totalAmount: proposals.totalAmount, signedAt: proposals.signedAt, status: proposals.status })
    .from(proposals)
    .where(start
      ? and(sql`${proposals.signedAt} >= ${start}`, sql`${proposals.signedAt} <= ${end}`)
      : sql`${proposals.signedAt} is not null and ${proposals.signedAt} <= ${end}`);
  const out = new Map<string, Array<{ id: string; contactName: string; title: string; totalAmount: number; signedAt: Date; status: string }>>();
  if (signed.length === 0) return out;
  const credits = await getProposalCredits(signed.map((s) => s.id));
  for (const s of signed) {
    const c = credits.get(s.id)?.setter;
    if (!c || c.userIds.length !== 1) continue;
    const firm = c.mode === "assigned" || (c.mode === "suggested" && c.state === "credited");
    if (!firm) continue;
    const list = out.get(c.userIds[0]) ?? [];
    list.push({ ...s, signedAt: s.signedAt! });
    out.set(c.userIds[0], list);
  }
  return out;
}
