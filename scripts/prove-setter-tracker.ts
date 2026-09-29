/**
 * Proves the pay tracker's rules. Pure: no database, no network.
 *
 *   node_modules/.bin/tsx scripts/prove-setter-tracker.ts
 *
 * Every scenario below is a real situation from Kelsey's sheet, Gage's Slack answer, or the staff
 * review (tasks/setter-tracker-plan.md). A failure prints the scenario and exits non-zero.
 */
import {
  buildSetterLedger, type Appointment, type SetterFacts, type CreditDecision, type ProposalFact,
  type BaseCommissionEvent, type TrackerOutcome, type Disposition, type Opportunity, type TrackedLink, type Override,
} from "@/lib/tracker/setter-rules";
import { settle, linesToSettle, type LiveLine } from "@/lib/tracker/settlement";
import { resolveSettings, type SettingsRow } from "@/lib/tracker/settings";
import { nyMonth, nyMonthRange, addMonths } from "@/lib/tracker/months";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; return; }
  fail++;
  console.log(`✖ ${name}`, detail !== undefined ? JSON.stringify(detail, null, 1).slice(0, 600) : "");
}

const KELSEY = "u-kelsey", TAYLOR = "u-taylor", ALICE = "u-alice", GAGE = "u-gage";
const people = [
  { id: KELSEY, name: "Kelsey", role: "setter", ghlUserId: "g-kelsey" },
  { id: TAYLOR, name: "Taylor", role: "setter", ghlUserId: "g-taylor" },
  { id: ALICE, name: "Alice", role: "closer", ghlUserId: "g-alice" },
  { id: GAGE, name: "Gage", role: "admin", ghlUserId: "g-gage" },
];
const NOW = new Date("2026-10-20T15:00:00Z");
const d = (s: string) => new Date(s);

let seq = 0;
function appt(p: Partial<Appointment> & { start: string; contact: string }): Appointment {
  return {
    id: p.id ?? `a${++seq}`, contactId: p.contact, calendarName: "Intro Call", assignedUserId: "g-alice",
    createdByUserId: p.createdByUserId ?? null, dateAdded: p.dateAdded ?? new Date(d(p.start).getTime() - 3 * 864e5),
    startTime: d(p.start), status: p.status ?? "confirmed", deletedAt: p.deletedAt ?? null, movedToCalendarId: p.movedToCalendarId ?? null,
  };
}
const held = (a: Appointment, by = ALICE, minutesAfter = 40): TrackerOutcome =>
  ({ rowRef: a.id, outcome: "held", forStartTime: a.startTime, recordedBy: by, recordedAt: new Date(a.startTime.getTime() + minutesAfter * 6e4) });
const noShow = (a: Appointment, by = ALICE): TrackerOutcome =>
  ({ rowRef: a.id, outcome: "no_show", forStartTime: a.startTime, recordedBy: by, recordedAt: new Date(a.startTime.getTime() + 20 * 6e4) });
const link = (a: Appointment, who: string): TrackedLink => ({ appointmentId: a.id, sentByUserId: who, delivery: "sent" });
const owns = (contact: string, ghl: string, status = "open"): Opportunity => ({ contactId: contact, assignedTo: ghl, status, deleted: false });
const claim = (a: Appointment, setter: string, by = setter, at = "2026-10-01T00:00:00Z"): CreditDecision =>
  ({ appointmentId: a.id, manualRowId: null, setterUserId: setter, decision: "claim", contactId: null, contactName: null, companyName: null, bookedAt: null, callAt: null, decidedBy: by, decidedAt: d(at) });
const reject = (a: Appointment, setter: string, by = setter, at = "2026-10-02T00:00:00Z"): CreditDecision => ({ ...claim(a, setter, by, at), decision: "reject" });

function facts(p: Partial<SetterFacts>): SetterFacts {
  // Outcome and call-time overrides are facts about the call, loaded for everyone (bug 2).
  const all = [...(p.overrides ?? []), ...(p.rowOverrides ?? [])];
  const isRow = (o: Override) => o.field === "outcome" || o.field === "callAt";
  return {
    setterId: KELSEY, now: NOW, appointments: [], links: [], people, opportunities: [], decisions: [],
    trackerOutcomes: [], dispositions: [], contacts: [], proposals: [], commissionEvents: [],
    bonusCentsFor: () => 2500, commissionPctFor: () => 5, ...p,
    overrides: all.filter((o) => !isRow(o)),
    rowOverrides: all.filter(isRow),
  };
}
const paid = (l: ReturnType<typeof buildSetterLedger>, month?: string) =>
  l.entries.filter((e) => e.status === "paid" && (!month || e.month === month)).reduce((t, e) => t + e.cents, 0);
const pending = (l: ReturnType<typeof buildSetterLedger>) => l.entries.filter((e) => e.status === "pending").reduce((t, e) => t + e.cents, 0);
const row = (l: ReturnType<typeof buildSetterLedger>, a: Appointment) => l.rows.find((r) => r.appointmentId === a.id);

