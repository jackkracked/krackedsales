/**
 * GHL datasets — opportunities and appointments.
 *
 * `ghl.opportunities` reuses the `fetchAllGhlOpps` paginate pattern from the
 * dashboard route (search endpoint, 100/page). Rows carry display fields only
 * (name, status, value, source, ids for filtering). `monetaryValue` is already
 * in dollars from GHL. Date fields (createdAt, updatedAt) are epoch ms.
 *
 * `ghl.appointments` — a TRUE read of GoHighLevel calendar bookings. We list
 * every calendar on the location, fetch its events for the window, and emit one
 * row per appointment carrying its calendar + appointment status + contact. The
 * "Booked Calls" metric is then `count` filtered to the calendar(s) that matter
 * (e.g. the intro-call calendar), so each funnel can count exactly the calls it
 * cares about. The drill-down lists every appointment, so the number is provable.
 */
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import type { DatasetDef, LoadCtx, RawRow } from "../types";

const toMs = (d: Date | string | null | undefined): number | null =>
  d ? new Date(d).getTime() : null;

/** Fetch ALL GHL opportunities for a query base, paginating past the 100 limit. */
async function fetchAllGhlOpps(queryBase: string): Promise<GHLOpportunity[]> {
  const all: GHLOpportunity[] = [];
  try {
    const first = await ghl.get<{ opportunities: GHLOpportunity[]; meta?: { total?: number } }>(
      `${queryBase}&limit=100&page=1`,
    );
    all.push(...(first.opportunities ?? []));
    const total = first.meta?.total ?? first.opportunities?.length ?? 0;
    const pages = Math.ceil(total / 100);
    if (pages > 1) {
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          ghl.get<{ opportunities: GHLOpportunity[] }>(`${queryBase}&limit=100&page=${i + 2}`),
        ),
      );
      for (const page of rest) all.push(...(page.opportunities ?? []));
    }
  } catch (err) {
    console.error("[kpi/datasets/ghl.opportunities] GHL fetch failed:", err);
  }
  return all;
}

// ════════════════════════════════════════════════════════════════════════════
//  ghl.opportunities
// ════════════════════════════════════════════════════════════════════════════

