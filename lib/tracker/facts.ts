import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bookingLinks, callDispositions, ghlAppointments, localContacts, localOpportunities, proposals,
  trackerCallOutcomes, trackerCreditDecisions, trackerOverrides, users,
} from "@/lib/db/schema";
import { getCommissionEventsWhere, getPayoutTiming, type PayoutTiming } from "@/lib/kpi/rep-proposal-commission";
import { loadSettingsRows, resolveSettings, type SettingsRow } from "@/lib/tracker/settings";
import type { SetterFacts, Person } from "@/lib/tracker/setter-rules";

/**
 * Everything the setter rules need, read in one place.
 *
 * WHY IT READS EVERY BOOKED-CALL APPOINTMENT, NOT JUST "HERS"
 * Whether Kelsey's no-show is restored depends on a LATER appointment on the same prospect that
 * may belong to nobody, or to Taylor. Whether a call is a clash depends on other setters' claims.
 * So the rules see the whole location's booked calls (hundreds of rows, not thousands) and pick
 * out her rows at the end. Filtering first would make those answers silently wrong.
 */
export async function loadSetterFacts(setterId: string, now: Date = new Date()): Promise<{
  facts: SetterFacts;
  settingsRows: SettingsRow[];
  payoutTiming: PayoutTiming;
}> {
  const database = db();

  const [people, appointments, links, decisions, trackerOutcomes, overrides, settingsRows, payoutTiming] = await Promise.all([
    database.select({ id: users.id, name: users.name, role: users.role, ghlUserId: users.ghlUserId }).from(users),
    database.select().from(ghlAppointments),
    database.select({
      appointmentId: bookingLinks.ghlAppointmentId, sentByUserId: bookingLinks.sentByUserId, delivery: bookingLinks.delivery,
    }).from(bookingLinks),
    database.select().from(trackerCreditDecisions),
    database.select().from(trackerCallOutcomes),
    // Own sheet overrides, plus call facts (outcome, call time) typed by anyone on any sheet.
    database.select().from(trackerOverrides).where(or(
      eq(trackerOverrides.subjectUserId, setterId),
      inArray(trackerOverrides.field, ["outcome", "callAt"]),
    )),
    loadSettingsRows([setterId]),
    getPayoutTiming(),
  ]);

  const contactIds = [...new Set([
    ...appointments.map((a) => a.contactId).filter((c): c is string => !!c),
    ...decisions.map((d) => d.contactId).filter((c): c is string => !!c),
  ])];
  const appointmentIds = appointments.map((a) => a.id);

  const [opps, contacts, dispositions, props, events] = await Promise.all([
    contactIds.length
      ? database.select({
          contactId: localOpportunities.contactId, assignedTo: localOpportunities.assignedTo,
          status: localOpportunities.status, deletedAt: localOpportunities.deletedInGhlAt,
        }).from(localOpportunities).where(inArray(localOpportunities.contactId, contactIds))
      : Promise.resolve([]),
    contactIds.length
      ? database.select({
          id: localContacts.id, fullName: localContacts.fullName, firstName: localContacts.firstName,
          lastName: localContacts.lastName, company: localContacts.companyName,
        }).from(localContacts).where(inArray(localContacts.id, contactIds))
      : Promise.resolve([]),
    appointmentIds.length
      ? database.select({
          eventId: callDispositions.calendarEventId, outcome: callDispositions.outcome,
          at: callDispositions.dispositionedAt, createdByUserId: callDispositions.createdByUserId,
        }).from(callDispositions).where(and(
          inArray(callDispositions.calendarEventId, appointmentIds),
          isNull(callDispositions.callId),
        ))
      : Promise.resolve([]),
    contactIds.length
      ? database.select({
          id: proposals.id, contactId: proposals.ghlContactId, title: proposals.title, totalAmount: proposals.totalAmount,
          sentAt: proposals.sentAt, signedAt: proposals.signedAt, paidAt: proposals.paidAt, lostAt: proposals.lostAt,
          contactName: proposals.contactName,
        }).from(proposals).where(inArray(proposals.ghlContactId, contactIds))
      : Promise.resolve([]),
    // At 100%, so `commission` is the base amount; the rate is applied per month by the rules.
    contactIds.length
      ? getCommissionEventsWhere({ where: inArray(proposals.ghlContactId, contactIds), commissionPct: 100, payoutTiming })
      : Promise.resolve([]),
  ]);

  const peopleList: Person[] = people.map((p) => ({ id: p.id, name: p.name, role: p.role, ghlUserId: p.ghlUserId }));
  const bonusCentsFor = (month: string) => resolveSettings(settingsRows, month).bookingBonusCents;
  const commissionPctFor = (month: string) => resolveSettings(settingsRows, month).commissionPct;

  // A proposal's contact name is the best company label we have when the contact record is thin.
  const proposalName = new Map(props.map((p) => [p.contactId, p.contactName]));

  const facts: SetterFacts = {
    setterId,
    now,
    appointments: appointments.map((a) => ({
      id: a.id, contactId: a.contactId, calendarName: a.calendarName, assignedUserId: a.assignedUserId,
      createdByUserId: a.createdByUserId, dateAdded: a.dateAdded, startTime: a.startTime, status: a.status,
      deletedAt: a.deletedAt, movedToCalendarId: a.movedToCalendarId,
    })),
    links: links.filter((l) => l.appointmentId).map((l) => ({ appointmentId: l.appointmentId!, sentByUserId: l.sentByUserId, delivery: l.delivery })),
    people: peopleList,
    opportunities: opps.filter((o) => o.contactId).map((o) => ({
      contactId: o.contactId!, assignedTo: o.assignedTo, status: o.status, deleted: !!o.deletedAt,
    })),
    decisions: decisions.map((d) => ({
      appointmentId: d.appointmentId, manualRowId: d.manualRowId, setterUserId: d.setterUserId,
      decision: d.decision as "claim" | "reject", contactId: d.contactId, contactName: d.contactName,
      companyName: d.companyName, bookedAt: d.bookedAt, callAt: d.callAt, decidedBy: d.decidedBy, decidedAt: d.decidedAt,
    })),
    trackerOutcomes: trackerOutcomes.map((t) => ({
      rowRef: t.rowRef, outcome: t.outcome as "held" | "no_show", forStartTime: t.forStartTime, recordedBy: t.recordedBy, recordedAt: t.recordedAt,
    })),
    dispositions: dispositions.filter((x) => x.eventId).map((x) => ({
      eventId: x.eventId!, outcome: x.outcome, at: x.at, createdByUserId: x.createdByUserId,
    })),
    contacts: contacts.map((c) => ({
      contactId: c.id,
      name: c.fullName || [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
      company: c.company || proposalName.get(c.id) || null,
    })),
    proposals: props.map((p) => ({
      id: p.id, contactId: p.contactId, title: p.title, totalAmount: p.totalAmount,
      sentAt: p.sentAt, signedAt: p.signedAt, paidAt: p.paidAt, lostAt: p.lostAt,
    })),
    commissionEvents: events.map((e) => ({ proposalId: e.proposalId, date: e.date, baseAmount: e.commission, sublabel: e.sublabel })),
    overrides: overrides
      .filter((o) => o.subjectUserId === setterId && o.field !== "outcome" && o.field !== "callAt")
      .map((o) => ({ rowKey: o.rowKey, field: o.field, value: o.value, editedBy: o.editedBy, editedAt: o.editedAt })),
    rowOverrides: overrides
      .filter((o) => o.field === "outcome" || o.field === "callAt")
      .map((o) => ({ rowKey: o.rowKey, field: o.field, value: o.value, editedBy: o.editedBy, editedAt: o.editedAt })),
    bonusCentsFor,
    commissionPctFor,
  };
  return { facts, settingsRows, payoutTiming };
}
