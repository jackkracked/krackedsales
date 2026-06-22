/**
 * ════════════════════════════════════════════════════════════════════════════
 *  REGISTRY HYDRATION — fill the async `enumValues` on configurator dropdowns.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Several dataset FieldDefs ship with `enumValues: []` because their options
 * can't be known synchronously at module load — they come from the DB or GHL
 * (app users, GHL pipelines/stages, calendars). `describeRegistry()` returns the
 * static (client-safe) descriptors; this module takes those descriptors and
 * fills the empty enums with LIVE options, so the configurator shows real
 * choices instead of empty dropdowns.
 *
 * VALUES match what the engine filters on (raw ids / emails), because session-
 * injected rep filters compare against the same raw values:
 *   - proposals.createdBy / demo_boards.repId   → users.id
 *   - calls.repEmail                            → users.email
 *   - ghl.opportunities.assignedTo              → users.ghlUserId
 *   - ghl.opportunities.pipelineId              → local_pipelines.id
 *   - ghl.opportunities.pipelineStageId         → local_pipelines.stages[].id
 *   - ghl.appointments.calendarId               → user_calendars.ghlCalendarId
 *
 * Safety: every source is wrapped in try/catch and resolved in parallel. A
 * failure for any one source degrades that field to an empty dropdown — it NEVER
 * throws, so the registry route can never 500 because of hydration.
 */
import { db } from "@/lib/db";
import { users, localPipelines } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import type { DatasetDescriptor, FieldDef } from "./types";

type EnumOption = { value: string; label: string };

/** All option sets needed to hydrate the registry, fetched once. */
interface HydrationSources {
  /** App users keyed for id-based filters. value = user id, label = name. */
  usersById: EnumOption[];
  /** App users for email-based filters. value = email, label = name. */
  usersByEmail: EnumOption[];
  /** App users that have a linked GHL user id. value = ghlUserId, label = name. */
  ghlUsers: EnumOption[];
  /** GHL pipelines. value = pipeline id, label = name. */
  pipelines: EnumOption[];
  /** Flattened GHL pipeline stages. value = stage id, label = "Pipeline — Stage". */
  pipelineStages: EnumOption[];
  /** Rep calendars. value = ghlCalendarId, label = repName. */
  calendars: EnumOption[];
  /** ClickUp statuses across the demo + audit lists. value = lowercased status. */
  clickupStatuses: EnumOption[];
}

/** Fetch app users once; derive the three user-shaped option lists from it. */
async function loadUsers(): Promise<
  Pick<HydrationSources, "usersById" | "usersByEmail" | "ghlUsers">
> {
  try {
    const rows = await db()
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        ghlUserId: users.ghlUserId,
      })
      .from(users)
      .orderBy(asc(users.name));

    return {
      usersById: rows.map((r) => ({ value: r.id, label: r.name })),
      usersByEmail: rows.map((r) => ({ value: r.email, label: r.name })),
      ghlUsers: rows
        .filter((r) => !!r.ghlUserId)
        .map((r) => ({ value: r.ghlUserId as string, label: r.name })),
    };
  } catch (e) {
    console.error("[kpi/hydrate] users load failed:", e);
    return { usersById: [], usersByEmail: [], ghlUsers: [] };
  }
}

/**
 * Fetch GHL pipelines + stages from the local mirror (`local_pipelines`), the
 * same source `/api/ghl/pipelines` reads first. Stages are flattened into a
 * single option list labelled "Pipeline — Stage" so a stage filter is readable.
 */
async function loadPipelines(): Promise<
  Pick<HydrationSources, "pipelines" | "pipelineStages">
> {
  try {
    const rows = await db()
      .select({
        id: localPipelines.id,
        name: localPipelines.name,
        stages: localPipelines.stages,
      })
      .from(localPipelines)
      .orderBy(asc(localPipelines.name));

    const pipelines: EnumOption[] = rows.map((r) => ({ value: r.id, label: r.name }));

    const pipelineStages: EnumOption[] = [];
    for (const p of rows) {
      const stages =
        (p.stages as Array<{ id: string; name: string; position?: number }> | null) ?? [];
      for (const s of stages) {
        if (!s?.id) continue;
        pipelineStages.push({ value: s.id, label: `${p.name} — ${s.name ?? s.id}` });
      }
    }

    return { pipelines, pipelineStages };
  } catch (e) {
    console.error("[kpi/hydrate] pipelines load failed:", e);
    return { pipelines: [], pipelineStages: [] };
  }
}

