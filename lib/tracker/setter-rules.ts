/**
 * The setter's pay rules, as a PURE function: facts in, rows and money out. No database, no
 * clock except the `now` passed in. scripts/prove-setter-tracker.ts proves every rule below.
 *
 * THE ONE PRINCIPLE: never guess. Every dollar is PAID (proven by data or confirmed by a
 * person) or PENDING (shown, labelled, never inside the total). Rules are in
 * tasks/setter-tracker-plan.md; the letters (R, B, S) refer to it.
 */
import { nyMonth, TRACKER_GO_LIVE_MONTH } from "@/lib/tracker/months";

// ── Facts ─────────────────────────────────────────────────────────────────────────────────────

export interface Appointment {
  id: string;
  contactId: string | null;
  calendarName: string | null;
  assignedUserId: string | null;
  createdByUserId: string | null;
  dateAdded: Date | null;
  startTime: Date;
  status: string;
  deletedAt: Date | null;
  movedToCalendarId: string | null;
}

export interface TrackedLink { appointmentId: string; sentByUserId: string | null; delivery: string }

export interface Person { id: string; name: string; role: string; ghlUserId: string | null }

export interface Opportunity { contactId: string; assignedTo: string | null; status: string | null; deleted: boolean }

export interface CreditDecision {
  appointmentId: string | null;
  manualRowId: string | null;
  setterUserId: string;
  decision: "claim" | "reject";
  contactId: string | null;
  contactName: string | null;
  companyName: string | null;
  bookedAt: Date | null;
  callAt: Date | null;
  decidedBy: string;
  decidedAt: Date;
}

export interface TrackerOutcome { rowRef: string; outcome: "held" | "no_show"; forStartTime: Date; recordedBy: string; recordedAt: Date }

export interface Disposition { eventId: string; outcome: string; at: Date; createdByUserId: string | null }

export interface ContactInfo { contactId: string; name: string | null; company: string | null }

export interface ProposalFact {
  id: string;
  contactId: string;
  title: string;
  totalAmount: number;
  sentAt: Date | null;
  signedAt: Date | null;
  paidAt: Date | null;
  lostAt: Date | null;
  /** Set on the proposal by an admin (0065). NULL = let the booking rule decide, as always. */
  setterMode?: "assigned" | "none" | null;
  setterUserId?: string | null;
}

/** A commission event at 100%, i.e. `commission` is the base amount the rate applies to. */
export interface BaseCommissionEvent { proposalId: string; date: Date; baseAmount: number; sublabel?: string }

export interface Override { rowKey: string; field: string; value: unknown; editedBy: string; editedAt: Date }

export interface SetterFacts {
  setterId: string;
  now: Date;
  appointments: Appointment[];
  links: TrackedLink[];
  people: Person[];
  opportunities: Opportunity[];
  decisions: CreditDecision[];
  trackerOutcomes: TrackerOutcome[];
  dispositions: Disposition[];
  contacts: ContactInfo[];
  proposals: ProposalFact[];
  commissionEvents: BaseCommissionEvent[];
  /** This setter's own cell overrides: notes, names, bonus, commission. */
  overrides: Override[];
  /** Facts about a CALL, from anyone allowed to correct it: `outcome` and `callAt`. They decide
   *  restorations and clashes on other people's rows too, so they are never per-person. */
  rowOverrides: Override[];
  /** Booking bonus in cents and commission % for a month, from the month settings. */
  bonusCentsFor: (month: string) => number;
  commissionPctFor: (month: string) => number;
}

// ── Output ────────────────────────────────────────────────────────────────────────────────────

export type Outcome = "upcoming" | "awaiting" | "held" | "no_show" | "cancelled" | "moved" | "not_applicable";

export type CreditState = "credited" | "suggested" | "clash";
export type CreditSource = "link" | "in_app" | "ghl_manual" | "owner" | "manual" | "assigned";

/** What happened to this row's $25, in words the screen can print. */
export type BonusState =
  | "deal_only"        // a deal an admin assigned to this setter: commission, no booking bonus
  | "paid"             // held, credited
  | "pending"          // upcoming / awaiting outcome / credit not confirmed / clash
  | "cancelled"        // −bonus
  | "moved"            // moved off a booked-call calendar: not a booked call any more
  | "no_show_waiting"  // −bonus, stays open until a rebook shows or the deal is lost
  | "never_rebooked"   // −bonus, closed out
  | "restored"         // no-show whose bonus came back via a later rebook
  | "rebook_of"        // this appointment IS a rebook; its bonus was paid on the original
  | "superseded"       // a second no-show in a chain whose bonus is paid on the first
  | "before_tracker";  // call before go-live: paid from the spreadsheet

