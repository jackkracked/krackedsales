/**
 * ════════════════════════════════════════════════════════════════════════════
 *  CONFIGURABLE KPI ENGINE — the shared contract.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Every KPI on /kpis can be admin-configured: pick a dataset (scope), an
 * aggregation, filters, and a date field. A saved config is DATA; the Query Engine
 * compiles it into a real query and returns {value, prev, series, rows}. One engine
 * feeds the card, the drawer, the live preview, AND the dashboard — so they can
 * never disagree.
 *
 * Safety: configs are an OVERRIDE layer. If a metric has an enabled config, the
 * engine drives it; otherwise the legacy compute (or 0) runs. Nothing regresses
 * until a KPI is explicitly wired. Filters are TYPED — fields/operators/values are
 * chosen from a known catalog per dataset, so a malformed/typo'd config can't exist.
 */

// ─── Period ──────────────────────────────────────────────────────────────────

/** The selected reporting window. Matches the existing `parseRange` output. */
export interface Range {
  start: Date;
  end: Date;
}

/** Request-scoped context (admin vs rep scoping, etc.). */
export interface EngineCtx {
  /** When set, rep-scoped datasets filter to this rep (email) / user. */
  repEmail?: string | null;
  userId?: string | null;
  /** GHL user id for rep-scoping GHL datasets (opportunities by assignee). */
  ghlUserId?: string | null;
  isAdmin?: boolean;
}

// ─── Fields, operators, aggregations ─────────────────────────────────────────

export type IntegrationKey =
  | "stripe"
  | "ghl"
  | "meta"
  | "clickup"
  | "proposals"
  | "calls"
  | "internal"
  | "manual";

export type FieldType = "money" | "count" | "date" | "string" | "enum" | "boolean";

export type Operator =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "in"
  | "between"
  | "is_set"
  | "is_not_set";

export interface FieldDef {
  /** Stable id, e.g. "status". Also the key on the RawRow the engine reads. */
  key: string;
  label: string;
  type: FieldType;
  /** Operators legal for THIS field (drives the configurator UI). */
  operators: Operator[];
  /** For type:"enum" — drives a dropdown, never free text. */
  enumValues?: { value: string; label: string }[];
}

export interface DateFieldDef {
  key: string;
  label: string;
}

export type AggOp = "count" | "sum" | "avg" | "ratio" | "combine";

export type Aggregation =
  | { op: "count" }
  | { op: "sum"; field: string }
  | { op: "avg"; field: string }
  | { op: "ratio"; numerator: string; denominator: string } // two other metricKeys
  // Add up (or subtract) other KPIs — e.g. Total Expenses = Software + Ads + Other.
  | { op: "combine"; terms: { metricKey: string; sign: 1 | -1 }[] };

export interface FilterClause {
  field: string;
  op: Operator;
  value: string | string[] | number | [number, number] | boolean;
}

// ─── Datasets ────────────────────────────────────────────────────────────────

/** A normalized row from a dataset's `load()`. Keys match the dataset's FieldDefs + dateFields. */
export type RawRow = Record<string, unknown>;

export interface LoadCtx {
  /** Widest window the engine needs (covers prev-period + current + trend buckets). */
  fetchStart: Date;
  fetchEnd: Date;
  ctx: EngineCtx;
}

export interface DrillRow {
  id?: string;
  label: string;
  sublabel?: string;
  amount?: number; // for currency drill-downs
  date?: string; // ISO
}

/**
 * A queryable dataset. `load()` fetches the universe ONCE for the widest window;
 * the engine then filters → date-buckets → aggregates in memory (reusing buckets.ts).
 * This mirrors the existing stripe-series / meta-series / detail-route pattern.
 */
export interface DatasetDef {
  key: string; // "stripe.charges"
  integration: IntegrationKey;
  label: string; // "Stripe — Charges"
  description: string;
  fields: FieldDef[];
  dateFields: DateFieldDef[];
  /** Aggregation ops that make sense for this dataset. */
  aggregations: AggOp[];
  /** Display label for a drill-down row. */
  rowLabel: (row: RawRow) => { label: string; sublabel?: string };
  /** Currency amount for a drill-down row (omit for count datasets). */
  rowAmount?: (row: RawRow) => number;
  /** Fetch the normalized universe once. MUST NOT leak secrets/PII beyond display fields. */
  load: (ctx: LoadCtx) => Promise<RawRow[]>;
}

/** Client-safe description of a dataset (no functions) — powers the configurator dropdowns. */
export interface DatasetDescriptor {
  key: string;
  integration: IntegrationKey;
  label: string;
  description: string;
  fields: FieldDef[];
  dateFields: DateFieldDef[];
  aggregations: AggOp[];
}

export function describeDataset(d: DatasetDef): DatasetDescriptor {
  return {
    key: d.key,
    integration: d.integration,
    label: d.label,
    description: d.description,
    fields: d.fields,
    dateFields: d.dateFields,
    aggregations: d.aggregations,
  };
}

// ─── Config + result ─────────────────────────────────────────────────────────

/** The saved (or draft) configuration for one metric. Mirrors the `kpi_configs` row. */
export interface MetricConfig {
  metricKey: string;
  dataset: string; // a DatasetDef.key (or "ratio" / "manual")
  aggregation: Aggregation;
  filters: FilterClause[];
  dateField: string | null; // null => snapshot/level metric
  unit: MetricUnit;
  enabled: boolean;
}

export type MetricUnit = "currency" | "count" | "percent" | "ratio";

/** Engine output for one metric. Drives card, drawer, preview, dashboard tile. */
export interface MetricResult {
  value: number;
  prev: number;
  series: number[];
  rows: DrillRow[];
  unit: MetricUnit;
  /** true when there is no enabled config (and no legacy fallback fired) — the ghost state. */
  unconfigured?: boolean;
  /** present on preview/draft runs: total rows matched. */
  count?: number;
}

/** The validated body accepted by the config write routes (whitelist — no mass-assignment). */
export interface MetricConfigInput {
  metricKey: string;
  dataset: string;
  aggregation: Aggregation;
  filters: FilterClause[];
  dateField: string | null;
  unit: MetricUnit;
  enabled: boolean;
}