// ── 1. A tracked link, call held: $25 in the month of the CALL ──────────────────────────────
{
  const a = appt({ contact: "c1", start: "2026-09-30T23:30:00Z", dateAdded: d("2026-09-20T00:00:00Z") }); // 7:30pm ET 30 Sep
  const l = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [held(a)] }));
  check("1 link + held pays 2500", paid(l) === 2500, l.entries);
  check("1 month is the NY month of the call (Sep, not UTC Oct)", row(l, a)?.month === "2026-09", row(l, a)?.month);
  check("1 source is link", row(l, a)?.credit.source === "link");
}

// ── 2. Owner suggestion: pending until she confirms; then paid, marked as confirmed ─────────
{
  const a = appt({ contact: "c2", start: "2026-10-05T15:00:00Z" });
  const base = { appointments: [a], opportunities: [owns("c2", "g-kelsey")], trackerOutcomes: [held(a)] };
  const l1 = buildSetterLedger(facts(base));
  check("2 suggestion is pending, not paid", paid(l1) === 0 && pending(l1) === 2500, l1.entries);
  check("2 row shows as suggested", row(l1, a)?.credit.state === "suggested");
  const l2 = buildSetterLedger(facts({ ...base, decisions: [claim(a, KELSEY)] }));
  check("2 confirmed suggestion pays", paid(l2) === 2500, l2.entries);
  check("2 confirmed source reads 'owner'", row(l2, a)?.credit.source === "owner", row(l2, a)?.credit);
  const l3 = buildSetterLedger(facts({ ...base, decisions: [reject(a, KELSEY)] }));
  check("3 rejected suggestion disappears", l3.rows.length === 0 && l3.entries.length === 0);
}

// ── 4. Gage books by hand for Kelsey's lead (Papier Doll, Hard Tuned): SUGGESTED, never paid ─
{
  const a = appt({ contact: "c4", start: "2026-10-05T15:00:00Z", createdByUserId: "g-gage" });
  const l = buildSetterLedger(facts({ appointments: [a], opportunities: [owns("c4", "g-kelsey")], trackerOutcomes: [held(a)] }));
  check("4 booked by Gage on her lead is suggested to her", row(l, a)?.credit.state === "suggested" && row(l, a)?.credit.bookedByName === "Gage", row(l, a)?.credit);
  check("4 ...and pays nothing until she confirms", paid(l) === 0 && pending(l) === 2500);
  // A link Gage SENT is his outreach: never suggested to anyone.
  const b = appt({ contact: "c4b", start: "2026-10-05T15:00:00Z" });
  const l2 = buildSetterLedger(facts({ appointments: [b], links: [link(b, GAGE)], opportunities: [owns("c4b", "g-kelsey")], trackerOutcomes: [held(b)] }));
  check("16 a non-setter's tracked link stops the chain", l2.rows.length === 0);
  // Setter owns the lead, closer owns the deal (MOODBRU): still Kelsey's to confirm.
  const c = appt({ contact: "c4c", start: "2026-10-05T15:00:00Z" });
  const l3 = buildSetterLedger(facts({ appointments: [c], opportunities: [owns("c4c", "g-kelsey"), owns("c4c", "g-alice")], trackerOutcomes: [held(c)] }));
  check("4 one setter owner among a closer's opportunities is suggested", row(l3, c)?.credit.state === "suggested");
  // Two setters own opportunities on the prospect: not a guess anyone should make.
  const l4 = buildSetterLedger(facts({ appointments: [c], opportunities: [owns("c4c", "g-kelsey"), owns("c4c", "g-taylor")], trackerOutcomes: [held(c)] }));
  check("4 two setter owners: nothing suggested", l4.rows.length === 0);
  // A follow-up after a call that happened is the closer's (Tyler Kreuzer, 26 Aug then 2 Sep).
  const first = appt({ contact: "c4d", start: "2026-09-26T15:00:00Z" });
  const follow = appt({ contact: "c4d", start: "2026-10-02T15:00:00Z", createdByUserId: null });
  const l5 = buildSetterLedger(facts({ appointments: [first, follow], opportunities: [owns("c4d", "g-kelsey")], trackerOutcomes: [held(first), held(follow)] }));
  check("4 a follow-up after a held call is never suggested", !row(l5, follow) && !!row(l5, first), l5.rows.map((r) => r.appointmentId));
  // ...but a rebook after a no-show IS (it is the same booking coming back).
  const l6 = buildSetterLedger(facts({ appointments: [first, follow], opportunities: [owns("c4d", "g-kelsey")], trackerOutcomes: [noShow(first), held(follow)] }));
  check("4 a rebook after a no-show is still suggested", !!row(l6, follow));
}