export interface MoneyEntry {
  /** Stable identity, used for month-close settlement. */
  key: string;
  rowKey: string;
  month: string;
  kind: "bonus" | "commission";
  cents: number;
  status: "paid" | "pending";
  label: string;
}

export interface OutcomeEvidence {
  source: "tracker" | "dashboard" | "override";
  by: string | null;
  at: Date;
  /** Written by the setter who is paid on it. Counts, but is never presented as proof. */
  selfReported: boolean;
}

export interface SetterRow {
  rowKey: string;
  appointmentId: string | null;
  manualRowId: string | null;
  contactId: string | null;
  company: string | null;
  contactName: string | null;
  calendarName: string | null;
  bookedAt: Date | null;
  callAt: Date;
  /** Month the row lives on: the month of the CALL (R1). */
  month: string;
  credit: { state: CreditState; source: CreditSource; clashWith: string[]; clashWithIds: string[]; bookedByName: string | null };
  outcome: Outcome;
  evidence: OutcomeEvidence | null;
  bonusState: BonusState;
  /** The bonus this row stands for (the rate in its month), for "−$25" displays. */
  bonusAtStake: number;
  /** Where a no-show's bonus was restored: the rebook's month and date. */
  restoredIn: { month: string; callAt: Date; appointmentId: string } | null;
  /** For a rebook: the original booking it paid out on. */
  rebookOf: { rowKey: string; callAt: Date } | null;
  closerName: string | null;
  proposal: { id: string; title: string; amount: number; sentAt: Date | null; paidAt: Date | null; state: string } | null;
  /** Cells a person has overridden: field → who/when/what it replaced. */
  overridden: Record<string, { by: string; at: Date; original: unknown }>;
  notes: string | null;
}

/** Who the booking rule (or an admin) credits as setter on each proposal. The proposals screen
 *  reads THIS, so the chip on a deal and the setter's pay are the same computation (review S5). */
export interface ProposalSetter {
  mode: "assigned" | "none" | "suggested";
  /** Assigned: the one setter. Suggested: every setter the booking credits (2+ = a clash). */
  setterIds: string[];
  /** Suggested only: is that booking's credit settled (credited) or still awaiting a person? */
  state: "credited" | "suggested" | "clash" | null;
  /** Suggested only: when the booking behind it was made. */
  bookedAt: Date | null;
}

export interface SetterLedger { rows: SetterRow[]; entries: MoneyEntry[]; proposalSetters: Map<string, ProposalSetter> }

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

const DISPOSITION_NO_SHOW = new Set(["no_show", "noshow", "rebooked"]);

function latestBy<T>(items: T[], at: (t: T) => Date): T | undefined {
  let best: T | undefined;
  for (const i of items) if (!best || at(i).getTime() > at(best).getTime()) best = i;
  return best;
}

/** Latest override per (row, field). An override whose value is null has been cleared. */
function overrideMap(overrides: Override[]): Map<string, Override> {
  const map = new Map<string, Override>();
  for (const o of overrides) {
    const k = `${o.rowKey}|${o.field}`;
    const prev = map.get(k);
    if (!prev || o.editedAt.getTime() > prev.editedAt.getTime()) map.set(k, o);
  }
  for (const [k, o] of map) if (o.value === null || o.value === undefined) map.delete(k);
  return map;
}

function proposalState(p: ProposalFact, asOf: Date): string {
  if (p.paidAt && p.paidAt <= asOf) return "Closed";
  if (p.lostAt && p.lostAt <= asOf) return "Lost";
  if (p.signedAt && p.signedAt <= asOf) return "Signed";
  if (p.sentAt && p.sentAt <= asOf) return "Sent";
  return "Draft";
}

// ── Outcome, R2 as amended by B1, B2, S5. Exported: the closer's nudges use the same judgement ─

/**
 * Did this call happen? First match wins: a person's override; cancelled/deleted; moved off a
 * booked-call calendar; not yet started; the latest outcome recorded for its CURRENT start time
 * (a rescheduled call re-opens, B2); otherwise awaiting. GoHighLevel's own status is never used
 * as proof (S5): nobody here marks attendance in GoHighLevel.
 */
