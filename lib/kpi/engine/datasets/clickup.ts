/**
 * ClickUp tasks dataset.
 *
 * Reuses the funnel route's fetch shape: `GET /list/{id}/task` with
 * date_created bounds, paginating until a short page. The configured list ids
 * come from env (the demo + audit lists already used elsewhere) — the `listId`
 * filter selects among them.
 *
 * Date fields date_created / date_closed are epoch ms (Number). ClickUp returns
 * these as millisecond unix strings, so they map directly. Count only.
 */
import { clickup } from "@/lib/clickup/client";
import type { DatasetDef, LoadCtx, RawRow } from "../types";

interface ClickUpTask {
  id: string;
  name: string;
  status?: { status?: string };
  date_created?: string; // unix ms as string
  date_closed?: string | null; // unix ms as string | null
  date_done?: string | null; // unix ms as string | null — set when moved to a done/closed status
  parent?: string | null;
}

/** The ClickUp lists this dataset can read, from env. Empty ids are skipped. */
function configuredListIds(): { id: string; label: string }[] {
  // Trim env values: a trailing newline would both corrupt the fetch URL and make
  // the row's listId mismatch a clean filter value (silently zeroing the metric).
  const demo = process.env.CLICKUP_DEMO_LIST_ID?.trim();
  const audit = process.env.CLICKUP_AUDIT_LIST_ID?.trim();
  const out: { id: string; label: string }[] = [];
  if (demo) out.push({ id: demo, label: "Demos" });
  if (audit) out.push({ id: audit, label: "Account Audits" });
  return out;
}

/**
 * Fetch a list's tasks for the window, by EITHER date_created OR date_done.
 *
 * A "completed" metric is dated by date_done — and a demo completed this month was
 * usually CREATED weeks earlier, so a date_created-only fetch silently misses it
 * (the cause of "2" when the real number was 41). We fetch both windows and merge
 * by id, so the engine can then filter on whichever date field the metric uses.
 */
async function fetchListTasks(listId: string, startMs: number, endMs: number): Promise<ClickUpTask[]> {
  async function byField(field: "date_created" | "date_done"): Promise<ClickUpTask[]> {
    const out: ClickUpTask[] = [];
    let page = 0;
    while (true) {
      const res = await clickup.get<{ tasks: ClickUpTask[] }>(
        `/list/${listId}/task?page=${page}&subtasks=false&include_closed=true&${field}_gt=${startMs}&${field}_lt=${endMs}`,
      );
      const tasks = res.tasks ?? [];
      out.push(...tasks);
      if (tasks.length < 100) break;
      page++;
    }
    return out;
  }
  const [created, done] = await Promise.all([byField("date_created"), byField("date_done")]);
  const merged = new Map<string, ClickUpTask>();
  for (const t of created) merged.set(t.id, t);
  for (const t of done) merged.set(t.id, t);
  return [...merged.values()];
}

const toMs = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const clickupTasks: DatasetDef = {
  key: "clickup.tasks",
  integration: "clickup",
  label: "Tasks (ClickUp)",
  description: "Work tracked in ClickUp — your demo and audit task lists.",
  fields: [
    {
      key: "listId",
      label: "List",
      type: "enum",
      operators: ["eq", "neq", "in"],
      // Built from env-configured lists at module load (best-effort; the
      // configurator can refine). Value = ClickUp list id.
      enumValues: configuredListIds().map((l) => ({ value: l.id, label: l.label })),
    },
    {
      key: "status",
      label: "Task status",
      type: "enum",
      operators: ["eq", "neq", "in"],
      // ClickUp statuses are space-specific and free-form; left open for the
      // configurator to populate from observed values. Value = lowercased status.
      enumValues: [],
    },
    { key: "parent_is_null", label: "Main tasks only (no sub-tasks)?", type: "boolean", operators: ["eq"] },
  ],
  dateFields: [
    { key: "date_created", label: "Date created" },
    { key: "date_done", label: "Date done (sent/completed)" },
    { key: "date_closed", label: "Date closed" },
  ],
  aggregations: ["count"],
  rowLabel: (row: RawRow) => ({
    label: (row.name as string) || "Task",
    sublabel: (row.status as string) || undefined,
  }),
  load: async ({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> => {
    const lists = configuredListIds();
    if (!lists.length) return [];
    const startMs = fetchStart.getTime();
    const endMs = fetchEnd.getTime();
    const rows: RawRow[] = [];
    for (const list of lists) {
      try {
        const tasks = await fetchListTasks(list.id, startMs, endMs);
        for (const t of tasks) {
          rows.push({
            id: t.id,
            name: t.name,
            listId: list.id,
            status: t.status?.status?.toLowerCase() ?? "",
            parent_is_null: t.parent == null,
            date_created: toMs(t.date_created), // epoch ms
            date_done: toMs(t.date_done), // epoch ms | null — when it went done/sent
            date_closed: toMs(t.date_closed), // epoch ms | null
          });
        }
      } catch (e) {
        console.error(`[kpi/datasets/clickup.tasks] list ${list.id} fetch failed:`, e);
      }
    }
    return rows;
  },
};
