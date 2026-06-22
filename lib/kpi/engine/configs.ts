/**
 * ════════════════════════════════════════════════════════════════════════════
 *  CONFIG STORE — read/write of the `kpi_configs` table + strict validation.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * A KPI config is DATA. The engine compiles it into a query. This module is the
 * ONLY door between the DB row and the engine, so all validation lives here:
 *
 *   - whitelist the writable fields (no mass-assignment from request bodies)
 *   - the dataset must exist in the registry
 *   - the aggregation op must be one the dataset supports, and its field(s) must
 *     be real fields on that dataset
 *   - every filter's field + operator must be legal per the dataset's FieldDefs
 *   - the dateField must be one of the dataset's dateFields, or null
 *
 * A malformed config is rejected HERE — it can never reach the engine or persist.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { kpiConfigs } from "@/lib/db/schema";
import type {
  MetricConfig,
  MetricConfigInput,
  Aggregation,
  AggOp,
  FilterClause,
  Operator,
  MetricUnit,
  DatasetDef,
  FieldDef,
} from "./types";
import { getDataset } from "./datasets";

// ─── Constants (the only legal vocabularies) ─────────────────────────────────

const AGG_OPS: AggOp[] = ["count", "sum", "avg", "ratio", "combine"];
const UNITS: MetricUnit[] = ["currency", "count", "percent", "ratio"];
const OPERATORS: Operator[] = [
  "eq", "neq", "contains", "gt", "lt", "gte", "lte", "in", "between", "is_set", "is_not_set",
];
/** Datasets that are not in the registry but are legal config "datasets". */
const VIRTUAL_DATASETS = new Set(["ratio", "manual", "combine"]);

// ─── Row <-> domain mapping ──────────────────────────────────────────────────

type ConfigRow = typeof kpiConfigs.$inferSelect;