export function resolveOutcome(o: {
  rowRef: string;
  start: Date;
  appt: Appointment | null;
  /**
   * Is this person's word PROOF for this call? Only the closer who ran it, or an admin. Anyone
   * else (the setter paid on it, a rival setter) counts but is flagged self-reported (B1, H3).
   * A null author is a disposition written before the tracker existed, so nobody had a motive.
   */
  authoritative: (userId: string | null) => boolean;
  override?: Override;
  trackerOutcomes: TrackerOutcome[];
  dispositions: Disposition[];
  now: Date;
}): { outcome: Outcome; evidence: OutcomeEvidence | null } {
  const { rowRef, start, appt, authoritative, override } = o;
  if (override && (override.value === "held" || override.value === "no_show" || override.value === "cancelled")) {
    return {
      outcome: override.value as Outcome,
      evidence: { source: "override", by: override.editedBy, at: override.editedAt, selfReported: !authoritative(override.editedBy) },
    };
  }
  if (appt?.deletedAt || appt?.status.toLowerCase() === "cancelled") return { outcome: "cancelled", evidence: null };
  if (appt?.movedToCalendarId) return { outcome: "moved", evidence: null };
  if (start.getTime() > o.now.getTime()) return { outcome: "upcoming", evidence: null };

  const candidates: Array<{ outcome: "held" | "no_show"; ev: OutcomeEvidence }> = [];
  for (const t of o.trackerOutcomes) {
    if (t.rowRef !== rowRef || t.forStartTime.getTime() !== start.getTime()) continue;
    candidates.push({ outcome: t.outcome, ev: { source: "tracker", by: t.recordedBy, at: t.recordedAt, selfReported: !authoritative(t.recordedBy) } });
  }
  if (appt) {
    for (const d of o.dispositions) {
      if (d.eventId !== appt.id || d.at.getTime() < start.getTime()) continue;
      candidates.push({
        outcome: DISPOSITION_NO_SHOW.has(d.outcome) ? "no_show" : "held",
        ev: { source: "dashboard", by: d.createdByUserId, at: d.at, selfReported: !authoritative(d.createdByUserId) },
      });
    }
  }
  const best = latestBy(candidates, (c) => c.ev.at);
  if (!best) return { outcome: "awaiting", evidence: null };
  return { outcome: best.outcome, evidence: best.ev };
}

// ── The rules ─────────────────────────────────────────────────────────────────────────────────

/** Internal: one booking of any setter on a contact, before it is filtered to our setter. */
interface Booking {
  rowKey: string;
  appointment: Appointment | null;
  manualRowId: string | null;
  contactId: string | null;
  contactName: string | null;
  company: string | null;
  bookedAt: Date | null;
  callAt: Date;
  outcome: Outcome;
  evidence: OutcomeEvidence | null;
  /** Setters whose credit on this booking is live (confirmed or derived, not rejected). */
  active: Set<string>;
  sources: Map<string, CreditSource>;
  /** Owner suggestion awaiting that setter's confirm. */
  suggested: string | null;
  /** Someone other than a setter booked it by hand in GoHighLevel (usually Gage, for her lead). */
  bookedByName: string | null;
  closerName: string | null;
}