// ── 5. Cancelled: row stays, shows the lost bonus, pays nothing ────────────────────────────
{
  const a = appt({ contact: "c5", start: "2026-10-08T15:00:00Z", status: "cancelled" });
  const l = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [held(a)] }));
  check("5 cancelled pays nothing", paid(l) === 0 && pending(l) === 0, l.entries);
  check("5 cancelled row stays with state", row(l, a)?.bonusState === "cancelled" && row(l, a)?.bonusAtStake === 2500);
  const del = appt({ contact: "c5b", start: "2026-10-08T15:00:00Z", deletedAt: d("2026-10-09T00:00:00Z") });
  const l2 = buildSetterLedger(facts({ appointments: [del], links: [link(del, KELSEY)] }));
  check("5 deleted counts as cancelled", row(l2, del)?.outcome === "cancelled");
  const mv = appt({ contact: "c5c", start: "2026-10-08T15:00:00Z", movedToCalendarId: "personal" });
  const l3 = buildSetterLedger(facts({ appointments: [mv], links: [link(mv, KELSEY)] }));
  check("5 moved off a sales calendar pays nothing", row(l3, mv)?.bonusState === "moved" && paid(l3) === 0);
}

// ── 6. Gage's rule: no-show deducts, rebook that shows adds it back, in the rebook's month ──
{
  const a = appt({ contact: "c6", start: "2026-09-13T15:00:00Z" });
  const b = appt({ contact: "c6", start: "2026-10-03T15:00:00Z" });
  const l = buildSetterLedger(facts({ appointments: [a, b], links: [link(a, KELSEY)], trackerOutcomes: [noShow(a), held(b)] }));
  check("6 no-show pays nothing in September", paid(l, "2026-09") === 0, l.entries);
  check("6 restored $25 lands in October", paid(l, "2026-10") === 2500, l.entries);
  check("6 original row says restored in October", row(l, a)?.bonusState === "restored" && row(l, a)?.restoredIn?.month === "2026-10", row(l, a));
  // The rebook was booked by Kelsey too (claimed): it must not pay a second time.
  const l2 = buildSetterLedger(facts({ appointments: [a, b], links: [link(a, KELSEY)], decisions: [claim(b, KELSEY)], trackerOutcomes: [noShow(a), held(b)] }));
  check("6 a no-show chain pays once, even when the rebook is also hers", paid(l2) === 2500, l2.entries);
  check("6 rebook row says it is a rebook", row(l2, b)?.bonusState === "rebook_of");
  // Taylor rebooked it: the $25 still goes back to Kelsey, the ORIGINAL setter.
  const lt = buildSetterLedger(facts({ setterId: TAYLOR, appointments: [a, b], links: [link(a, KELSEY), link(b, TAYLOR)], trackerOutcomes: [noShow(a), held(b)] }));
  check("6 the rebooking setter is not paid for a rebook", paid(lt) === 0, lt.entries);
  const lk = buildSetterLedger(facts({ appointments: [a, b], links: [link(a, KELSEY), link(b, TAYLOR)], trackerOutcomes: [noShow(a), held(b)] }));
  check("6 ...the original setter is", paid(lk) === 2500);
}

// ── 7. Two no-shows then a show: one $25, not two ──────────────────────────────────────────
{
  const a = appt({ contact: "c7", start: "2026-09-10T15:00:00Z" });
  const b = appt({ contact: "c7", start: "2026-09-17T15:00:00Z" });
  const c = appt({ contact: "c7", start: "2026-09-24T15:00:00Z" });
  const l = buildSetterLedger(facts({ appointments: [a, b, c], links: [link(a, KELSEY)], decisions: [claim(b, KELSEY)], trackerOutcomes: [noShow(a), noShow(b), held(c)] }));
  check("7 two no-shows then held pays once", paid(l) === 2500, l.entries);
  check("7 second no-show is superseded", row(l, b)?.bonusState === "superseded");
}

// ── 8. Never rebooked: waits while the deal is alive; closes out once it is lost ─────────────
{
  const a = appt({ contact: "c8", start: "2026-09-10T15:00:00Z" });
  const alive = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [noShow(a)], opportunities: [owns("c8", "g-alice")] }));
  check("8 open deal: waiting for a rebook", row(alive, a)?.bonusState === "no_show_waiting");
  const lost = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [noShow(a)], opportunities: [owns("c8", "g-alice", "lost")] }));
  check("8 lost deal: never rebooked", row(lost, a)?.bonusState === "never_rebooked");
  const ab = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [noShow(a)], opportunities: [owns("c8", "g-alice", "abandoned")] }));
  check("8 abandoned deal: never rebooked", row(ab, a)?.bonusState === "never_rebooked");
  const lostProp: ProposalFact = { id: "p8", contactId: "c8", title: "x", totalAmount: 1, sentAt: d("2026-09-20T00:00:00Z"), signedAt: null, paidAt: null, lostAt: d("2026-09-30T00:00:00Z") };
  const lp = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [noShow(a)], opportunities: [owns("c8", "g-alice")], proposals: [lostProp] }));
  check("8 lost proposal: never rebooked", row(lp, a)?.bonusState === "never_rebooked");
}