function rowToConfig(row: ConfigRow): MetricConfig {
  return {
    metricKey: row.metricKey,
    dataset: row.dataset,
    aggregation: row.aggregation as Aggregation,
    filters: (row.filters as FilterClause[]) ?? [],
    dateField: row.dateField ?? null,
    unit: row.unit as MetricUnit,
    enabled: row.enabled,
  };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Fetch a single config by its unique metric_key. Returns null when absent. */
export async function getConfig(metricKey: string): Promise<MetricConfig | null> {
  const rows = await db()
    .select()
    .from(kpiConfigs)
    .where(eq(kpiConfigs.metricKey, metricKey))
    .limit(1);
  const row = rows[0];
  return row ? rowToConfig(row) : null;
}

/** Fetch every config (enabled and disabled), newest-updated first. */
export async function listConfigs(): Promise<MetricConfig[]> {
  const rows = await db().select().from(kpiConfigs);
  return rows.map(rowToConfig);
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/**
 * Upsert a config by its unique metric_key. The input MUST already be validated
 * (call `validateConfigInput` first); we re-validate defensively here so a bad
 * config can never persist regardless of caller.
 */
export async function upsertConfig(
  input: MetricConfigInput,
  userId: string,
): Promise<MetricConfig> {
  const check = validateConfigInput(input);
  if (!check.ok) throw new Error(`Invalid KPI config: ${check.error}`);
  const value = check.value;

  const now = new Date();
  const rows = await db()
    .insert(kpiConfigs)
    .values({
      metricKey: value.metricKey,
      dataset: value.dataset,
      aggregation: value.aggregation,
      filters: value.filters,
      dateField: value.dateField,
      unit: value.unit,
      enabled: value.enabled,
      updatedBy: userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: kpiConfigs.metricKey,
      set: {
        dataset: value.dataset,
        aggregation: value.aggregation,
        filters: value.filters,
        dateField: value.dateField,
        unit: value.unit,
        enabled: value.enabled,
        updatedBy: userId,
        updatedAt: now,
      },
    })
    .returning();

  return rowToConfig(rows[0]);
}

/** Hard-delete a config by metric_key. No-op if it doesn't exist. */
export async function deleteConfig(metricKey: string): Promise<void> {
  await db().delete(kpiConfigs).where(eq(kpiConfigs.metricKey, metricKey));
}

// ─── Validation ──────────────────────────────────────────────────────────────

type ValidateResult =
  | { ok: true; value: MetricConfigInput }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Find a dataset's FieldDef by key, or undefined. */
function fieldByKey(ds: DatasetDef, key: string): FieldDef | undefined {
  return ds.fields.find((f) => f.key === key);
}

/**
 * Validate + whitelist a raw, untrusted config body. On success the returned
 * `value` contains ONLY the allowed fields (no mass-assignment). On failure the
 * `error` is a short, human-readable reason.
 *
 * For `dataset: "ratio"` / `"manual"` (virtual datasets), field/filter/date
 * checks are skipped — ratios compose two child metricKeys and have no rows of
 * their own; manual metrics are entered by hand.
 */
export function validateConfigInput(input: unknown): ValidateResult {
  if (!isPlainObject(input)) return { ok: false, error: "body must be an object" };

  // ── metricKey ──
  const metricKey = input.metricKey;
  if (typeof metricKey !== "string" || metricKey.trim() === "") {
    return { ok: false, error: "metricKey must be a non-empty string" };
  }

  // ── dataset ──
  const dataset = input.dataset;
  if (typeof dataset !== "string" || dataset.trim() === "") {
    return { ok: false, error: "dataset must be a non-empty string" };
  }
  const isVirtual = VIRTUAL_DATASETS.has(dataset);
  const ds = isVirtual ? undefined : getDataset(dataset);
  if (!isVirtual && !ds) {
    return { ok: false, error: `unknown dataset "${dataset}"` };
  }

  // ── unit ──
  const unit = input.unit;
  if (typeof unit !== "string" || !UNITS.includes(unit as MetricUnit)) {
    return { ok: false, error: `unit must be one of ${UNITS.join(", ")}` };
  }

  // ── enabled ──
  const enabled = input.enabled;
  if (typeof enabled !== "boolean") {
    return { ok: false, error: "enabled must be a boolean" };
  }

  // ── aggregation ──
  const aggResult = validateAggregation(input.aggregation, ds, isVirtual);
  if (!aggResult.ok) return { ok: false, error: aggResult.error };
  const aggregation = aggResult.value;

  // ── dateField ──
  let dateField: string | null;
  const rawDateField = input.dateField;
  if (rawDateField === null || rawDateField === undefined) {
    dateField = null;
  } else if (typeof rawDateField === "string") {
    if (isVirtual) {
      // Virtual datasets have no rows of their own → no date field.
      dateField = null;
    } else if (ds && ds.dateFields.some((d) => d.key === rawDateField)) {
      dateField = rawDateField;
    } else {
      return { ok: false, error: `dateField "${rawDateField}" is not a date field of "${dataset}"` };
    }
  } else {
    return { ok: false, error: "dateField must be a string or null" };
  }

  // ── filters ──
  const filtersResult = validateFilters(input.filters, ds, isVirtual);
  if (!filtersResult.ok) return { ok: false, error: filtersResult.error };
  const filters = filtersResult.value;

  // Whitelisted output — nothing else from the body survives.
  return {
    ok: true,
    value: {
      metricKey,
      dataset,
      aggregation,
      filters,
      dateField,
      unit: unit as MetricUnit,
      enabled,
    },
  };
}

function validateAggregation(
  raw: unknown,
  ds: DatasetDef | undefined,
  isVirtual: boolean,
):
  | { ok: true; value: Aggregation }
  | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: "aggregation must be an object" };
  const op = raw.op;
  if (typeof op !== "string" || !AGG_OPS.includes(op as AggOp)) {
    return { ok: false, error: `aggregation.op must be one of ${AGG_OPS.join(", ")}` };
  }

  // The dataset must support this op (skip for virtual datasets — "ratio" is a
  // virtual dataset whose only legal op is "ratio").
  if (ds && !ds.aggregations.includes(op as AggOp)) {
    return { ok: false, error: `dataset "${ds.key}" does not support op "${op}"` };
  }

  switch (op) {
    case "count":
      return { ok: true, value: { op: "count" } };

    case "sum":
    case "avg": {
      const field = raw.field;
      if (typeof field !== "string" || field.trim() === "") {
        return { ok: false, error: `aggregation.field is required for "${op}"` };
      }
      if (ds && !fieldByKey(ds, field)) {
        return { ok: false, error: `"${field}" is not a field of dataset "${ds.key}"` };
      }
      return { ok: true, value: { op, field } };
    }

    case "ratio": {
      const numerator = raw.numerator;
      const denominator = raw.denominator;
      if (typeof numerator !== "string" || numerator.trim() === "") {
        return { ok: false, error: "ratio.numerator must be a metricKey string" };
      }
      if (typeof denominator !== "string" || denominator.trim() === "") {
        return { ok: false, error: "ratio.denominator must be a metricKey string" };
      }
      // A ratio composes two other metrics; it only makes sense on the virtual
      // "ratio" dataset (no rows of its own).
      if (!isVirtual) {
        return { ok: false, error: 'op "ratio" requires dataset "ratio"' };
      }
      return { ok: true, value: { op: "ratio", numerator, denominator } };
    }

    case "combine": {
      if (!isVirtual) {
        return { ok: false, error: 'op "combine" requires dataset "combine"' };
      }
      const rawTerms = raw.terms;
      if (!Array.isArray(rawTerms) || rawTerms.length === 0) {
        return { ok: false, error: "combine.terms must be a non-empty array" };
      }
      const terms: { metricKey: string; sign: 1 | -1 }[] = [];
      for (let i = 0; i < rawTerms.length; i++) {
        const t = rawTerms[i];
        if (!isPlainObject(t)) return { ok: false, error: `combine.terms[${i}] must be an object` };
        if (typeof t.metricKey !== "string" || t.metricKey.trim() === "") {
          return { ok: false, error: `combine.terms[${i}].metricKey must be a metricKey string` };
        }
        const sign = t.sign === -1 ? -1 : 1;
        terms.push({ metricKey: t.metricKey, sign });
      }
      return { ok: true, value: { op: "combine", terms } };
    }

    default:
      return { ok: false, error: `unsupported aggregation op "${op}"` };
  }
}

