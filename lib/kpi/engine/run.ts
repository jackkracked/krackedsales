/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE QUERY ENGINE — compiles one MetricConfig into {value, prev, series, rows}.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * One function feeds the card, the drawer, the live preview AND the dashboard, so
 * they can never disagree. The shape mirrors the existing stripe-series /
 * detail-route pattern: load the dataset universe ONCE for the widest window
 * (prevStart..end), then filter → date-bucket → aggregate in memory.
 *
 * Two modes:
 *   - dateField == null  → snapshot/level metric. Aggregate the WHOLE filtered
 *     universe (the value "as of now"); the trend comes from metric_snapshots and
 *     `prev` is the first point of that series.
 *   - dateField != null  → period metric. `value` aggregates rows whose dateField
 *     falls in [start, end); `prev` aggregates [prevStart, prevEnd) (the
 *     immediately-preceding equal-length window); the trend is bucket-aggregated.
 *
 * Ratios recurse: the numerator and denominator are themselves metricKeys, each
 * loaded via getConfig + run through this same engine, then divided.
 */
import {
  getAdaptiveBuckets,
  bucketCount,
  bucketSum,
  type Bucket,
} from "@/lib/kpi/buckets";
import { readSnapshotSeries } from "@/lib/kpi/snapshots";
import type {
  MetricConfig,
  Range,
  EngineCtx,
  MetricResult,
  Aggregation,
  FilterClause,
  Operator,
  RawRow,
  DatasetDef,
  FieldDef,
  DrillRow,
} from "./types";
import { getDataset } from "./datasets";
import { getConfig } from "./configs";

// ─── Public entry ────────────────────────────────────────────────────────────

/**
 * Compile + execute a config against a range. `ctx` carries admin/rep scoping
 * which the dataset's `load()` honours. Returns the unified MetricResult.
 */
export async function run(
  config: MetricConfig,
  range: Range,
  ctx: EngineCtx,
): Promise<MetricResult> {
  // Ratios + combines have no dataset rows of their own — they compose other
  // metrics. Handle before touching the registry.
  if (config.aggregation.op === "ratio") {
    return runRatio(config, config.aggregation, range, ctx);
  }
  if (config.aggregation.op === "combine") {
    return runCombine(config, config.aggregation, range, ctx);
  }

  const ds = getDataset(config.dataset);
  if (!ds) {
    // Unknown / virtual ("manual") dataset with a non-ratio op — nothing to read.
    return { value: 0, prev: 0, series: [], rows: [], unit: config.unit, count: 0 };
  }

  const { start, end } = range;
  const { prevStart, prevEnd } = previousWindow(start, end);

  // Load the universe ONCE for the widest window the engine needs.
  const universe = await ds.load({ fetchStart: prevStart, fetchEnd: end, ctx });
  const filtered = universe.filter((row) =>
    config.filters.every((f) => applyOperator(row, f, ds.fields)),
  );

  const buckets = getAdaptiveBuckets(start, end);

  let value: number;
  let prev: number;
  let series: number[];
  // The set of records that ACTUALLY make up `value` — so the count, the displayed
  // rows, and the value always describe the same thing (a hard requirement for
  // trust: the preview must never say "28 records" for a value built from 3).
  let displaySet: RawRow[];

  if (config.dateField == null) {
    // ── Snapshot / level metric ── value = the whole filtered universe as-of now.
    value = aggregateRows(filtered, config.aggregation);
    const snapSeries = await readSnapshotSeries(config.metricKey, buckets);
    series = snapSeries ?? [];
    // First series point ≈ the value at the start of the window → use as `prev`.
    prev = snapSeries && snapSeries.length > 0 ? snapSeries[0] : value;
    displaySet = filtered;
  } else {
    // ── Period metric ── value = only rows whose dateField falls in [start, end).
    const dateField = config.dateField;
    const inRange = filtered.filter((r) => dateIn(r[dateField], start, end));
    const prevRange = filtered.filter((r) => dateIn(r[dateField], prevStart, prevEnd));
    value = aggregateRows(inRange, config.aggregation);
    prev = aggregateRows(prevRange, config.aggregation);
    series = bucketAggregate(filtered, dateField, config.aggregation, buckets);
    displaySet = inRange;
  }

  const rows = buildDrillRows(displaySet, ds, config);

  return {
    value,
    prev,
    series,
    rows,
    unit: config.unit,
    count: displaySet.length,
  };
}

// ─── Ratio composition ───────────────────────────────────────────────────────