export function buildSetterLedger(f: SetterFacts): SetterLedger {
  const peopleById = new Map(f.people.map((p) => [p.id, p]));
  const peopleByGhl = new Map(f.people.filter((p) => p.ghlUserId).map((p) => [p.ghlUserId!, p]));
  const isSetter = (id: string | null | undefined) => !!id && peopleById.get(id)?.role === "setter";
  const contactsById = new Map(f.contacts.map((c) => [c.contactId, c]));
  const overrides = overrideMap(f.overrides);
  const rowOverrides = overrideMap(f.rowOverrides);
  // Outcome and call time are facts about the CALL (anyone's correction applies to everyone);
  // everything else is this setter's own sheet.
  const ov = (rowKey: string, field: string) =>
    field === "outcome" || field === "callAt" ? rowOverrides.get(`${rowKey}|${field}`) : overrides.get(`${rowKey}|${field}`);

  // Latest decision per (row, setter). Append-only table, latest wins.
  const decisionFor = new Map<string, CreditDecision>();
  for (const d of f.decisions) {
    const row = d.appointmentId ?? `m:${d.manualRowId}`;
    const k = `${row}|${d.setterUserId}`;
    const prev = decisionFor.get(k);
    if (!prev || d.decidedAt.getTime() > prev.decidedAt.getTime()) decisionFor.set(k, d);
  }

  const authorityFor = (appt: Appointment | null) => (userId: string | null): boolean => {
    if (userId === null) return true;
    const p = peopleById.get(userId);
    if (!p) return false;
    if (p.role === "admin") return true;
    return !!appt?.assignedUserId && p.ghlUserId === appt.assignedUserId;
  };
  const outcomeFor = (rowRef: string, rowKey: string, start: Date, appt: Appointment | null) =>
    resolveOutcome({ rowRef, start, appt, authoritative: authorityFor(appt), override: ov(rowKey, "outcome"), trackerOutcomes: f.trackerOutcomes, dispositions: f.dispositions, now: f.now });

  // ── Credit, R3 as amended by S1, S2 ───────────────────────────────────────────────────────
  function creditsFor(appt: Appointment, isFollowUp: boolean): { active: Set<string>; sources: Map<string, CreditSource>; suggested: string | null; bookedByName: string | null } {
    const active = new Set<string>();
    const sources = new Map<string, CreditSource>();
    let suggested: string | null = null;
    let bookedByName: string | null = null;

    const link = f.links.find((l) => l.appointmentId === appt.id);
    if (link?.sentByUserId) {
      // A tracked link is proof of whose outreach this was. A non-setter's link is theirs: stop.
      if (isSetter(link.sentByUserId)) {
        active.add(link.sentByUserId);
        sources.set(link.sentByUserId, link.delivery === "booked" ? "in_app" : "link");
      }
    } else {
      const booker = appt.createdByUserId ? peopleByGhl.get(appt.createdByUserId) : undefined;
      if (booker && isSetter(booker.id)) {
        active.add(booker.id);
        sources.set(booker.id, "ghl_manual");
      } else {
        if (appt.createdByUserId) bookedByName = booker?.name ?? "someone outside the app";
        // SUGGEST to the one setter who owns this lead, pending her confirm. Measured against
        // Kelsey's August sheet (2026-09-25): 12 of her 15 bookings were self-booked or synced
        // in on opportunities she owns, and 2 more were booked BY GAGE in GoHighLevel for her
        // leads. So a non-setter booker does not mean "not hers"; it means "ask her".
        // Never for a FOLLOW-UP: once a prospect has had a call that was not a no-show, later
        // appointments are the closer's business (Tyler Kreuzer's 9/2 follow-up, not a booking).
        if (!isFollowUp && appt.contactId) {
          const opps = f.opportunities.filter((o) => o.contactId === appt.contactId && !o.deleted);
          // Setter owns the lead, closer owns the deal: a contact often has one of each. What
          // matters is that exactly ONE setter owns any of them.
          const setterOwners = new Set(
            opps.map((o) => (o.assignedTo ? peopleByGhl.get(o.assignedTo) : undefined))
              .filter((p): p is Person => !!p && isSetter(p.id))
              .map((p) => p.id),
          );
          if (setterOwners.size === 1) suggested = [...setterOwners][0];
        }
      }
    }

    // Human decisions override derived facts, in both directions.
    for (const [k, d] of decisionFor) {
      if (!k.startsWith(`${appt.id}|`)) continue;
      if (d.decision === "reject") {
        active.delete(d.setterUserId);
        if (suggested === d.setterUserId) suggested = null;
      } else if (isSetter(d.setterUserId)) {
        active.add(d.setterUserId);
        if (!sources.has(d.setterUserId)) sources.set(d.setterUserId, suggested === d.setterUserId ? "owner" : "manual");
        // A person's claim beats a guess: whoever the owner rule suggested, a real claim settles it.
        // (Left in place, the guess kept a confirmed claim pending forever with nobody told.)
        suggested = null;
      }
    }
    return { active, sources, suggested, bookedByName };
  }

  // ── Every booking on every relevant contact (restoration needs other people's rows too) ───
  const bookings: Booking[] = [];
  // Outcomes first: whether an appointment is a follow-up depends on how the earlier ones went.
  const outcomes = new Map(f.appointments.map((a) => [a.id, outcomeFor(a.id, `b:${a.id}`, a.startTime, a)]));
  for (const a of f.appointments) {
    const rowKey = `b:${a.id}`;
    // A follow-up: an earlier appointment on the same prospect that was not cancelled, moved or
    // a no-show. Unknown outcomes count as "may have happened", so nothing is suggested on a guess.
    const isFollowUp = !!a.contactId && f.appointments.some((o) =>
      o.id !== a.id && o.contactId === a.contactId && o.startTime.getTime() < a.startTime.getTime() &&
      !["cancelled", "moved", "no_show"].includes(outcomes.get(o.id)!.outcome));
    const { active, sources, suggested, bookedByName } = creditsFor(a, isFollowUp);
    const callAtOv = ov(rowKey, "callAt");
    const callAt = callAtOv && typeof callAtOv.value === "string" ? new Date(callAtOv.value) : a.startTime;
    const { outcome, evidence } = outcomes.get(a.id)!;
    const contact = a.contactId ? contactsById.get(a.contactId) : undefined;
    bookings.push({
      rowKey, appointment: a, manualRowId: null, contactId: a.contactId,
      contactName: contact?.name ?? null, company: contact?.company ?? null,
      bookedAt: a.dateAdded, callAt, outcome, evidence, active, sources, suggested, bookedByName,
      closerName: a.assignedUserId ? peopleByGhl.get(a.assignedUserId)?.name ?? null : null,
    });
  }

  // Manual rows with no appointment: their own details live on the latest claim.
  const manualIds = new Set(f.decisions.filter((d) => d.manualRowId && !d.appointmentId).map((d) => d.manualRowId!));
  for (const mid of manualIds) {
    const latest = latestBy(f.decisions.filter((d) => d.manualRowId === mid && !d.appointmentId), (d) => d.decidedAt)!;
    if (latest.decision !== "claim" || !latest.callAt) continue;
    const rowKey = `m:${mid}`;
    const active = new Set([latest.setterUserId]);
    // A manual row has no appointment, so its call time IS the typed one; a correction moves it.
    const callAtOv = ov(rowKey, "callAt");
    const callAt = callAtOv && typeof callAtOv.value === "string" ? new Date(callAtOv.value) : latest.callAt;
    const { outcome, evidence } = outcomeFor(rowKey, rowKey, callAt, null);
    bookings.push({
      rowKey, appointment: null, manualRowId: mid, contactId: latest.contactId,
      contactName: latest.contactName, company: latest.companyName,
      bookedAt: latest.bookedAt, callAt, outcome, evidence,
      active, sources: new Map([[latest.setterUserId, "manual"]]), suggested: null, bookedByName: null, closerName: null,
    });
  }

  // A manual row can never shadow a real appointment: the add-booking route refuses a manual
  // row for a contact that has an appointment within a day of it, and makes the setter claim
  // that appointment instead. So one call can never exist here as two bookings.

  // ── Bonus chain per contact, R4 + R5 as amended by B5, S3 ─────────────────────────────────
  const rowState = new Map<string, { bonusState: BonusState; restoredIn: SetterRow["restoredIn"]; rebookOf: SetterRow["rebookOf"] }>();
  const entries: MoneyEntry[] = [];
  const setterOf = (b: Booking): string | null => (b.active.size === 1 ? [...b.active][0] : null);
  const creditIsPayable = (b: Booking) => b.active.size === 1;

  const byContact = new Map<string, Booking[]>();
  for (const b of bookings) {
    const k = b.contactId ?? `none:${b.rowKey}`;
    (byContact.get(k) ?? byContact.set(k, []).get(k)!).push(b);
  }

  // "The deal is lost" (Jack: a no-show stays open until then). Measured 2026-09-25: no
  // opportunity here has ever been set to status "lost" (3,764 open, 110 won, 1 abandoned), so
  // status alone would keep every no-show open forever. A lost latest proposal also closes it.
  const lostContact = (contactId: string | null) => {
    if (!contactId) return false;
    const opps = f.opportunities.filter((o) => o.contactId === contactId && !o.deleted);
    const oppsLost = opps.length > 0 && opps.every((o) => ["lost", "abandoned"].includes((o.status ?? "").toLowerCase()));
    const latestProposal = latestBy(f.proposals.filter((p) => p.contactId === contactId && p.sentAt), (p) => p.sentAt!);
    return oppsLost || (!!latestProposal?.lostAt && !latestProposal.paidAt);
  };

  for (const [contactKey, list] of byContact) {
    list.sort((a, b) => a.callAt.getTime() - b.callAt.getTime() || a.rowKey.localeCompare(b.rowKey));
    const open: Booking[] = []; // credited no-shows since go-live, waiting to be restored

    for (const b of list) {
      const month = nyMonth(b.callAt);
      const credited = b.active.size > 0 || !!b.suggested;
      if (month < TRACKER_GO_LIVE_MONTH) {
        rowState.set(b.rowKey, { bonusState: "before_tracker", restoredIn: null, rebookOf: null });
        continue;
      }

      if (b.outcome === "held") {
        if (open.length > 0) {
          // The EARLIEST open no-show is restored, to its own setter, in THIS month (R5, S3).
          const orig = open[0];
          const origSetter = setterOf(orig);
          rowState.set(orig.rowKey, {
            bonusState: "restored",
            restoredIn: { month, callAt: b.callAt, appointmentId: b.appointment?.id ?? b.rowKey },
            rebookOf: null,
          });
          // One entry, whoever it belongs to; rows not ours are filtered out at the end. It pays
          // only when the original credit is settled on exactly one confirmed setter.
          entries.push({
            key: `restore:${orig.rowKey}`, rowKey: orig.rowKey, month, kind: "bonus",
            cents: f.bonusCentsFor(month),
            status: creditIsPayable(orig) && !orig.suggested && origSetter === f.setterId ? "paid" : "pending",
            label: "Restored: rebook showed",
          });
          for (const extra of open.slice(1)) {
            rowState.set(extra.rowKey, { bonusState: "superseded", restoredIn: null, rebookOf: { rowKey: orig.rowKey, callAt: orig.callAt } });
          }
          rowState.set(b.rowKey, { bonusState: "rebook_of", restoredIn: null, rebookOf: { rowKey: orig.rowKey, callAt: orig.callAt } });
          open.length = 0;
          continue;
        }
        if (credited) {
          const payable = creditIsPayable(b) && !b.suggested;
          rowState.set(b.rowKey, { bonusState: payable ? "paid" : "pending", restoredIn: null, rebookOf: null });
          entries.push({
            key: `bonus:${b.rowKey}`, rowKey: b.rowKey, month, kind: "bonus",
            cents: f.bonusCentsFor(month),
            status: payable && setterOf(b) === f.setterId ? "paid" : "pending",
            label: "Booked call held",
          });
        }
        continue;
      }

      if (b.outcome === "no_show") {
        if (credited) {
          open.push(b);
          rowState.set(b.rowKey, { bonusState: "no_show_waiting", restoredIn: null, rebookOf: null });
        }
        continue;
      }

      if (b.outcome === "cancelled") { rowState.set(b.rowKey, { bonusState: "cancelled", restoredIn: null, rebookOf: null }); continue; }
      if (b.outcome === "moved") { rowState.set(b.rowKey, { bonusState: "moved", restoredIn: null, rebookOf: null }); continue; }

      // upcoming / awaiting: the money is possible but not proven.
      if (credited) {
        rowState.set(b.rowKey, { bonusState: "pending", restoredIn: null, rebookOf: null });
        entries.push({
          key: `bonus:${b.rowKey}`, rowKey: b.rowKey, month, kind: "bonus",
          cents: f.bonusCentsFor(month), status: "pending",
          label: b.outcome === "upcoming" ? "Call not happened yet" : "Waiting for the call outcome",
        });
      }
    }

    // No-shows never restored: closed out only once the deal is lost (S3, "no limit").
    const cid = contactKey.startsWith("none:") ? null : contactKey;
    for (const b of open) {
      if (lostContact(cid)) rowState.set(b.rowKey, { bonusState: "never_rebooked", restoredIn: null, rebookOf: null });
    }
  }

  // ── Commission, R6 as amended by B3 and Jack's answer (forever, one setter per proposal) ──
  const proposalBooking = new Map<string, Booking>();
  for (const p of f.proposals) {
    if (!p.sentAt) continue;
    // An admin's assignment (or "no setter") replaces the booking rule for this deal entirely,
    // so the booked setter's line moves cleanly rather than both being paid.
    if (p.setterMode === "assigned" || p.setterMode === "none") continue;
    const candidates = bookings.filter((b) =>
      b.contactId === p.contactId &&
      (b.active.size > 0 || b.suggested) &&
      b.outcome !== "cancelled" && b.outcome !== "moved" &&
      (b.bookedAt ?? b.callAt).getTime() <= p.sentAt!.getTime());
    const latest = latestBy(candidates, (b) => b.bookedAt ?? b.callAt);
    if (latest) proposalBooking.set(p.id, latest);
  }
  // A commission override replaces the row's commission for a MONTH, once: the first event in
  // that month carries the typed amount and the rest carry zero. Applied per event, two
  // proposals (or two instalments) on one row in one month would each pay the typed figure.
  const overriddenRowMonth = new Set<string>();
  const proposalsById = new Map(f.proposals.map((p) => [p.id, p]));
  for (const e of [...f.commissionEvents].sort((a, b) => a.date.getTime() - b.date.getTime() || a.proposalId.localeCompare(b.proposalId))) {
    // ASSIGNED BY AN ADMIN: paid on a row keyed by the PROPOSAL, not a booking. Without it an
    // assigned setter who did not book the call had nowhere for the money to land (review B1).
    const prop = proposalsById.get(e.proposalId);
    if (prop?.setterMode === "none") continue;
    if (prop?.setterMode === "assigned") {
      if (prop.setterUserId !== f.setterId) continue;
      const month = nyMonth(e.date);
      if (month < TRACKER_GO_LIVE_MONTH) continue;
      const rowKey = `p:${prop.id}`;
      const o = ov(rowKey, `commission@${month}`);
      let cents = Math.round(e.baseAmount * f.commissionPctFor(month));
      if (o && typeof o.value === "number") {
        const rm = `${rowKey}|${month}`;
        cents = overriddenRowMonth.has(rm) ? 0 : Math.round(o.value);
        overriddenRowMonth.add(rm);
      }
      entries.push({ key: `commission:${e.proposalId}:${e.date.toISOString()}`, rowKey, month, kind: "commission", cents, status: "paid", label: e.sublabel ?? "Commission" });
      continue;
    }
    const b = proposalBooking.get(e.proposalId);
    if (!b) continue;
    const mine = b.active.has(f.setterId) || b.suggested === f.setterId;
    if (!mine) continue;
    const month = nyMonth(e.date);
    if (month < TRACKER_GO_LIVE_MONTH) continue;
    const payable = b.active.size === 1 && !b.suggested;
    const key = `commission:${e.proposalId}:${e.date.toISOString()}`;
    const o = ov(b.rowKey, `commission@${month}`);
    let cents = Math.round(e.baseAmount * f.commissionPctFor(month));
    if (o && typeof o.value === "number") {
      const rm = `${b.rowKey}|${month}`;
      cents = overriddenRowMonth.has(rm) ? 0 : Math.round(o.value);
      overriddenRowMonth.add(rm);
    }
    entries.push({ key, rowKey: b.rowKey, month, kind: "commission", cents, status: payable ? "paid" : "pending", label: e.sublabel ?? "Commission" });
  }

  // A bonus override replaces the automatic bonus for that row in its month.
  for (const e of entries) {
    if (e.kind !== "bonus") continue;
    const o = ov(e.rowKey, "bonus");
    if (o && typeof o.value === "number") e.cents = Math.round(o.value);
  }

  // ── Rows for THIS setter ──────────────────────────────────────────────────────────────────
  const rows: SetterRow[] = [];
  const nameOf = (id: string) => peopleById.get(id)?.name ?? "someone";
  for (const b of bookings) {
    const mine = b.active.has(f.setterId) || b.suggested === f.setterId;
    if (!mine) continue;
    const state: CreditState = b.active.size > 1 ? "clash" : b.suggested === f.setterId ? "suggested" : "credited";
    const rs = rowState.get(b.rowKey) ?? { bonusState: "pending" as BonusState, restoredIn: null, rebookOf: null };
    const prop = [...proposalBooking.entries()].find(([, pb]) => pb.rowKey === b.rowKey);
    const p = prop ? f.proposals.find((x) => x.id === prop[0]) ?? null : null;

    const overridden: SetterRow["overridden"] = {};
    const pick = <T,>(field: string, auto: T): T => {
      const o = ov(b.rowKey, field);
      if (!o) return auto;
      overridden[field] = { by: o.editedBy, at: o.editedAt, original: auto };
      return o.value as T;
    };
    const company = pick("company", b.company);
    const contactName = pick("contactName", b.contactName);
    const closerName = pick("closer", b.closerName);
    const bookedAtRaw = pick<string | Date | null>("bookedAt", b.bookedAt);
    const notes = pick<string | null>("notes", null);
    if (ov(b.rowKey, "outcome")) overridden.outcome = { by: ov(b.rowKey, "outcome")!.editedBy, at: ov(b.rowKey, "outcome")!.editedAt, original: null };
    if (ov(b.rowKey, "callAt") && b.appointment) overridden.callAt = { by: ov(b.rowKey, "callAt")!.editedBy, at: ov(b.rowKey, "callAt")!.editedAt, original: b.appointment.startTime };
    if (ov(b.rowKey, "bonus")) overridden.bonus = { by: ov(b.rowKey, "bonus")!.editedBy, at: ov(b.rowKey, "bonus")!.editedAt, original: null };

    rows.push({
      rowKey: b.rowKey,
      appointmentId: b.appointment?.id ?? null,
      manualRowId: b.manualRowId,
      contactId: b.contactId,
      company, contactName,
      calendarName: b.appointment?.calendarName ?? null,
      bookedAt: bookedAtRaw ? new Date(bookedAtRaw) : null,
      callAt: b.callAt,
      month: nyMonth(b.callAt),
      credit: {
        state,
        source: b.sources.get(f.setterId) ?? (state === "suggested" ? "owner" : "manual"),
        clashWith: [...b.active].filter((s) => s !== f.setterId).map(nameOf),
        clashWithIds: [...b.active].filter((s) => s !== f.setterId),
        bookedByName: b.bookedByName,
      },
      outcome: b.outcome,
      evidence: b.evidence,
      bonusState: rs.bonusState,
      bonusAtStake: f.bonusCentsFor(nyMonth(b.callAt)),
      restoredIn: rs.restoredIn,
      rebookOf: rs.rebookOf,
      closerName,
      proposal: p ? { id: p.id, title: p.title, amount: p.totalAmount, sentAt: p.sentAt, paidAt: p.paidAt, state: proposalState(p, f.now) } : null,
      overridden,
      notes,
    });
  }

  // Deals an admin assigned to this setter: one row per deal, so the commission is traceable.
  for (const p of f.proposals) {
    if (p.setterMode !== "assigned" || p.setterUserId !== f.setterId) continue;
    const rowKey = `p:${p.id}`;
    const hasMoney = entries.some((e) => e.rowKey === rowKey);
    const anchor = p.paidAt ?? p.sentAt;
    if (!hasMoney && !anchor) continue;
    const contact = contactsById.get(p.contactId);
    const notesOv = ov(rowKey, "notes");
    rows.push({
      rowKey, appointmentId: null, manualRowId: null, contactId: p.contactId,
      company: contact?.company ?? p.title, contactName: contact?.name ?? null, calendarName: null,
      bookedAt: null, callAt: anchor ?? f.now, month: nyMonth(anchor ?? f.now),
      credit: { state: "credited", source: "assigned", clashWith: [], clashWithIds: [], bookedByName: null },
      outcome: "not_applicable", evidence: null, bonusState: "deal_only", bonusAtStake: 0,
      restoredIn: null, rebookOf: null, closerName: null,
      proposal: { id: p.id, title: p.title, amount: p.totalAmount, sentAt: p.sentAt, paidAt: p.paidAt, state: proposalState(p, f.now) },
      overridden: {}, notes: typeof notesOv?.value === "string" ? notesOv.value : null,
    });
  }

  // The per-proposal answer, for every proposal, whoever this sheet belongs to.
  const proposalSetters = new Map<string, ProposalSetter>();
  for (const p of f.proposals) {
    if (p.setterMode === "assigned") { proposalSetters.set(p.id, { mode: "assigned", setterIds: p.setterUserId ? [p.setterUserId] : [], state: null, bookedAt: null }); continue; }
    if (p.setterMode === "none") { proposalSetters.set(p.id, { mode: "none", setterIds: [], state: null, bookedAt: null }); continue; }
    const b = proposalBooking.get(p.id);
    if (!b) { proposalSetters.set(p.id, { mode: "suggested", setterIds: [], state: null, bookedAt: null }); continue; }
    const ids = [...new Set([...b.active, ...(b.suggested ? [b.suggested] : [])])];
    proposalSetters.set(p.id, {
      mode: "suggested", setterIds: ids,
      state: b.active.size > 1 ? "clash" : b.suggested && b.active.size === 0 ? "suggested" : "credited",
      bookedAt: b.bookedAt ?? b.callAt,
    });
  }

  return { rows, entries: entries.filter((e) => rows.some((r) => r.rowKey === e.rowKey)), proposalSetters };
}