// ── 9. B5: an August no-show (paid on the sheet) cannot be restored again in September ──────
{
  const a = appt({ contact: "c9", start: "2026-08-13T15:00:00Z" });
  const b = appt({ contact: "c9", start: "2026-09-12T15:00:00Z" });
  const l = buildSetterLedger(facts({ appointments: [a, b], links: [link(a, KELSEY)], decisions: [claim(b, KELSEY)], trackerOutcomes: [noShow(a), held(b)] }));
  check("9 pre-go-live no-show is not restored", !l.entries.some((e) => e.key.startsWith("restore:")), l.entries);
  check("9 the September rebook pays on its own merits", paid(l, "2026-09") === 2500, l.entries);
  check("9 August row is marked before the tracker", row(l, a)?.bonusState === "before_tracker");
}

// ── 10. B2: an outcome recorded for the OLD time does not count after a reschedule ──────────
{
  const a = appt({ contact: "c10", start: "2026-10-10T15:00:00Z" });
  const stale: TrackerOutcome = { rowRef: a.id, outcome: "held", forStartTime: d("2026-10-06T15:00:00Z"), recordedBy: ALICE, recordedAt: d("2026-10-06T16:00:00Z") };
  const disp: Disposition = { eventId: a.id, outcome: "rebooked", at: d("2026-10-06T16:00:00Z"), createdByUserId: ALICE };
  const l = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [stale], dispositions: [disp] }));
  check("10 rescheduled call is awaiting its outcome again", row(l, a)?.outcome === "awaiting", row(l, a));
  check("10 and pays nothing yet", paid(l) === 0 && pending(l) === 2500);
}

// ── 11. B1: a setter marking her own call as held counts, but is flagged self-reported ──────
{
  const a = appt({ contact: "c11", start: "2026-10-10T15:00:00Z" });
  const l = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [held(a, KELSEY)] }));
  check("11 self-reported outcome is flagged", row(l, a)?.evidence?.selfReported === true, row(l, a)?.evidence);
  const disp: Disposition = { eventId: a.id, outcome: "sent_proposal", at: d("2026-10-10T16:00:00Z"), createdByUserId: KELSEY };
  const l2 = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], dispositions: [disp] }));
  check("11 ...also when written through the dashboard", row(l2, a)?.evidence?.selfReported === true);
  const disp2: Disposition = { ...disp, createdByUserId: ALICE };
  const l3 = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], dispositions: [disp2] }));
  check("11 the closer's outcome is proof", row(l3, a)?.evidence?.selfReported === false && paid(l3) === 2500);
}

// ── 12. Clash: two setters on one call, neither is paid until an admin decides ──────────────
{
  const a = appt({ contact: "c12", start: "2026-10-10T15:00:00Z" });
  const base = { appointments: [a], links: [link(a, TAYLOR)], decisions: [claim(a, KELSEY)], trackerOutcomes: [held(a)] };
  const l = buildSetterLedger(facts(base));
  check("12 clash shows on Kelsey's sheet", row(l, a)?.credit.state === "clash" && row(l, a)?.credit.clashWith[0] === "Taylor", row(l, a)?.credit);
  check("12 clash pays nobody", paid(l) === 0 && pending(l) === 2500);
  const lt = buildSetterLedger(facts({ ...base, setterId: TAYLOR }));
  check("12 clash shows on Taylor's sheet too", row(lt, a)?.credit.state === "clash" && paid(lt) === 0);
  const resolved = buildSetterLedger(facts({ ...base, setterId: TAYLOR, decisions: [claim(a, KELSEY), reject(a, KELSEY, GAGE)] }));
  check("12 admin resolution pays the winner", paid(resolved) === 2500, resolved.entries);
}

// ── 13. Commission: forever, one setter per proposal, the latest booking before it was sent ─
{
  const a = appt({ contact: "c13", start: "2026-06-10T15:00:00Z", dateAdded: d("2026-06-05T00:00:00Z") });
  const b = appt({ contact: "c13", start: "2026-09-10T15:00:00Z", dateAdded: d("2026-09-05T00:00:00Z") });
  const p: ProposalFact = { id: "p13", contactId: "c13", title: "Retention", totalAmount: 4500, sentAt: d("2026-09-12T00:00:00Z"), signedAt: null, paidAt: d("2026-10-02T15:00:00Z"), lostAt: null };
  const ev: BaseCommissionEvent = { proposalId: "p13", date: p.paidAt!, baseAmount: 4500 };
  const common = { appointments: [a, b], links: [link(a, KELSEY), link(b, TAYLOR)], trackerOutcomes: [held(a), held(b)], proposals: [p], commissionEvents: [ev] };
  const lt = buildSetterLedger(facts({ ...common, setterId: TAYLOR }));
  const lk = buildSetterLedger(facts(common));
  const comm = (l: ReturnType<typeof buildSetterLedger>) => l.entries.filter((e) => e.kind === "commission" && e.status === "paid").reduce((t, e) => t + e.cents, 0);
  check("13 latest booking before sending gets the 5% (Taylor)", comm(lt) === 22500, lt.entries);
  check("13 the earlier setter gets none of it", comm(lk) === 0, lk.entries);
  // Kelsey only, no-show never rebooked, closed by email: still 5% (Jack: forever).
  const c = appt({ contact: "c13b", start: "2026-09-10T15:00:00Z" });
  const p2 = { ...p, id: "p13b", contactId: "c13b" };
  const l3 = buildSetterLedger(facts({ appointments: [c], links: [link(c, KELSEY)], trackerOutcomes: [noShow(c)], proposals: [p2], commissionEvents: [{ ...ev, proposalId: "p13b" }] }));
  check("13 no-show but deal closed: setter still earns 5%", comm(l3) === 22500, l3.entries);
  // Only a cancelled booking: nothing.
  const e2 = appt({ contact: "c13c", start: "2026-09-10T15:00:00Z", status: "cancelled" });
  const p3 = { ...p, id: "p13c", contactId: "c13c" };
  const l4 = buildSetterLedger(facts({ appointments: [e2], links: [link(e2, KELSEY)], proposals: [p3], commissionEvents: [{ ...ev, proposalId: "p13c" }] }));
  check("13 a cancelled booking earns no commission", comm(l4) === 0);
  // Rate is the one in force in the month the commission lands.
  const l5 = buildSetterLedger(facts({ ...common, setterId: TAYLOR, commissionPctFor: (m) => (m === "2026-10" ? 7 : 5) }));
  check("13 commission uses the rate of the month it lands in", comm(l5) === 31500, l5.entries);
}