async function runRatio(
  config: MetricConfig,
  agg: Extract<Aggregation, { op: "ratio" }>,
  range: Range,
  ctx: EngineCtx,
): Promise<MetricResult> {
  const [numConfig, denConfig] = await Promise.all([
    getConfig(agg.numerator),
    getConfig(agg.denominator),
  ]);

  // A missing child config means the ratio cannot be computed — fail soft to 0.
  if (!numConfig || !denConfig) {
    return { value: 0, prev: 0, series: [], rows: [], unit: config.unit, count: 0 };
  }

  const [num, den] = await Promise.all([
    run(numConfig, range, ctx),
    run(denConfig, range, ctx),
  ]);

  // A "percent" ratio is expressed out of 100 (booking rate 38%, not 0.38×) — the
  // rest of the app stores percentages as 0–100 numbers and just appends "%", so
  // scale here. Plain ratios (ROAS 4.2×, CPL $/lead) are left as the raw quotient.
  const scale = config.unit === "percent" ? 100 : 1;
  const value = safeDivide(num.value, den.value) * scale;
  const prev = safeDivide(num.prev, den.prev) * scale;
  // Element-wise series ratio over the shorter of the two trends.
  const len = Math.min(num.series.length, den.series.length);
  const series = Array.from({ length: len }, (_, i) => safeDivide(num.series[i], den.series[i]) * scale);

  // Drill-down for a ratio shows the two component numbers + the formula.
  const rows: DrillRow[] = [
    { id: "numerator", label: agg.numerator, sublabel: "numerator", amount: num.value },
    { id: "denominator", label: agg.denominator, sublabel: "denominator", amount: den.value },
  ];

  return { value, prev, series, rows, unit: config.unit };
}

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

// ─── Combine composition (add up / subtract other KPIs) ──────────────────────

/**
 * A composite metric: run each child config through this same engine, multiply by
 * its sign (+1 add / −1 subtract), and total them. e.g. Total Expenses = Software +
 * Ads + Other; Net P&L = Money in − Total Expenses. The drill-down lists each
 * component + its contribution, so the total is always explainable.
 */
async function runCombine(
  config: MetricConfig,
  agg: Extract<Aggregation, { op: "combine" }>,
  range: Range,
  ctx: EngineCtx,
): Promise<MetricResult> {
  const children = await Promise.all(
    agg.terms.map(async (t) => {
      const child = await getConfig(t.metricKey);
      return { key: t.metricKey, sign: t.sign, result: child ? await run(child, range, ctx) : null };
    }),
  );

  let value = 0;
  let prev = 0;
  let seriesLen = 0;
  for (const c of children) {
    if (!c.result) continue;
    value += c.sign * c.result.value;
    prev += c.sign * c.result.prev;
    seriesLen = Math.max(seriesLen, c.result.series.length);
  }
  const series = Array.from({ length: seriesLen }, (_, i) =>
    children.reduce((s, c) => s + (c.result ? c.sign * (c.result.series[i] ?? 0) : 0), 0),
  );
  const rows: DrillRow[] = children.map((c) => ({
    id: c.key,
    label: `${c.sign === -1 ? "− " : "+ "}${c.key}`,
    sublabel: c.result ? undefined : "not configured yet",
    amount: c.result ? c.sign * c.result.value : 0,
  }));

  return { value, prev, series, rows, unit: config.unit, count: children.length };
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/** Aggregate a set of already-filtered rows per the config's aggregation. */
function aggregateRows(rows: RawRow[], agg: Aggregation): number {
  switch (agg.op) {
    case "count":
      return rows.length;
    case "sum":
      return rows.reduce((s, r) => s + toNumber(r[agg.field]), 0);
    case "avg":
      return rows.length === 0
        ? 0
        : rows.reduce((s, r) => s + toNumber(r[agg.field]), 0) / rows.length;
    case "ratio":
      // Ratios never reach here (handled in run/runRatio), but keep exhaustive.
      return 0;
    default:
      return 0;
  }
}

/**
 * Build a trend series: one aggregated value per bucket. count/sum reuse the
 * buckets.ts helpers; avg = bucketed-sum / bucketed-count per bucket.
 */
function bucketAggregate(
  rows: RawRow[],
  dateField: string,
  agg: Aggregation,
  buckets: Bucket[],
): number[] {
  const getDate = (r: RawRow) => r[dateField] as Date | string | null | undefined;

  switch (agg.op) {
    case "count":
      return bucketCount(rows, getDate, buckets);
    case "sum":
      return bucketSum(rows, getDate, (r) => toNumber(r[agg.field]), buckets);
    case "avg": {
      const sums = bucketSum(rows, getDate, (r) => toNumber(r[agg.field]), buckets);
      const counts = bucketCount(rows, getDate, buckets);
      return sums.map((sum, i) => (counts[i] === 0 ? 0 : sum / counts[i]));
    }
    case "ratio":
      return buckets.map(() => 0);
    default:
      return buckets.map(() => 0);
  }
}

// ─── Filtering (typed operators over RawRow values) ──────────────────────────

/** Apply one filter clause against a row. Unknown ops fail closed (exclude). */
function applyOperator(row: RawRow, filter: FilterClause, fields: FieldDef[]): boolean {
  const def = fields.find((f) => f.key === filter.field);
  const raw = row[filter.field];
  const op: Operator = filter.op;

  switch (op) {
    case "is_set":
      return raw !== null && raw !== undefined && raw !== "";
    case "is_not_set":
      return raw === null || raw === undefined || raw === "";
    case "eq":
      return looseEquals(raw, filter.value, def);
    case "neq":
      return !looseEquals(raw, filter.value, def);
    case "contains": {
      const hay = String(raw ?? "").toLowerCase();
      const needle = String(filter.value ?? "").toLowerCase();
      return hay.includes(needle);
    }
    case "gt":
      return toNumber(raw) > toNumber(filter.value);
    case "lt":
      return toNumber(raw) < toNumber(filter.value);
    case "gte":
      return toNumber(raw) >= toNumber(filter.value);
    case "lte":
      return toNumber(raw) <= toNumber(filter.value);
    case "in": {
      const list = Array.isArray(filter.value) ? filter.value : [filter.value];
      return list.some((v) => looseEquals(raw, v as FilterClause["value"], def));
    }
    case "between": {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) return false;
      const [lo, hi] = filter.value as [number, number];
      const isDate = def?.type === "date";
      const n = isDate ? toTime(raw) : toNumber(raw);
      const loN = isDate ? toTime(lo) : toNumber(lo);
      const hiN = isDate ? toTime(hi) : toNumber(hi);
      return n >= loN && n <= hiN;
    }
    default:
      return false;
  }
}