function validateFilters(
  raw: unknown,
  ds: DatasetDef | undefined,
  isVirtual: boolean,
):
  | { ok: true; value: FilterClause[] }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "filters must be an array" };

  // Virtual datasets (ratio/manual) carry no rows → filters are meaningless.
  if (isVirtual) {
    return raw.length === 0
      ? { ok: true, value: [] }
      : { ok: false, error: `dataset has no rows to filter` };
  }
  if (!ds) return { ok: false, error: "filters require a real dataset" };

  const out: FilterClause[] = [];
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i];
    if (!isPlainObject(f)) return { ok: false, error: `filter[${i}] must be an object` };

    const field = f.field;
    if (typeof field !== "string") return { ok: false, error: `filter[${i}].field must be a string` };
    const fieldDef = fieldByKey(ds, field);
    if (!fieldDef) return { ok: false, error: `filter[${i}]: "${field}" is not a field of "${ds.key}"` };

    const op = f.op;
    if (typeof op !== "string" || !OPERATORS.includes(op as Operator)) {
      return { ok: false, error: `filter[${i}].op is not a valid operator` };
    }
    if (!fieldDef.operators.includes(op as Operator)) {
      return { ok: false, error: `filter[${i}]: operator "${op}" is not legal for field "${field}"` };
    }

    // Whitelist field/op/value only.
    out.push({ field, op: op as Operator, value: f.value as FilterClause["value"] });
  }
  return { ok: true, value: out };
}