// ── 14. Upcoming call: pending, not paid ───────────────────────────────────────────────────
{
  const a = appt({ contact: "c14", start: "2026-10-28T15:00:00Z" });
  const l = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)] }));
  check("14 upcoming is pending", row(l, a)?.outcome === "upcoming" && paid(l) === 0 && pending(l) === 2500);
}

// ── 15. Overrides: bonus and outcome, marked, and they drive the totals ────────────────────
{
  const a = appt({ contact: "c15", start: "2026-10-10T15:00:00Z" });
  const ovs: Override[] = [
    { rowKey: `b:${a.id}`, field: "outcome", value: "held", editedBy: KELSEY, editedAt: d("2026-10-11T00:00:00Z") },
    { rowKey: `b:${a.id}`, field: "bonus", value: 3000, editedBy: GAGE, editedAt: d("2026-10-12T00:00:00Z") },
    { rowKey: `b:${a.id}`, field: "notes", value: "Call at 10:45", editedBy: KELSEY, editedAt: d("2026-10-12T00:00:00Z") },
  ];
  const l = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], overrides: ovs }));
  check("15 outcome override counts and is marked self-reported", row(l, a)?.outcome === "held" && row(l, a)?.evidence?.selfReported === true);
  check("15 bonus override drives the total", paid(l) === 3000, l.entries);
  check("15 overridden cells are marked", !!row(l, a)?.overridden.bonus && !!row(l, a)?.overridden.outcome);
  check("15 notes come through", row(l, a)?.notes === "Call at 10:45");
  const cleared = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], overrides: [...ovs, { ...ovs[1], value: null, editedAt: d("2026-10-13T00:00:00Z") }], trackerOutcomes: [held(a)] }));
  check("15 clearing an override restores the automatic value", paid(cleared) === 2500, cleared.entries);
}

// ── 17. A booked call nobody can be credited with: not on anyone's sheet ───────────────────
{
  const a = appt({ contact: "c17", start: "2026-10-10T15:00:00Z" });
  const l = buildSetterLedger(facts({ appointments: [a], trackerOutcomes: [held(a)] }));
  check("17 uncredited call appears nowhere", l.rows.length === 0 && l.entries.length === 0);
}

// ── 18. Manual row with no appointment: counts, awaits its outcome like any other ───────────
{
  const m: CreditDecision = { appointmentId: null, manualRowId: "m1", setterUserId: KELSEY, decision: "claim", contactId: "c18", contactName: "Parth Patel", companyName: "Shop Selvori", bookedAt: d("2026-10-01T00:00:00Z"), callAt: d("2026-10-06T15:00:00Z"), decidedBy: KELSEY, decidedAt: d("2026-10-02T00:00:00Z") };
  const l = buildSetterLedger(facts({ decisions: [m] }));
  check("18 manual row appears, marked manual", l.rows[0]?.credit.source === "manual" && l.rows[0]?.company === "Shop Selvori");
  check("18 manual row awaits its outcome", l.rows[0]?.outcome === "awaiting" && pending(l) === 2500);
  const l2 = buildSetterLedger(facts({ decisions: [m], trackerOutcomes: [{ rowRef: "m:m1", outcome: "held", forStartTime: m.callAt!, recordedBy: ALICE, recordedAt: d("2026-10-06T16:00:00Z") }] }));
  check("18 manual row pays once its call is confirmed", paid(l2) === 2500);
  const l3 = buildSetterLedger(facts({ decisions: [m, { ...m, decision: "reject", decidedAt: d("2026-10-03T00:00:00Z") }] }));
  check("18 a removed manual row is gone", l3.rows.length === 0);
}