export const ghlOpportunities: DatasetDef = {
  key: "ghl.opportunities",
  integration: "ghl",
  label: "Pipeline deals (CRM)",
  description: "Deals in your CRM pipeline — open, won, or lost.",
  fields: [
    {
      key: "status",
      label: "Deal status",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "open", label: "Open" },
        { value: "won", label: "Won" },
        { value: "lost", label: "Lost" },
        { value: "abandoned", label: "Gone cold" },
      ],
    },
    { key: "monetaryValue", label: "Deal value", type: "money", operators: ["gt", "lt", "between"] },
    {
      key: "pipelineId",
      label: "Pipeline",
      type: "enum",
      operators: ["eq", "neq", "in"],
      // Populated from /api/ghl/pipelines by the configurator. Value = pipeline id.
      enumValues: [],
    },
    {
      key: "pipelineStageId",
      label: "Pipeline stage",
      type: "enum",
      operators: ["eq", "neq", "in"],
      // Populated from /api/ghl/pipelines stages by the configurator. Value = stage id.
      enumValues: [],
    },
    {
      key: "assignedTo",
      label: "Assigned rep",
      type: "enum",
      operators: ["eq", "neq", "in", "is_set", "is_not_set"],
      // Populated from GHL users by the configurator. Value = ghl user id.
      enumValues: [],
    },
    { key: "source", label: "Lead source", type: "string", operators: ["contains", "eq", "is_set", "is_not_set"] },
  ],
  dateFields: [
    { key: "createdAt", label: "Date created" },
    { key: "updatedAt", label: "Date last updated" },
  ],
  aggregations: ["count", "sum"],
  rowLabel: (row: RawRow) => ({
    // Deal name first, then the contact's name — never a raw id.
    label: (row.name as string) || (row.contactName as string) || "Opportunity",
    sublabel: (row.source as string) || (row.status as string) || undefined,
  }),
  rowAmount: (row: RawRow) => Number(row.monetaryValue ?? 0),
  load: async ({ ctx }: LoadCtx): Promise<RawRow[]> => {
    try {
      const locId = locationId();
      // Rep scoping: a non-admin rep with a GHL user id only sees their own opps.
      const ghlUserId = ctx.isAdmin === false ? (ctx as { ghlUserId?: string }).ghlUserId : undefined;
      const queryBase = ghlUserId
        ? `/opportunities/search?location_id=${locId}&assigned_to=${ghlUserId}`
        : `/opportunities/search?location_id=${locId}`;
      const opps = await fetchAllGhlOpps(queryBase);
      return opps.map((o) => ({
        name: o.name,
        // Contact name as a readable fallback when the deal itself is unnamed.
        contactName: o.contact?.name ?? "",
        status: o.status,
        monetaryValue: o.monetaryValue ?? 0, // dollars
        pipelineId: o.pipelineId ?? "",
        pipelineStageId: o.pipelineStageId ?? "",
        assignedTo: o.assignedTo ?? "",
        source: o.source ?? "",
        createdAt: toMs(o.createdAt),
        updatedAt: toMs(o.updatedAt),
      }));
    } catch (e) {
      console.error("[kpi/datasets/ghl.opportunities] fetch failed:", e);
      return [];
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════
//  ghl.appointments — a TRUE read of GoHighLevel calendar bookings
// ════════════════════════════════════════════════════════════════════════════

interface GHLApptEvent {
  id?: string;
  title?: string;
  /** Newer field name; older payloads use `status`. */
  appointmentStatus?: string;
  status?: string;
  startTime?: string;
  contactName?: string;
  calendarId?: string;
}

/** List every calendar on the location. value = id, label = name. */
async function fetchAllCalendars(): Promise<{ id: string; name: string }[]> {
  try {
    const data = await ghl.get<{ calendars?: { id: string; name: string }[] }>(
      `/calendars/?locationId=${locationId()}`,
    );
    return (data.calendars ?? []).filter((c) => c.id).map((c) => ({ id: c.id, name: c.name ?? c.id }));
  } catch (e) {
    console.error("[kpi/datasets/ghl.appointments] calendar list failed:", e);
    return [];
  }
}

/** Fetch one calendar's events for the window (epoch ms). Self-degrades to []. */
async function fetchCalendarEvents(calendarId: string, startMs: number, endMs: number): Promise<GHLApptEvent[]> {
  try {
    const data = await ghl.get<{ events?: GHLApptEvent[] }>(
      `/calendars/events?locationId=${locationId()}&calendarId=${calendarId}&startTime=${startMs}&endTime=${endMs}`,
    );
    return data.events ?? [];
  } catch (e) {
    console.error(`[kpi/datasets/ghl.appointments] events fetch failed for ${calendarId}:`, e);
    return [];
  }
}

export const ghlAppointments: DatasetDef = {
  key: "ghl.appointments",
  integration: "ghl",
  label: "Booked calls (calendar)",
  description:
    "Calls booked into your GoHighLevel calendars. Filter to the calendar(s) that count as a booked call (e.g. your intro-call calendar).",
  fields: [
    {
      key: "calendarId",
      label: "Calendar",
      type: "enum",
      operators: ["eq", "neq", "in"],
      // Populated from the live GHL calendar list by the configurator. Value = calendar id.
      enumValues: [],
    },
    {
      key: "status",
      label: "Appointment status",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "confirmed", label: "Confirmed" },
        { value: "showed", label: "Showed up" },
        { value: "noshow", label: "No-show" },
        { value: "cancelled", label: "Cancelled" },
        { value: "invalid", label: "Invalid" },
      ],
    },
  ],
  dateFields: [{ key: "startTime", label: "Date of the call" }],
  aggregations: ["count"],
  rowLabel: (row: RawRow) => ({
    label: (row.contactName as string) || (row.title as string) || "Appointment",
    sublabel: [row.calendarName as string, row.status as string].filter(Boolean).join(" · ") || undefined,
  }),
  load: async ({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> => {
    try {
      const cals = await fetchAllCalendars();
      if (cals.length === 0) return [];
      const startMs = fetchStart.getTime();
      const endMs = fetchEnd.getTime();

      // One events call per calendar, in parallel.
      const perCal = await Promise.all(
        cals.map(async (cal) => ({ cal, events: await fetchCalendarEvents(cal.id, startMs, endMs) })),
      );

      const rows: RawRow[] = [];
      for (const { cal, events } of perCal) {
        for (const e of events) {
          const status = (e.appointmentStatus ?? e.status ?? "").toLowerCase();
          const ms = e.startTime ? new Date(e.startTime).getTime() : null;
          rows.push({
            // calendarId comes from the calendar we queried (guaranteed to match the
            // filter's enum value), never the event payload which can omit it.
            calendarId: cal.id,
            calendarName: cal.name,
            status: status || "confirmed",
            contactName: e.contactName ?? e.title ?? "Appointment",
            title: e.title ?? "",
            startTime: ms, // epoch ms
          });
        }
      }
      return rows;
    } catch (e) {
      console.error("[kpi/datasets/ghl.appointments] fetch failed:", e);
      return [];
    }
  },
};