/**
 * Fetch EVERY GHL calendar on the location (not just rep calendars), so the
 * "Booked Calls" filter lists every calendar an admin might count — value =
 * GHL calendar id (exactly what `ghl.appointments` rows carry).
 */
async function loadCalendars(): Promise<Pick<HydrationSources, "calendars">> {
  try {
    const { ghl, locationId } = await import("@/lib/ghl/client");
    const data = await ghl.get<{ calendars?: { id: string; name: string }[] }>(
      `/calendars/?locationId=${locationId()}`,
    );
    return {
      calendars: (data.calendars ?? [])
        .filter((c) => !!c.id)
        .map((c) => ({ value: c.id, label: c.name || c.id })),
    };
  } catch (e) {
    console.error("[kpi/hydrate] calendars load failed:", e);
    return { calendars: [] };
  }
}

/**
 * Fetch the real ClickUp statuses from the configured demo + audit lists, in their
 * board order, so the "Task status" filter shows actual chips (e.g. "copy",
 * "scheduled/live") instead of an empty dropdown. value = lowercased status (what
 * the dataset stores). De-duped across lists, order preserved.
 */
async function loadClickupStatuses(): Promise<Pick<HydrationSources, "clickupStatuses">> {
  try {
    const listIds = [process.env.CLICKUP_DEMO_LIST_ID, process.env.CLICKUP_AUDIT_LIST_ID].filter(
      (x): x is string => !!x,
    );
    if (listIds.length === 0) return { clickupStatuses: [] };
    const { clickup } = await import("@/lib/clickup/client");
    const seen = new Set<string>();
    const out: EnumOption[] = [];
    for (const id of listIds) {
      try {
        const list = await clickup.get<{ statuses?: { status: string; orderindex: number }[] }>(`/list/${id}`);
        const statuses = (list.statuses ?? []).slice().sort((a, b) => a.orderindex - b.orderindex);
        for (const s of statuses) {
          const value = (s.status ?? "").toLowerCase();
          if (!value || seen.has(value)) continue;
          seen.add(value);
          out.push({ value, label: s.status });
        }
      } catch (e) {
        console.error(`[kpi/hydrate] clickup statuses for list ${id} failed:`, e);
      }
    }
    return { clickupStatuses: out };
  } catch (e) {
    console.error("[kpi/hydrate] clickup statuses load failed:", e);
    return { clickupStatuses: [] };
  }
}

/** Resolve every option source in parallel. Each source self-degrades to []. */
async function loadSources(): Promise<HydrationSources> {
  const [u, p, c, cu] = await Promise.all([
    loadUsers(),
    loadPipelines(),
    loadCalendars(),
    loadClickupStatuses(),
  ]);
  return { ...u, ...p, ...c, ...cu };
}

/** dataset.key → (field.key → option list). The hydration plan. */
function plan(s: HydrationSources): Record<string, Record<string, EnumOption[]>> {
  return {
    proposals: { createdBy: s.usersById },
    demo_boards: { repId: s.usersById },
    calls: { repEmail: s.usersByEmail },
    "ghl.opportunities": {
      pipelineId: s.pipelines,
      pipelineStageId: s.pipelineStages,
      assignedTo: s.ghlUsers,
    },
    "ghl.appointments": { calendarId: s.calendars },
    // clickup.tasks.status is hydrated from the real demo + audit list statuses
    // (in board order) so filters like "gone into copy" show actual chips. listId
    // is already filled from env at module load.
    "clickup.tasks": { status: s.clickupStatuses },
  };
}

/** Return a field with its enumValues replaced ONLY if we have options for it. */
function fillField(field: FieldDef, options: EnumOption[] | undefined): FieldDef {
  if (!options || options.length === 0) return field;
  return { ...field, enumValues: options };
}

/**
 * Hydrate descriptors with live enum options. Pure mapping over a fresh copy —
 * the static registry is never mutated. NEVER throws: any source-level failure
 * already degraded to [] in loadSources(), and an empty option list leaves the
 * field's shipped enumValues untouched.
 */
export async function hydrateRegistry(
  descriptors: DatasetDescriptor[],
): Promise<DatasetDescriptor[]> {
  const sources = await loadSources();
  const byDataset = plan(sources);

  return descriptors.map((d) => {
    const fieldPlan = byDataset[d.key];
    if (!fieldPlan) return d;
    return {
      ...d,
      fields: d.fields.map((f) => fillField(f, fieldPlan[f.key])),
    };
  });
}