// ── Reviewer bugs, each pinned so it cannot come back ─────────────────────────────────────
{
  // Bug 1: a commission override pays once per row and month, not once per event.
  const a = appt({ contact: "r1", start: "2026-09-10T15:00:00Z", dateAdded: d("2026-09-05T00:00:00Z") });
  const p1: ProposalFact = { id: "pa", contactId: "r1", title: "A", totalAmount: 1000, sentAt: d("2026-09-12T00:00:00Z"), signedAt: null, paidAt: d("2026-10-02T15:00:00Z"), lostAt: null };
  const p2: ProposalFact = { ...p1, id: "pb", totalAmount: 2000, paidAt: d("2026-10-09T15:00:00Z") };
  const ovs: Override[] = [{ rowKey: `b:${a.id}`, field: "commission@2026-10", value: 10000, editedBy: GAGE, editedAt: d("2026-10-12T00:00:00Z") }];
  const l = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [held(a)], proposals: [p1, p2],
    commissionEvents: [{ proposalId: "pa", date: p1.paidAt!, baseAmount: 1000 }, { proposalId: "pb", date: p2.paidAt!, baseAmount: 2000 }], overrides: ovs }));
  const comm = l.entries.filter((e) => e.kind === "commission").reduce((t, e) => t + e.cents, 0);
  check("B1 commission override pays once for the row's month", comm === 10000, l.entries);
}
{
  // Bug 2 + H1: an admin's outcome correction on someone else's row still restores Kelsey.
  const a = appt({ contact: "r2", start: "2026-09-13T15:00:00Z" });
  const b = appt({ contact: "r2", start: "2026-10-03T15:00:00Z" });
  const l = buildSetterLedger(facts({ appointments: [a, b], links: [link(a, KELSEY), link(b, TAYLOR)], trackerOutcomes: [noShow(a)],
    rowOverrides: [{ rowKey: `b:${b.id}`, field: "outcome", value: "held", editedBy: GAGE, editedAt: d("2026-10-04T00:00:00Z") }] }));
  check("B2 an outcome set on another person's row restores the original setter", paid(l, "2026-10") === 2500, l.entries);
}
{
  // H3: a rival setter's no-show on Kelsey's call counts but is never proof.
  const a = appt({ contact: "r3", start: "2026-10-10T15:00:00Z" });
  const l = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [noShow(a, TAYLOR)] }));
  check("H3 a rival's outcome is flagged, not proof", row(l, a)?.evidence?.selfReported === true);
  const l2 = buildSetterLedger(facts({ appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [held(a, GAGE)] }));
  check("H3 an admin's outcome is proof", row(l2, a)?.evidence?.selfReported === false);
}
{
  // Bug 6: Kelsey's claim settles a booking Taylor's opportunity suggested.
  const a = appt({ contact: "r6", start: "2026-10-05T15:00:00Z" });
  const l = buildSetterLedger(facts({ appointments: [a], opportunities: [owns("r6", "g-taylor")], decisions: [claim(a, KELSEY)], trackerOutcomes: [held(a)] }));
  check("B6 a claim beats an owner guess and pays", paid(l) === 2500 && row(l, a)?.credit.state === "credited", { e: l.entries, c: row(l, a)?.credit });
  const lt = buildSetterLedger(facts({ setterId: TAYLOR, appointments: [a], opportunities: [owns("r6", "g-taylor")], decisions: [claim(a, KELSEY)], trackerOutcomes: [held(a)] }));
  check("B6 the guessed owner no longer sees it", lt.rows.length === 0);
}
{
  // Bug 9: correcting a manual row's call date moves it.
  const m: CreditDecision = { appointmentId: null, manualRowId: "m9", setterUserId: KELSEY, decision: "claim", contactId: null, contactName: "X", companyName: null, bookedAt: null, callAt: d("2026-10-30T15:00:00Z"), decidedBy: KELSEY, decidedAt: d("2026-10-02T00:00:00Z") };
  const l = buildSetterLedger(facts({ decisions: [m], rowOverrides: [{ rowKey: "m:m9", field: "callAt", value: "2026-10-02T16:00:00.000Z", editedBy: KELSEY, editedAt: d("2026-10-03T00:00:00Z") }] }));
  check("B9 a manual row's corrected date is used", l.rows[0]?.callAt.toISOString() === "2026-10-02T16:00:00.000Z" && l.rows[0]?.outcome === "awaiting", l.rows[0]);
}