/** Type-aware equality. money/count compare numerically; everything else as string. */
function looseEquals(raw: unknown, value: FilterClause["value"], def?: FieldDef): boolean {
  if (def && (def.type === "money" || def.type === "count")) {
    return toNumber(raw) === toNumber(value);
  }
  if (def && def.type === "boolean") {
    return toBoolean(raw) === toBoolean(value);
  }
  return String(raw ?? "") === String(value ?? "");
}

// ─── Drill rows ──────────────────────────────────────────────────────────────

/**
 * Build drill-down rows from the filtered universe, newest-first. Labels/amounts
 * come from the dataset (display fields only — no raw integration objects).
 */
function buildDrillRows(rows: RawRow[], ds: DatasetDef, config: MetricConfig): DrillRow[] {
  const dateField = config.dateField;

  // The per-row amount must reflect the field the metric actually SUMS/averages —
  // otherwise a drill-down sums one thing while each row shows another (e.g. a
  // metric summing `amount_remaining` whose rows showed `amount_paid` = $0 each).
  // Prefer the aggregation's money field; fall back to the dataset's default.
  const agg = config.aggregation;
  const aggField =
    (agg.op === "sum" || agg.op === "avg") &&
    ds.fields.some((f) => f.key === agg.field && f.type === "money")
      ? agg.field
      : null;

  const drill: DrillRow[] = rows.map((row) => {
    const { label, sublabel } = ds.rowLabel(row);
    const dateVal = dateField ? row[dateField] : undefined;
    const out: DrillRow = { label };
    if (sublabel !== undefined) out.sublabel = sublabel;
    if (aggField != null) out.amount = Number(row[aggField] ?? 0);
    else if (ds.rowAmount) out.amount = ds.rowAmount(row);
    const iso = toIso(dateVal);
    if (iso) out.date = iso;
    const id = row.id;
    if (typeof id === "string" || typeof id === "number") out.id = String(id);
    return out;
  });

  // Newest first when we have a date to sort by; otherwise preserve load order.
  drill.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    return tb - ta;
  });

  return drill;
}

// ─── Window math ─────────────────────────────────────────────────────────────

/** The immediately-preceding window of equal length. */
function previousWindow(start: Date, end: Date): { prevStart: Date; prevEnd: Date } {
  const span = end.getTime() - start.getTime();
  return {
    prevStart: new Date(start.getTime() - span),
    prevEnd: new Date(start.getTime()),
  };
}

/** True when a row's date value falls in [start, end). */
function dateIn(value: unknown, start: Date, end: Date): boolean {
  const t = toTime(value);
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t < end.getTime();
}

// ─── Coercion helpers ────────────────────────────────────────────────────────

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toBoolean(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v !== 0;
  return false;
}

function toTime(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") return new Date(v).getTime();
  return NaN;
}

function toIso(v: unknown): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}