// ── Proposal credit (0065): an admin's setter assignment on the deal ──────────────────────
{
  const a = appt({ contact: "pc1", start: "2026-09-10T15:00:00Z", dateAdded: d("2026-09-05T00:00:00Z") });
  const base: ProposalFact = { id: "pp1", contactId: "pc1", title: "Deal", totalAmount: 4000, sentAt: d("2026-09-12T00:00:00Z"), signedAt: null, paidAt: d("2026-10-02T15:00:00Z"), lostAt: null };
  const ev: BaseCommissionEvent = { proposalId: "pp1", date: base.paidAt!, baseAmount: 4000 };
  const comm = (l: ReturnType<typeof buildSetterLedger>) => l.entries.filter((e) => e.kind === "commission" && e.status === "paid").reduce((t, e) => t + e.cents, 0);
  const common = { appointments: [a], links: [link(a, KELSEY)], trackerOutcomes: [held(a)], commissionEvents: [ev] };

  // Booking rule, untouched: Kelsey booked it, Kelsey earns.
  const l0 = buildSetterLedger(facts({ ...common, proposals: [base] }));
  check("PC1 unassigned deal pays the booked setter", comm(l0) === 20000, l0.entries);
  check("PC1 per-proposal answer is 'suggested', credited to Kelsey", l0.proposalSetters.get("pp1")?.mode === "suggested" && l0.proposalSetters.get("pp1")?.setterIds[0] === KELSEY && l0.proposalSetters.get("pp1")?.state === "credited");

  // Admin assigns Taylor, who never booked it: Taylor paid on a deal row, Kelsey loses it (B1).
  const assigned = { ...base, setterMode: "assigned" as const, setterUserId: TAYLOR };
  const lk = buildSetterLedger(facts({ ...common, proposals: [assigned] }));
  const lt = buildSetterLedger(facts({ ...common, setterId: TAYLOR, proposals: [assigned] }));
  check("PC2 the booked setter no longer earns an assigned-away deal", comm(lk) === 0, lk.entries);
  check("PC2 the assigned setter earns it, with no booking of her own", comm(lt) === 20000, lt.entries);
  check("PC2 ...on a row keyed by the deal, so it is traceable", lt.rows.some((r) => r.rowKey === "p:pp1" && r.credit.source === "assigned" && r.bonusState === "deal_only"), lt.rows.map((r) => r.rowKey));
  check("PC2 Kelsey still keeps her $25 booking bonus (she did book the call)", lk.entries.some((e) => e.kind === "bonus" && e.status === "paid" && e.cents === 2500));

  // "No setter": nobody earns setter commission.
  const none = { ...base, setterMode: "none" as const, setterUserId: null };
  check("PC3 'no setter' pays no setter commission", comm(buildSetterLedger(facts({ ...common, proposals: [none] }))) === 0 && comm(buildSetterLedger(facts({ ...common, setterId: TAYLOR, proposals: [none] }))) === 0);
  check("PC3 per-proposal answer is 'none'", buildSetterLedger(facts({ ...common, proposals: [none] })).proposalSetters.get("pp1")?.mode === "none");

  // Assigned deal before go-live never pays retroactively.
  const early = { ...assigned, paidAt: d("2026-08-02T15:00:00Z") };
  check("PC4 an assigned deal paid before go-live pays nothing now", comm(buildSetterLedger(facts({ ...common, setterId: TAYLOR, proposals: [early], commissionEvents: [{ ...ev, date: early.paidAt! }] }))) === 0);

  // An owner-guess booking behind the deal: suggested, pending, and the answer says so.
  const b2 = appt({ contact: "pc5", start: "2026-09-10T15:00:00Z", dateAdded: d("2026-09-05T00:00:00Z") });
  const p5: ProposalFact = { ...base, id: "pp5", contactId: "pc5" };
  const l5 = buildSetterLedger(facts({ appointments: [b2], opportunities: [owns("pc5", "g-kelsey")], trackerOutcomes: [held(b2)], proposals: [p5], commissionEvents: [{ ...ev, proposalId: "pp5" }] }));
  check("PC5 a guessed setter's commission is pending, and the deal says 'suggested'", comm(l5) === 0 && l5.proposalSetters.get("pp5")?.state === "suggested");
}

// ── Settlement: closed months never move; late changes become adjustments ──────────────────
{
  const months = ["2026-09", "2026-10"];
  const sept: LiveLine = { key: "bonus:b:x", rowKey: "b:x", month: "2026-09", kind: "bonus", cents: 2500, status: "paid", label: "held" };
  const pend: LiveLine = { key: "bonus:b:y", rowKey: "b:y", month: "2026-09", kind: "bonus", cents: 2500, status: "pending", label: "awaiting" };
  const open = settle({ live: [sept, pend], settled: [], closedMonths: new Set(), months });
  check("S1 open September shows 25 paid, 25 pending", open.get("2026-09")?.paidCents === 2500 && open.get("2026-09")?.pendingCents === 2500);

  const toSettle = linesToSettle(open.get("2026-09")!);
  check("S2 closing settles only the paid line", toSettle.length === 1 && toSettle[0].cents === 2500, toSettle);

  // After close: x is cancelled (live 0), y resolves as held (live paid 25).
  const after = settle({
    live: [{ ...sept, cents: 0, status: "paid" }, { ...pend, status: "paid" }],
    settled: toSettle, closedMonths: new Set(["2026-09"]), months,
  });
  check("S3 closed September is frozen at what was settled", after.get("2026-09")?.paidCents === 2500, after.get("2026-09"));
  const oct = after.get("2026-10")!;
  check("S4 October carries both adjustments, net zero", oct.paidCents === 0 && oct.lines.length === 2 && oct.lines.every((l) => l.isAdjustment), oct.lines);
  check("S4 the cancellation is a -25 adjustment", oct.lines.some((l) => l.key === "bonus:b:x" && l.payableCents === -2500));
  check("S4 the late outcome is a +25 adjustment", oct.lines.some((l) => l.key === "bonus:b:y" && l.payableCents === 2500));

  // A row moved from closed September to open October is not paid twice.
  const moved = settle({ live: [{ ...sept, month: "2026-10" }], settled: toSettle, closedMonths: new Set(["2026-09"]), months });
  check("S5 a line already settled is not paid again when its month changes", (moved.get("2026-10")?.paidCents ?? 0) === 0, moved.get("2026-10"));

  // A line removed entirely after close (credit rejected) is clawed back.
  const removed = settle({ live: [], settled: toSettle, closedMonths: new Set(["2026-09"]), months });
  check("S6 a settled line that disappears is a negative adjustment", removed.get("2026-10")?.paidCents === -2500);
  check("S7 ...and it is still shown against its own row", removed.get("2026-10")?.lines[0]?.rowKey === "b:x", removed.get("2026-10")?.lines);
}

// ── Month-close replay: a deal reassigned to another closer after its month closed ───────
{
  const months = ["2026-09", "2026-10"];
  const line: LiveLine = { key: "commission:pX:2026-09-15T00:00:00.000Z", rowKey: "p:pX", month: "2026-09", kind: "commission", cents: 45000, status: "paid", label: "Paid in full" };
  // Alice was the closer when September closed: $450 settled to her.
  const aliceSettled = linesToSettle(settle({ live: [line], settled: [], closedMonths: new Set(), months }).get("2026-09")!);
  check("R1 Alice is settled $450 in September", aliceSettled.length === 1 && aliceSettled[0].cents === 45000);
  // Admin reassigns the deal to Gage in October. Alice's live ledger no longer has the line;
  // Gage's does, with nothing settled for him.
  const alice = settle({ live: [], settled: aliceSettled, closedMonths: new Set(["2026-09"]), months });
  const gage = settle({ live: [line], settled: [], closedMonths: new Set(["2026-09"]), months });
  check("R2 September stays exactly as paid for Alice", alice.get("2026-09")!.paidCents === 45000);
  check("R3 Alice's October shows -$450, on the deal's own row", alice.get("2026-10")!.paidCents === -45000 && alice.get("2026-10")!.lines[0]?.rowKey === "p:pX");
  check("R4 Gage's October shows +$450 as an adjustment", gage.get("2026-10")!.paidCents === 45000 && gage.get("2026-10")!.lines[0]?.isAdjustment === true);
  check("R5 across both people the reassignment nets to exactly zero", alice.get("2026-10")!.paidCents + gage.get("2026-10")!.paidCents === 0);
}

// ── Month settings: "from this month on", markers only on the month edited ─────────────────
{
  const rows: SettingsRow[] = [
    { userId: KELSEY, month: "2000-01", basePayCents: null, bookingBonusCents: 2500, commissionPct: 5, editedFields: [], editedBy: null, editedAt: null },
    { userId: KELSEY, month: "2026-09", basePayCents: 150000, bookingBonusCents: 2500, commissionPct: 5, editedFields: ["basePayCents"], editedBy: KELSEY, editedAt: d("2026-09-25T00:00:00Z") },
    { userId: KELSEY, month: "2026-10", basePayCents: 150000, bookingBonusCents: 2500, commissionPct: 7, editedFields: ["commissionPct"], editedBy: KELSEY, editedAt: d("2026-10-02T00:00:00Z") },
  ];
  check("M1 August is untouched by later edits", resolveSettings(rows, "2026-08").basePayCents === null && resolveSettings(rows, "2026-08").commissionPct === 5);
  check("M2 September has its own base pay", resolveSettings(rows, "2026-09").basePayCents === 150000);
  check("M3 October's rate change is October's", resolveSettings(rows, "2026-10").commissionPct === 7 && resolveSettings(rows, "2026-09").commissionPct === 5);
  check("M4 November starts with October's values", resolveSettings(rows, "2026-11").commissionPct === 7);
  check("M5 inherited values carry no edit marker", resolveSettings(rows, "2026-11").editedFields.length === 0);
}

// ── Month boundaries in New York ───────────────────────────────────────────────────────────
{
  check("T1 11pm ET on 30 Sep is September", nyMonth(d("2026-10-01T03:00:00Z")) === "2026-09");
  check("T2 1am ET on 1 Oct is October", nyMonth(d("2026-10-01T05:00:00Z")) === "2026-10");
  const r = nyMonthRange("2026-11");
  check("T3 November starts at 04:00Z (EDT) and ends at 05:00Z (EST)", r.start.toISOString() === "2026-11-01T04:00:00.000Z" && r.end.toISOString() === "2026-12-01T05:00:00.000Z", r);
  check("T4 addMonths wraps the year", addMonths("2026-12", 1) === "2027-01" && addMonths("2027-01", -1) === "2026-12");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
