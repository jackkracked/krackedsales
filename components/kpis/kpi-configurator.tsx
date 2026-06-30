"use client";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  KPI CONFIGURATOR — the right-side drawer that wires one metric.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Flow (one scroll, progressive reveal — plan §E.2):
 *   ① INTEGRATION  → chips, selected = navy fill
 *   ② SCOPE        → dataset radio cards (revealed once an integration is picked)
 *   ③ MEASURE      → aggregation + field + date-field dropdowns (from the descriptor)
 *   ④ FILTERS      → each row: field → operator → value, ALL driven by the registry.
 *                    You literally cannot type a property name — that's the
 *                    confidence guarantee, made visual.
 *   LIVE PREVIEW   → pinned at the bottom, debounced ~400ms, shimmer while loading,
 *                    a calm inline error on failure (never a silent 0).
 *
 * Chrome matches KpiDetailSheet / SettingsPanel exactly (slide-in-from-right,
 * rounded-[7px], bg-primary/5 highlights) so it feels native instantly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { X, Plus, Loader2, ChevronDown, ListTree, AlertTriangle, Check, Sigma, Divide, RotateCcw, TrendingUp, TrendingDown, Target as TargetIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  paceForWindow,
  deriveCadenceTargets,
  type Cadence,
  type CadenceTargets,
  type PaceResult,
} from "@/lib/kpi/pacing";
import { fmtValue } from "./metric-cell";
import type {
  DatasetDescriptor,
  FieldDef,
  Operator,
  AggOp,
  Aggregation,
  FilterClause,
  MetricUnit,
  MetricConfigInput,
  DrillRow,
} from "@/lib/kpi/engine/types";

// ─── Easing / motion ───────────────────────────────────────────────────────────

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// ─── Combine mode ───────────────────────────────────────────────────────────────
// A sentinel "integration" + "dataset" that puts the drawer into COMBINE mode:
// instead of a dataset/measure/filters flow, you stack other configured KPIs and
// add or subtract them (Total Expenses = Software + Ads + Other; Net P&L = Money
// in − Total Expenses). The engine recurses into the child configs.
const COMBINE = "combine" as const;

// ─── Ratio mode ─────────────────────────────────────────────────────────────────
// A sentinel "integration" + "dataset" that puts the drawer into RATIO mode:
// instead of a dataset/measure/filters flow, you pick two other KPIs and divide one
// by the other (ROAS = Cash Collected ÷ Ad Spend; CPL = Ad Spend ÷ Leads; Booking
// Rate = Booked Calls ÷ Leads). The engine recurses into the two child configs.
const RATIO = "ratio" as const;

interface CombineTerm {
  metricKey: string;
  sign: 1 | -1;
}

// ─── KPI target ─────────────────────────────────────────────────────────────────
// A target is independent of the engine wiring — it applies to ANY KPI (configured,
// combined, ratio, or not yet wired). "higher" = above target is good (revenue);
// "lower" = below target is good (costs/churn/CPL/ad spend).

type TargetDirection = "higher" | "lower";

/** Smart default direction from the metricKey: cost-like metrics are "lower is better". */
function defaultDirectionFor(metricKey: string): TargetDirection {
  const k = metricKey.toLowerCase();
  const lowerSignals = ["cost", "expense", "spend", "churn", "lost", "cpl", "costper"];
  return lowerSignals.some((s) => k.includes(s)) ? "lower" : "higher";
}

/** One saved target as the API now returns it (cadence-aware). */
interface SavedTarget {
  target: number; // legacy single value = monthly
  direction: TargetDirection;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  anchor: Cadence;
}

interface TargetResponse {
  targets: Record<string, SavedTarget>;
}

/** Cadence rows render in descending magnitude. */
const CADENCE_ORDER: Cadence[] = ["monthly", "weekly", "daily"];
const CADENCE_LABEL: Record<Cadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** The cadence-target save payload (what POST /api/kpis/targets expects). */
interface TargetSavePayload {
  metricKey: string;
  direction: TargetDirection;
  anchor: Cadence;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
}

/** Round a derived/stored value for display in an input (no thousands separators). */
function formatTargetInput(value: number, unit: MetricUnit): string {
  if (unit === "percent" || unit === "ratio") {
    return String(Math.round(value * 100) / 100);
  }
  return String(Math.round(value));
}

/** A stored cadence ≈ its derived value (within rounding) → it's still "auto". */
function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.abs(b) * 0.015 + 0.5;
}

function parseTargetInput(raw: string): number | null {
  const n = parseFloat(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
}

// ─── Operator labels (human wording for the operator dropdown) ──────────────────

const OPERATOR_LABELS: Record<Operator, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  gt: "greater than",
  lt: "less than",
  gte: "at least",
  lte: "at most",
  in: "is any of",
  between: "between",
  is_set: "is set",
  is_not_set: "is not set",
};

const AGG_LABELS: Record<AggOp, string> = {
  count: "Count how many",
  sum: "Add up the total",
  avg: "Average",
  ratio: "Ratio",
  combine: "Combine other KPIs",
};

const INTEGRATION_LABELS: Record<string, string> = {
  stripe: "Stripe",
  ghl: "GHL",
  meta: "Meta",
  clickup: "ClickUp",
  proposals: "Proposals",
  calls: "Calls",
  internal: "Internal",
  manual: "Manual",
};

// ─── Formatting ─────────────────────────────────────────────────────────────────

function fmtPreviewValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return `${value.toFixed(1)}%`;
    case "ratio":
      return `${value.toFixed(2)}x`;
    default:
      return value.toLocaleString("en-US");
  }
}

function fmtRowAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtRowDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// ─── Draft state ────────────────────────────────────────────────────────────────

interface DraftState {
  integration: string | null;
  dataset: string | null;
  aggOp: AggOp;
  aggField: string | null; // for sum / avg
  dateField: string | null; // null => snapshot (level)
  filters: FilterClause[];
  unit: MetricUnit;
  /** Combine mode only: the KPIs being added/subtracted. */
  terms: CombineTerm[];
  /** Ratio mode only: the two KPIs to divide (numerator ÷ denominator). */
  numerator: string;
  denominator: string;
}

function emptyDraft(): DraftState {
  return {
    integration: null,
    dataset: null,
    aggOp: "count",
    aggField: null,
    dateField: null,
    filters: [],
    unit: "count",
    terms: [],
    numerator: "",
    denominator: "",
  };
}

/** Seed the draft from a previously-saved config (Edit flow). */
function draftFromConfig(cfg: MetricConfigInput, datasets: DatasetDescriptor[]): DraftState {
  const agg = cfg.aggregation;
  // Combine configs have no real dataset — seed the term builder instead.
  if (agg.op === "combine") {
    return {
      ...emptyDraft(),
      integration: COMBINE,
      dataset: COMBINE,
      aggOp: "combine",
      filters: [],
      unit: cfg.unit,
      terms: agg.terms.map((t) => ({ metricKey: t.metricKey, sign: t.sign })),
    };
  }
  // Ratio configs have no real dataset — seed the two-field picker instead.
  if (agg.op === "ratio") {
    return {
      ...emptyDraft(),
      integration: RATIO,
      dataset: RATIO,
      aggOp: "ratio",
      filters: [],
      unit: cfg.unit,
      numerator: agg.numerator,
      denominator: agg.denominator,
    };
  }
  const ds = datasets.find((d) => d.key === cfg.dataset);
  return {
    ...emptyDraft(),
    integration: ds?.integration ?? null,
    dataset: cfg.dataset,
    aggOp: agg.op,
    aggField: agg.op === "sum" || agg.op === "avg" ? agg.field : null,
    dateField: cfg.dateField,
    filters: cfg.filters ?? [],
    unit: cfg.unit,
    terms: [],
  };
}

/** Default unit inferred from aggregation + field type. */
function inferUnit(draft: DraftState, ds: DatasetDescriptor | undefined): MetricUnit {
  if (draft.aggOp === "ratio") return "ratio";
  if (draft.aggOp === "count") return "count";
  const field = ds?.fields.find((f) => f.key === draft.aggField);
  if (field?.type === "money") return "currency";
  return "count";
}

// ─── Build the MetricConfigInput from the draft (the save/preview payload) ───────

function buildAggregation(draft: DraftState): Aggregation | null {
  if (draft.aggOp === "count") return { op: "count" };
  if (draft.aggOp === "sum") return draft.aggField ? { op: "sum", field: draft.aggField } : null;
  if (draft.aggOp === "avg") return draft.aggField ? { op: "avg", field: draft.aggField } : null;
  // ratio is not buildable from this UI (needs two child metricKeys) — guarded out below.
  return null;
}

function buildConfigInput(metricKey: string, draft: DraftState): MetricConfigInput | null {
  // ── Combine mode ── compose other KPIs; no dataset rows, fields, or filters.
  if (draft.dataset === COMBINE) {
    const terms = draft.terms.filter((t) => t.metricKey);
    if (terms.length === 0) return null;
    return {
      metricKey,
      dataset: COMBINE,
      aggregation: { op: "combine", terms: terms.map((t) => ({ metricKey: t.metricKey, sign: t.sign })) },
      filters: [],
      dateField: null,
      unit: draft.unit,
      enabled: true,
    };
  }

  // ── Ratio mode ── one KPI ÷ another; no dataset rows, fields, or filters.
  if (draft.dataset === RATIO) {
    if (!draft.numerator || !draft.denominator) return null;
    return {
      metricKey,
      dataset: RATIO,
      aggregation: { op: "ratio", numerator: draft.numerator, denominator: draft.denominator },
      filters: [],
      dateField: null,
      unit: draft.unit,
      enabled: true,
    };
  }

  if (!draft.dataset) return null;
  const aggregation = buildAggregation(draft);
  if (!aggregation) return null;
  return {
    metricKey,
    dataset: draft.dataset,
    aggregation,
    filters: draft.filters,
    dateField: draft.dateField,
    unit: draft.unit,
    enabled: true,
  };
}

/** A draft is valid (Save enabled) once it has a dataset, a complete aggregation,
 *  and every filter row is fully specified. */
function validateDraft(draft: DraftState, ds: DatasetDescriptor | undefined): boolean {
  // Combine mode: valid once there is at least one term with a chosen KPI.
  if (draft.dataset === COMBINE) {
    return draft.terms.some((t) => !!t.metricKey);
  }
  // Ratio mode: valid once both numerator + denominator are chosen.
  if (draft.dataset === RATIO) {
    return !!draft.numerator && !!draft.denominator;
  }
  if (!draft.dataset || !ds) return false;
  if ((draft.aggOp === "sum" || draft.aggOp === "avg") && !draft.aggField) return false;
  if (draft.aggOp === "ratio") return false; // not configurable here
  // Every filter must have a field + operator + (a value unless the operator is value-less).
  for (const f of draft.filters) {
    if (!f.field || !f.op) return false;
    if (f.op === "is_set" || f.op === "is_not_set") continue;
    if (f.value === undefined || f.value === null || f.value === "") return false;
    if (Array.isArray(f.value) && f.value.length === 0) return false;
  }
  return true;
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface KpiConfiguratorProps {
  metricKey: string;
  metricLabel: string;
  existingConfig?: MetricConfigInput | null;
  /** The reporting window the /kpis page is currently showing, so the preview
   *  reads exactly what the card will read (YYYY-MM-DD; end exclusive). */
  range?: { start: string; end: string };
  /** Friendly labels for every metric in the dashboard — powers the Combine
   *  term-builder dropdown + breakdown labels (label shown, metricKey stored). */
  availableMetrics?: { metricKey: string; label: string }[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// ─── Registry response ──────────────────────────────────────────────────────────

interface RegistryResponse {
  datasets: DatasetDescriptor[];
}

interface PreviewResponse {
  value: number;
  count: number;
  unit: MetricUnit;
  sampleRows: DrillRow[];
}

// ─── Component ────────────────────────────────────────────────────────────────────

export function KpiConfigurator({
  metricKey,
  metricLabel,
  existingConfig,
  range,
  availableMetrics = [],
  open,
  onClose,
  onSaved,
}: KpiConfiguratorProps) {
  const reduce = useReducedMotion();
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [unitTouched, setUnitTouched] = useState(false);
  const [showRows, setShowRows] = useState(false);

  // Target editing (cadence values, anchor, direction) is self-contained in
  // <TargetSection/> below — it only needs the saved record + the page window.

  // ── Registry (datasets + fields + operators + enums) ──────────────────────────
  const registryQuery = useQuery<RegistryResponse>({
    queryKey: ["kpi-registry"],
    queryFn: async () => {
      const res = await fetch("/api/kpis/registry");
      if (!res.ok) throw new Error("Failed to load registry");
      return res.json();
    },
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  const datasets = useMemo(() => registryQuery.data?.datasets ?? [], [registryQuery.data]);

  // ── Already-configured KPIs (the pool you can combine / divide) ───────────────
  const isCombineMode = draft.dataset === COMBINE;
  const isRatioMode = draft.dataset === RATIO;
  const configsQuery = useQuery<{ configs: MetricConfigInput[] }>({
    queryKey: ["kpi-configs"],
    queryFn: async () => {
      const res = await fetch("/api/kpis/configs");
      if (!res.ok) throw new Error("Failed to load configs");
      return res.json();
    },
    enabled: open && (isCombineMode || isRatioMode),
    staleTime: 60 * 1000,
  });

  // Friendly label for any metricKey (dashboard defs first, then a humanized key).
  const metricLabelFor = useCallback(
    (key: string) => availableMetrics.find((m) => m.metricKey === key)?.label ?? key,
    [availableMetrics],
  );

  // The KPIs eligible to combine: every configured + enabled metric, EXCEPT the one
  // being edited (no self-reference), labelled via the dashboard metric list.
  const combinableMetrics = useMemo(() => {
    const configs = configsQuery.data?.configs ?? [];
    const configured = new Set(configs.filter((c) => c.enabled).map((c) => c.metricKey));
    return availableMetrics
      .filter((m) => m.metricKey !== metricKey && configured.has(m.metricKey))
      .map((m) => ({ value: m.metricKey, label: m.label }));
  }, [configsQuery.data, availableMetrics, metricKey]);

  // ── Seed the draft when the drawer opens ──────────────────────────────────────
  // Wait for the registry so we can resolve a saved config's integration from its dataset.
  useEffect(() => {
    if (!open) return;
    setShowRows(false);
    if (existingConfig && datasets.length > 0) {
      setDraft(draftFromConfig(existingConfig, datasets));
      setUnitTouched(true); // honor the saved unit; don't auto-overwrite it
    } else if (!existingConfig) {
      setDraft(emptyDraft());
      setUnitTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existingConfig, datasets.length]);

  // ── Derived: the integrations present in the registry, in a stable order ──────
  const integrations = useMemo(() => {
    const order = ["stripe", "ghl", "proposals", "meta", "calls", "clickup", "internal", "manual"];
    const present = Array.from(new Set(datasets.map((d) => d.integration)));
    return present.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [datasets]);

  const scopedDatasets = useMemo(
    () => datasets.filter((d) => d.integration === draft.integration),
    [datasets, draft.integration],
  );

  const activeDataset = useMemo(
    () => datasets.find((d) => d.key === draft.dataset),
    [datasets, draft.dataset],
  );

  // ── Keep unit auto-inferred until the dataset/aggregation changes (unless edited) ─
  useEffect(() => {
    if (unitTouched) return;
    if (draft.dataset === COMBINE) return; // combine defaults to currency (set on entry)
    if (draft.dataset === RATIO) return; // ratio's unit is user-chosen (ratio/percent)
    setDraft((prev) => {
      const ds = datasets.find((d) => d.key === prev.dataset);
      const next = inferUnit(prev, ds);
      return next === prev.unit ? prev : { ...prev, unit: next };
    });
  }, [draft.dataset, draft.aggOp, draft.aggField, datasets, unitTouched]);

  // ── Validity + payload ────────────────────────────────────────────────────────
  const isValid = validateDraft(draft, activeDataset);
  const configInput = useMemo(
    () => buildConfigInput(metricKey, draft),
    [metricKey, draft],
  );

  // ── Live preview — debounced ~400ms ───────────────────────────────────────────
  const [debouncedInput, setDebouncedInput] = useState<MetricConfigInput | null>(null);
  useEffect(() => {
    if (!isValid || !configInput) {
      setDebouncedInput(null);
      return;
    }
    const handle = setTimeout(() => setDebouncedInput(configInput), 400);
    return () => clearTimeout(handle);
  }, [isValid, configInput]);

  const previewKey = useMemo(
    () => (debouncedInput ? `${JSON.stringify(debouncedInput)}|${range?.start}|${range?.end}` : "none"),
    [debouncedInput, range],
  );

  const previewQuery = useQuery<PreviewResponse>({
    queryKey: ["kpi-preview", previewKey],
    queryFn: async () => {
      const res = await fetch("/api/kpis/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Preview against the SAME window the /kpis page is showing, so the number
        // matches exactly what the card will read once saved.
        body: JSON.stringify({ config: debouncedInput, start: range?.start, end: range?.end }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.error ?? "Couldn't run preview");
      }
      return res.json();
    },
    enabled: open && !!debouncedInput,
    staleTime: 30 * 1000,
    retry: false,
  });

  // ── Save ──────────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (payload: MetricConfigInput) => {
      const res = await fetch("/api/kpis/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.error ?? "Failed to save config");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi-configs"] });
      queryClient.invalidateQueries({ queryKey: ["kpi-metrics"] });
      onSaved();
      onClose();
    },
  });

  // ── Target: load the saved record; the cadence editor + save live in TargetSection ─
  const targetsQuery = useQuery<TargetResponse>({
    queryKey: ["kpi-targets"],
    queryFn: async () => {
      const res = await fetch("/api/kpis/targets");
      if (!res.ok) throw new Error("Failed to load targets");
      return res.json();
    },
    enabled: open,
    staleTime: 60 * 1000,
  });

  const saveTargetMutation = useMutation({
    mutationFn: async (payload: TargetSavePayload) => {
      const res = await fetch("/api/kpis/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.error ?? "Failed to save target");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi-targets"] });
    },
  });

  // ── Escape to close + focus management ────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // ── Draft mutators ────────────────────────────────────────────────────────────
  const pickIntegration = useCallback((integration: string) => {
    setDraft((prev) => {
      if (prev.integration === integration) return prev;
      // Combine is a distinct mode: seed the term builder, default to currency,
      // and clear any dataset/measure/filter state from a previous selection.
      if (integration === COMBINE) {
        return {
          ...emptyDraft(),
          integration: COMBINE,
          dataset: COMBINE,
          aggOp: "combine",
          unit: "currency",
          terms: [{ metricKey: "", sign: 1 }],
        };
      }
      // Ratio is a distinct mode: seed the two-field picker, default to a ratio (×)
      // unit, and clear any dataset/measure/filter state from a previous selection.
      if (integration === RATIO) {
        return {
          ...emptyDraft(),
          integration: RATIO,
          dataset: RATIO,
          aggOp: "ratio",
          unit: "ratio",
          numerator: "",
          denominator: "",
        };
      }
      return { ...emptyDraft(), integration };
    });
    setShowRows(false);
  }, []);

  // ── Combine term mutators ─────────────────────────────────────────────────────
  const addTerm = useCallback(() => {
    setDraft((prev) => ({ ...prev, terms: [...prev.terms, { metricKey: "", sign: 1 }] }));
  }, []);

  const removeTerm = useCallback((index: number) => {
    setDraft((prev) => ({ ...prev, terms: prev.terms.filter((_, i) => i !== index) }));
  }, []);

  const updateTerm = useCallback((index: number, patch: Partial<CombineTerm>) => {
    setDraft((prev) => {
      const next = [...prev.terms];
      next[index] = { ...next[index], ...patch };
      return { ...prev, terms: next };
    });
  }, []);

  const pickDataset = useCallback(
    (datasetKey: string) => {
      setDraft((prev) => {
        if (prev.dataset === datasetKey) return prev;
        const ds = datasets.find((d) => d.key === datasetKey);
        // Default the aggregation to the dataset's first supported op, and the
        // date field to the dataset's first date field (or null if it's a snapshot ds).
        const firstAgg = (ds?.aggregations[0] ?? "count") as AggOp;
        const firstDateField = ds?.dateFields[0]?.key ?? null;
        return {
          ...prev,
          dataset: datasetKey,
          aggOp: firstAgg,
          aggField: null,
          dateField: firstDateField,
          filters: [],
        };
      });
      setShowRows(false);
    },
    [datasets],
  );

  const setAggOp = useCallback((op: AggOp) => {
    setDraft((prev) => ({ ...prev, aggOp: op, aggField: op === "count" ? null : prev.aggField }));
  }, []);

  const addFilter = useCallback(() => {
    setDraft((prev) => {
      const ds = datasets.find((d) => d.key === prev.dataset);
      const firstField = ds?.fields[0];
      if (!firstField) return prev;
      const firstOp = firstField.operators[0];
      return {
        ...prev,
        filters: [
          ...prev.filters,
          { field: firstField.key, op: firstOp, value: defaultFilterValue(firstField, firstOp) },
        ],
      };
    });
  }, [datasets]);

  const removeFilter = useCallback((index: number) => {
    setDraft((prev) => ({ ...prev, filters: prev.filters.filter((_, i) => i !== index) }));
  }, []);

  const updateFilter = useCallback(
    (index: number, patch: Partial<FilterClause>) => {
      setDraft((prev) => {
        const next = [...prev.filters];
        next[index] = { ...next[index], ...patch };
        return { ...prev, filters: next };
      });
    },
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return null;

  // Step-reveal flags — the normal dataset flow is hidden entirely in combine/ratio mode.
  const showScope = !!draft.integration && !isCombineMode && !isRatioMode;
  const showMeasure = !!draft.dataset && !isCombineMode && !isRatioMode;
  const showFilters = !!draft.dataset && !isCombineMode && !isRatioMode;

  const numberFields = activeDataset?.fields.filter(
    (f) => f.type === "money" || f.type === "count",
  );

  const content = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Scrim */}
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={`Configure ${metricLabel}`}
            data-r10n-kpi-drawer
            className="relative w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col h-full outline-none"
            initial={reduce ? { opacity: 0 } : { x: "100%" }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: "100%" }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="min-w-0">
                <p data-r10n-kpi-eyebrow className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/60">
                  Detail View · KPI Wiring
                </p>
                <h2 data-r10n-kpi-drawer-title className="text-base font-bold text-foreground mt-0.5 truncate">{metricLabel}</h2>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-border/50 transition-colors active:scale-95 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body — the 4-step form */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              {registryQuery.isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : registryQuery.isError ? (
                <div className="flex items-start gap-2 rounded-[7px] bg-destructive/8 border border-destructive/20 px-3 py-2.5 text-xs text-destructive">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Couldn&apos;t load the data registry. Check your connection and try again.</span>
                </div>
              ) : (
                <>
                  {/* TARGET — always visible; independent of the wiring below */}
                  <TargetSection
                    metricKey={metricKey}
                    unit={draft.unit}
                    range={range}
                    previewValue={previewQuery.data?.value ?? null}
                    savedTarget={targetsQuery.data?.targets[metricKey]}
                    loading={targetsQuery.isLoading}
                    saving={saveTargetMutation.isPending}
                    saved={saveTargetMutation.isSuccess && !saveTargetMutation.isPending}
                    error={(saveTargetMutation.error as Error)?.message ?? null}
                    reduce={reduce}
                    onEdited={() => saveTargetMutation.reset()}
                    onSave={(payload) => saveTargetMutation.mutate(payload)}
                  />

                  {/* ① INTEGRATION */}
                  <Step n="1" label="Integration">
                    <div className="flex flex-wrap gap-1.5">
                      {integrations.map((integ) => {
                        const selected = draft.integration === integ;
                        return (
                          <button
                            key={integ}
                            type="button"
                            data-r10n-kpi-chip
                            data-selected={selected}
                            onClick={() => pickIntegration(integ)}
                            className={cn(
                              "px-3 py-1.5 rounded-[7px] text-xs font-semibold transition-colors active:scale-95",
                              selected
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted/40 text-foreground/70 hover:bg-muted hover:text-foreground border border-border",
                            )}
                          >
                            {INTEGRATION_LABELS[integ] ?? integ}
                          </button>
                        );
                      })}

                      {/* Combine — a visually distinct mode, not a real integration. */}
                      <button
                        type="button"
                        data-r10n-kpi-chip
                        data-mode="true"
                        data-selected={isCombineMode}
                        onClick={() => pickIntegration(COMBINE)}
                        className={cn(
                          "flex items-center gap-1 px-3 py-1.5 rounded-[7px] text-xs font-semibold transition-colors active:scale-95",
                          isCombineMode
                            ? "bg-primary text-primary-foreground"
                            : "bg-primary/5 text-primary border border-dashed border-primary/40 hover:bg-primary/10",
                        )}
                      >
                        <Sigma className="w-3 h-3" />
                        Combine KPIs
                      </button>

                      {/* Ratio — a visually distinct mode, not a real integration. */}
                      <button
                        type="button"
                        data-r10n-kpi-chip
                        data-mode="true"
                        data-selected={isRatioMode}
                        onClick={() => pickIntegration(RATIO)}
                        className={cn(
                          "flex items-center gap-1 px-3 py-1.5 rounded-[7px] text-xs font-semibold transition-colors active:scale-95",
                          isRatioMode
                            ? "bg-primary text-primary-foreground"
                            : "bg-primary/5 text-primary border border-dashed border-primary/40 hover:bg-primary/10",
                        )}
                      >
                        <Divide className="w-3 h-3" />
                        Ratio
                      </button>
                    </div>
                  </Step>

                  {/* ② TERMS (combine mode) — stack other KPIs to add/subtract */}
                  <AnimatePresence initial={false}>
                    {isCombineMode && (
                      <Reveal reduce={reduce}>
                        <Step
                          n="2"
                          label="Combine"
                          action={
                            <button
                              type="button"
                              data-r10n-kpi-link
                              onClick={addTerm}
                              className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors active:scale-95"
                            >
                              <Plus className="w-3 h-3" /> Add KPI
                            </button>
                          }
                        >
                          {configsQuery.isLoading ? (
                            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your KPIs…
                            </div>
                          ) : combinableMetrics.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No other configured KPIs to combine yet. Wire up a couple of KPIs first,
                              then come back to total them here.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {draft.terms.map((term, i) => (
                                <TermRow
                                  key={i}
                                  term={term}
                                  options={combinableMetrics}
                                  isFirst={i === 0}
                                  onChange={(patch) => updateTerm(i, patch)}
                                  onRemove={() => removeTerm(i)}
                                />
                              ))}
                              <p className="text-[11px] leading-relaxed text-muted-foreground">
                                Pick the KPIs to total. Use <span className="font-semibold">+</span> to add a
                                KPI to the result and <span className="font-semibold">−</span> to subtract it —
                                e.g. Net P&amp;L = Money in − Total Expenses.
                              </p>
                            </div>
                          )}
                        </Step>
                      </Reveal>
                    )}
                  </AnimatePresence>

                  {/* ② RATIO (ratio mode) — divide one KPI by another */}
                  <AnimatePresence initial={false}>
                    {isRatioMode && (
                      <Reveal reduce={reduce}>
                        <Step n="2" label="Ratio">
                          {configsQuery.isLoading ? (
                            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your KPIs…
                            </div>
                          ) : combinableMetrics.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No other configured KPIs to divide yet. Wire up a couple of KPIs first,
                              then come back to build a ratio here.
                            </p>
                          ) : (
                            <div className="space-y-3">
                              {/* Numerator ÷ Denominator */}
                              <div className="rounded-[7px] border border-border bg-muted/20 px-2.5 py-2.5 space-y-2">
                                <Field label="Numerator (top)">
                                  <Select
                                    value={draft.numerator}
                                    placeholder="Pick a KPI…"
                                    onChange={(v) => setDraft((p) => ({ ...p, numerator: v }))}
                                    options={combinableMetrics}
                                  />
                                </Field>
                                <div className="flex items-center gap-2 px-0.5" aria-hidden>
                                  <span className="h-px flex-1 bg-border" />
                                  <Divide className="w-3.5 h-3.5 text-muted-foreground" />
                                  <span className="h-px flex-1 bg-border" />
                                </div>
                                <Field label="Denominator (bottom)">
                                  <Select
                                    value={draft.denominator}
                                    placeholder="Pick a KPI…"
                                    onChange={(v) => setDraft((p) => ({ ...p, denominator: v }))}
                                    options={combinableMetrics}
                                  />
                                </Field>
                              </div>

                              {/* Readable summary */}
                              {draft.numerator && draft.denominator && (
                                <p className="text-[11px] leading-relaxed text-muted-foreground">
                                  Reads as{" "}
                                  <span className="font-semibold text-foreground">
                                    {metricLabelFor(draft.numerator)}
                                  </span>{" "}
                                  ÷{" "}
                                  <span className="font-semibold text-foreground">
                                    {metricLabelFor(draft.denominator)}
                                  </span>
                                  {draft.numerator === draft.denominator && (
                                    <span data-r10n-kpi-warn> : that always equals 1; pick two different KPIs.</span>
                                  )}
                                </p>
                              )}

                              {/* Unit toggle — Ratio (×) vs Percent (%) */}
                              <Field label="Show the result as">
                                <div className="flex gap-1">
                                  {[
                                    { v: "ratio" as const, label: "Ratio (×)" },
                                    { v: "percent" as const, label: "Percent (%)" },
                                  ].map((opt) => {
                                    const on = draft.unit === opt.v;
                                    return (
                                      <button
                                        key={opt.v}
                                        type="button"
                                        data-r10n-kpi-seg
                                        data-selected={on}
                                        onClick={() => {
                                          setUnitTouched(true);
                                          setDraft((p) => ({ ...p, unit: opt.v }));
                                        }}
                                        className={cn(
                                          "flex-1 px-2 py-1.5 rounded-[6px] text-[11px] font-semibold transition-colors active:scale-95",
                                          on
                                            ? "bg-primary/10 text-primary border border-primary/30"
                                            : "bg-background text-foreground/70 border border-border hover:border-foreground/25",
                                        )}
                                      >
                                        {opt.label}
                                      </button>
                                    );
                                  })}
                                </div>
                                <p className="text-[11px] leading-relaxed text-muted-foreground mt-1.5">
                                  Use <span className="font-semibold">Ratio</span> for things like ROAS (4.2×) and{" "}
                                  <span className="font-semibold">Percent</span> for rates like booking rate (38%).
                                </p>
                              </Field>
                            </div>
                          )}
                        </Step>
                      </Reveal>
                    )}
                  </AnimatePresence>

                  {/* ② SCOPE */}
                  <AnimatePresence initial={false}>
                    {showScope && (
                      <Reveal reduce={reduce}>
                        <Step n="2" label="Scope">
                          <div className="space-y-2">
                            {scopedDatasets.map((ds) => {
                              const selected = draft.dataset === ds.key;
                              return (
                                <button
                                  key={ds.key}
                                  type="button"
                                  data-r10n-kpi-radio
                                  data-selected={selected}
                                  onClick={() => pickDataset(ds.key)}
                                  className={cn(
                                    "w-full text-left rounded-[7px] border px-3.5 py-2.5 transition-colors active:scale-[0.99]",
                                    selected
                                      ? "border-primary/40 bg-primary/5"
                                      : "border-border hover:border-foreground/25 hover:bg-muted/30",
                                  )}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <span
                                      data-r10n-kpi-radio-ring
                                      data-selected={selected}
                                      className={cn(
                                        "w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors",
                                        selected ? "border-primary" : "border-border",
                                      )}
                                    >
                                      {selected && <span data-r10n-kpi-radio-dot className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                    </span>
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-foreground truncate">{ds.label}</p>
                                      {ds.description && (
                                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                          {ds.description}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                            {scopedDatasets.length === 0 && (
                              <p className="text-xs text-muted-foreground">No datasets for this integration.</p>
                            )}
                          </div>
                        </Step>
                      </Reveal>
                    )}
                  </AnimatePresence>

                  {/* ③ MEASURE */}
                  <AnimatePresence initial={false}>
                    {showMeasure && activeDataset && (
                      <Reveal reduce={reduce}>
                        <Step n="3" label="Measure">
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2.5">
                              <Field label="What to do with them">
                                <Select
                                  value={draft.aggOp}
                                  onChange={(v) => setAggOp(v as AggOp)}
                                  options={activeDataset.aggregations
                                    .filter((op) => op !== "ratio")
                                    .map((op) => ({ value: op, label: AGG_LABELS[op] }))}
                                />
                              </Field>
                              {(draft.aggOp === "sum" || draft.aggOp === "avg") && (
                                <Field label="Of this amount">
                                  <Select
                                    value={draft.aggField ?? ""}
                                    placeholder="Select"
                                    onChange={(v) => setDraft((p) => ({ ...p, aggField: v }))}
                                    options={(numberFields ?? []).map((f) => ({
                                      value: f.key,
                                      label: f.label,
                                    }))}
                                  />
                                </Field>
                              )}
                            </div>

                            <Field label="Count it by which date?">
                              <Select
                                value={draft.dateField ?? "__none__"}
                                onChange={(v) =>
                                  setDraft((p) => ({ ...p, dateField: v === "__none__" ? null : v }))
                                }
                                options={[
                                  ...activeDataset.dateFields.map((df) => ({
                                    value: df.key,
                                    label: df.label,
                                  })),
                                  { value: "__none__", label: "A running total as of now (ignore the date range)" },
                                ]}
                              />
                              <p className="text-[11px] leading-relaxed text-muted-foreground mt-1.5">
                                {draft.dateField
                                  ? "When you choose a time period (like “this month”), we only count a record if this date falls inside it — e.g. count a payment in the month it was paid. Change it and the number changes."
                                  : "Shows the live total right now, no matter the time period — best for things like “how much is still owed to us”."}
                              </p>
                            </Field>
                          </div>
                        </Step>
                      </Reveal>
                    )}
                  </AnimatePresence>

                  {/* ④ FILTERS */}
                  <AnimatePresence initial={false}>
                    {showFilters && activeDataset && (
                      <Reveal reduce={reduce}>
                        <Step
                          n="4"
                          label="Filters"
                          action={
                            <button
                              type="button"
                              data-r10n-kpi-link
                              onClick={addFilter}
                              className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors active:scale-95"
                            >
                              <Plus className="w-3 h-3" /> Add
                            </button>
                          }
                        >
                          {draft.filters.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No filters — every record in this dataset is counted.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {draft.filters.map((filter, i) => (
                                <FilterRow
                                  key={i}
                                  filter={filter}
                                  fields={activeDataset.fields}
                                  onChange={(patch) => updateFilter(i, patch)}
                                  onRemove={() => removeFilter(i)}
                                />
                              ))}
                            </div>
                          )}
                        </Step>
                      </Reveal>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>

            {/* LIVE PREVIEW — pinned */}
            <div className="border-t border-border shrink-0 px-5 py-4 space-y-3">
              <LivePreview
                ready={isValid}
                query={previewQuery}
                unit={draft.unit}
                showRows={showRows}
                onToggleRows={() => setShowRows((s) => !s)}
                combine={isCombineMode}
                ratio={isRatioMode}
                labelFor={metricLabelFor}
              />

              {/* Save error */}
              {saveMutation.isError && (
                <div className="flex items-start gap-2 rounded-[7px] bg-destructive/8 border border-destructive/20 px-3 py-2 text-[11px] text-destructive">
                  <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                  <span>{(saveMutation.error as Error)?.message ?? "Couldn't save."}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:text-foreground hover:border-foreground/30 transition-colors active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  data-r10n-kpi-primary-btn
                  onClick={() => configInput && saveMutation.mutate(configInput)}
                  disabled={!isValid || saveMutation.isPending}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-[7px] transition-colors active:scale-[0.98]",
                    isValid && !saveMutation.isPending
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-muted text-muted-foreground cursor-not-allowed",
                  )}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  Save config
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

// ─── Default value for a freshly-added filter row ────────────────────────────────

function defaultFilterValue(field: FieldDef, op: Operator): FilterClause["value"] {
  if (op === "is_set" || op === "is_not_set") return "";
  if (op === "in") return [];
  if (op === "between") return [0, 0];
  switch (field.type) {
    case "enum":
      return field.enumValues?.[0]?.value ?? "";
    case "boolean":
      return true;
    case "money":
    case "count":
      return 0;
    default:
      return "";
  }
}

// ─── Step wrapper (numbered) ──────────────────────────────────────────────────────

function Step({
  n,
  label,
  action,
  children,
}: {
  n: string;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span data-r10n-kpi-step className="flex items-center justify-center w-4 h-4 rounded-full bg-primary/10 text-primary text-[9px] font-bold">
            {n}
          </span>
          <p data-r10n-kpi-step-label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Target section — three cadence targets + a live pace preview ────────────────
// A target applies to ANY KPI, so it lives above the wiring. You set ONE cadence and
// the others auto-derive (editable). The preview re-runs the real pacing engine
// against the page's current window, so it reads exactly what the cell badge will.

type CadenceState = "anchor" | "override" | "auto";

const EMPTY_INPUTS: Record<Cadence, string> = { daily: "", weekly: "", monthly: "" };

/** Which cadences are explicitly set (anchor + any bespoke override) vs auto-derived. */
function computeExplicit(saved: SavedTarget, anchor: Cadence): Set<Cadence> {
  const explicit = new Set<Cadence>();
  const anchorVal = saved[anchor] ?? saved.monthly ?? saved.target;
  if (anchorVal == null) return explicit;
  explicit.add(anchor);
  const derived = deriveCadenceTargets(anchor, anchorVal);
  for (const k of CADENCE_ORDER) {
    const sv = saved[k];
    if (sv != null && k !== anchor && !approxEqual(sv, derived[k]!)) explicit.add(k);
  }
  return explicit;
}

/** "Jun 1 – Jun 26" from a [start, end) window (end exclusive → show end − 1). */
function formatSpan(start: string, end: string): string {
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  e.setDate(e.getDate() - 1);
  const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return s.toDateString() === e.toDateString() ? f(s) : `${f(s)} – ${f(e)}`;
}

/** Human descriptor for the window, derived from the engine's classification. */
function paceWindowLabel(pace: PaceResult): string {
  switch (pace.periodKind) {
    case "day": return "This day";
    case "week": return pace.prorated ? "Week to date" : "This week";
    case "month": return pace.prorated ? "Month to date" : "This month";
    case "upcoming": return "Upcoming";
    default: return "This range";
  }
}

function TargetSection({
  metricKey,
  unit,
  range,
  previewValue,
  savedTarget,
  loading,
  saving,
  saved,
  error,
  reduce,
  onEdited,
  onSave,
}: {
  metricKey: string;
  unit: MetricUnit;
  range?: { start: string; end: string };
  previewValue: number | null;
  savedTarget?: SavedTarget;
  loading: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  reduce: boolean | null;
  onEdited: () => void;
  onSave: (payload: TargetSavePayload) => void;
}) {
  const [inputs, setInputs] = useState<Record<Cadence, string>>(EMPTY_INPUTS);
  const [anchor, setAnchor] = useState<Cadence>("monthly");
  const [explicit, setExplicit] = useState<Set<Cadence>>(new Set());
  const [direction, setDirection] = useState<TargetDirection>("higher");

  // Reseed when the metric changes, or when its saved record first arrives — but
  // never clobber edits already in progress for the current metric.
  const lastSeedKey = useRef<string | null>(null);
  const dirty = useRef(false);
  useEffect(() => {
    const keyChanged = lastSeedKey.current !== metricKey;
    if (!keyChanged && dirty.current) return;
    lastSeedKey.current = metricKey;
    dirty.current = false;
    if (savedTarget) {
      const a = savedTarget.anchor ?? "monthly";
      setInputs({
        daily: savedTarget.daily != null ? formatTargetInput(savedTarget.daily, unit) : "",
        weekly: savedTarget.weekly != null ? formatTargetInput(savedTarget.weekly, unit) : "",
        monthly: savedTarget.monthly != null ? formatTargetInput(savedTarget.monthly, unit) : "",
      });
      setExplicit(computeExplicit(savedTarget, a));
      setAnchor(a);
      setDirection(savedTarget.direction);
    } else {
      setInputs(EMPTY_INPUTS);
      setExplicit(new Set());
      setAnchor("monthly");
      setDirection(defaultDirectionFor(metricKey));
    }
  }, [metricKey, savedTarget, unit]);

  // Editing a cadence makes it the anchor and re-derives every still-auto cadence.
  const handleCadence = useCallback(
    (c: Cadence, raw: string) => {
      onEdited();
      dirty.current = true;
      const num = parseTargetInput(raw);
      const nextInputs: Record<Cadence, string> = { ...inputs, [c]: raw };
      const nextExplicit = new Set(explicit);
      let nextAnchor = anchor;
      if (num != null) {
        nextExplicit.add(c);
        nextAnchor = c;
        const derived = deriveCadenceTargets(c, num);
        for (const k of CADENCE_ORDER) {
          if (k !== c && !nextExplicit.has(k)) nextInputs[k] = formatTargetInput(derived[k]!, unit);
        }
      } else {
        nextExplicit.delete(c);
        if (anchor === c) {
          const remaining = CADENCE_ORDER.filter((k) => nextExplicit.has(k));
          if (remaining.length > 0) {
            // Promote another explicitly-set cadence to anchor; re-derive the auto ones.
            nextAnchor = remaining[0];
            const av = parseTargetInput(nextInputs[nextAnchor]);
            if (av != null) {
              const derived = deriveCadenceTargets(nextAnchor, av);
              for (const k of CADENCE_ORDER) {
                if (!nextExplicit.has(k)) nextInputs[k] = formatTargetInput(derived[k]!, unit);
              }
            }
          } else {
            // Cleared the only target — the auto siblings were derived from it, so blank
            // everything back to a clean "no target set" state rather than stranding them.
            for (const k of CADENCE_ORDER) nextInputs[k] = "";
            nextAnchor = "monthly";
          }
        }
      }
      setInputs(nextInputs);
      setExplicit(nextExplicit);
      setAnchor(nextAnchor);
    },
    [inputs, explicit, anchor, unit, onEdited],
  );

  // ↺ — revert an override back to the auto-derived value.
  const handleReAuto = useCallback(
    (c: Cadence) => {
      onEdited();
      dirty.current = true;
      const nextExplicit = new Set(explicit);
      nextExplicit.delete(c);
      const nextInputs = { ...inputs };
      const av = parseTargetInput(inputs[anchor]);
      if (av != null) {
        const derived = deriveCadenceTargets(anchor, av);
        nextInputs[c] = formatTargetInput(derived[c]!, unit);
      }
      setExplicit(nextExplicit);
      setInputs(nextInputs);
    },
    [inputs, explicit, anchor, unit, onEdited],
  );

  const handleDirection = useCallback(
    (d: TargetDirection) => {
      onEdited();
      dirty.current = true;
      setDirection(d);
    },
    [onEdited],
  );

  const parsed: Record<Cadence, number | null> = {
    daily: parseTargetInput(inputs.daily),
    weekly: parseTargetInput(inputs.weekly),
    monthly: parseTargetInput(inputs.monthly),
  };
  const saveable = CADENCE_ORDER.some((k) => (parsed[k] ?? 0) > 0);

  // Live pace preview — same engine the badge uses, against the page's window.
  const pace = useMemo<PaceResult | null>(() => {
    if (!range) return null;
    const targets: CadenceTargets = { daily: parsed.daily, weekly: parsed.weekly, monthly: parsed.monthly };
    return paceForWindow({ value: previewValue ?? 0, direction, targets, window: range });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range?.start, range?.end, inputs.daily, inputs.weekly, inputs.monthly, direction, previewValue]);

  function stateOf(c: Cadence): CadenceState {
    if (anchor === c && explicit.has(c)) return "anchor";
    if (explicit.has(c)) return "override";
    return "auto";
  }

  return (
    <div data-r10n-kpi-target className="rounded-[7px] border border-border bg-muted/20 px-3.5 py-3">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2">
          <span data-r10n-kpi-target-badge className="flex items-center justify-center w-4 h-4 rounded-full bg-gold/15 text-gold">
            <TargetIcon className="w-2.5 h-2.5" />
          </span>
          <p data-r10n-kpi-step-label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Target</p>
        </div>
        <p className="text-[10px] text-muted-foreground/70">Set one · we pace the rest</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-7 w-full rounded-md bg-muted animate-pulse" />
          <div className="h-7 w-full rounded-md bg-muted animate-pulse" />
          <div className="h-7 w-full rounded-md bg-muted animate-pulse" />
        </div>
      ) : (
        <div className="space-y-3">
          {/* Three cadence rows, descending magnitude */}
          <div className="space-y-1.5">
            {CADENCE_ORDER.map((c) => (
              <CadenceRow
                key={c}
                cadence={c}
                value={inputs[c]}
                unit={unit}
                state={stateOf(c)}
                reduce={reduce}
                onChange={(v) => handleCadence(c, v)}
                onReAuto={() => handleReAuto(c)}
              />
            ))}
          </div>

          {/* Direction — segmented toggle */}
          <Field label="Which way is good?">
            <div className="flex gap-1">
              {[
                { v: "higher" as const, label: "Higher is better" },
                { v: "lower" as const, label: "Lower is better" },
              ].map((opt) => {
                const on = direction === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    data-r10n-kpi-seg
                    data-selected={on}
                    onClick={() => handleDirection(opt.v)}
                    aria-pressed={on}
                    className={cn(
                      "flex-1 px-2 py-1.5 rounded-[6px] text-[11px] font-semibold transition-colors active:scale-95",
                      on
                        ? "bg-primary/10 text-primary border border-primary/30"
                        : "bg-background text-foreground/70 border border-border hover:border-foreground/25",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground mt-1.5">
              {direction === "higher"
                ? "Being above the target reads as good (revenue, leads, MRR)."
                : "Being below the target reads as good (costs, churn, CPL, ad spend)."}
            </p>
          </Field>

          {/* Live pace preview — what the badge reads for the window you're viewing */}
          {pace && range && (
            <PacePreview pace={pace} hasValue={previewValue != null} unit={unit} span={formatSpan(range.start, range.end)} />
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-[7px] bg-destructive/8 border border-destructive/20 px-2.5 py-1.5 text-[11px] text-destructive">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Save target — its OWN action, independent of the config save */}
          <button
            type="button"
            onClick={() =>
              onSave({ metricKey, direction, anchor, daily: parsed.daily, weekly: parsed.weekly, monthly: parsed.monthly })
            }
            disabled={!saveable || saving}
            className={cn(
              "w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-[7px] transition-colors active:scale-[0.98]",
              saveable && !saving
                ? "bg-foreground/[0.06] text-foreground border border-border hover:bg-foreground/10"
                : "bg-muted text-muted-foreground cursor-not-allowed border border-transparent",
            )}
          >
            {saving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : saved ? (
              <Check className="w-3 h-3 text-success" />
            ) : (
              <TargetIcon className="w-3 h-3" />
            )}
            {saved ? "Target saved" : "Save target"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── One cadence row: label · $ input · state tag ────────────────────────────────

function CadenceRow({
  cadence,
  value,
  unit,
  state,
  reduce,
  onChange,
  onReAuto,
}: {
  cadence: Cadence;
  value: string;
  unit: MetricUnit;
  state: CadenceState;
  reduce: boolean | null;
  onChange: (v: string) => void;
  onReAuto: () => void;
}) {
  const prefix = unit === "currency" ? "$" : null;
  const suffix = unit === "percent" ? "%" : unit === "ratio" ? "×" : null;
  const isAnchor = state === "anchor";
  const isAuto = state === "auto";

  return (
    <div className="flex items-center gap-2.5">
      {/* Cadence label */}
      <span
        className={cn(
          "w-[52px] shrink-0 text-[10px] font-bold uppercase tracking-wider transition-colors",
          isAnchor ? "text-foreground" : "text-muted-foreground/80",
        )}
      >
        {CADENCE_LABEL[cadence]}
      </span>

      {/* Value input */}
      <div className="relative flex-1 min-w-0">
        {prefix && (
          <span
            className={cn(
              "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-medium transition-colors",
              isAuto ? "text-muted-foreground/60" : "text-muted-foreground",
            )}
          >
            {prefix}
          </span>
        )}
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${CADENCE_LABEL[cadence]} target`}
          placeholder="—"
          data-r10n-kpi-input
          data-cadence-state={state}
          className={cn(
            "w-full rounded-[7px] border py-1.5 text-xs font-medium tabular-nums transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:text-foreground focus:bg-background",
            prefix ? "pl-6" : "pl-2.5",
            suffix ? "pr-6" : "pr-2.5",
            isAnchor
              ? "border-primary/35 bg-background text-foreground font-semibold ring-1 ring-primary/15"
              : isAuto
                ? "border-border bg-muted/30 text-muted-foreground/80 placeholder:text-muted-foreground/40"
                : "border-border bg-background text-foreground placeholder:text-muted-foreground/40",
          )}
        />
        {suffix && (
          <span
            className={cn(
              "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium transition-colors",
              isAuto ? "text-muted-foreground/60" : "text-muted-foreground",
            )}
          >
            {suffix}
          </span>
        )}
      </div>

      {/* State tag — fixed width so every input edge aligns */}
      <div className="w-[52px] shrink-0 flex justify-end">
        {isAnchor ? (
          <motion.span
            layoutId="kpi-target-anchor"
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 36 }}
            data-r10n-kpi-anchor
            className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-gold"
          >
            <span data-r10n-kpi-anchor-dot className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
            Anchor
          </motion.span>
        ) : isAuto ? (
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/55">
            Auto
          </span>
        ) : (
          <button
            type="button"
            onClick={onReAuto}
            title="Reset to the auto-paced value"
            className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors active:scale-95"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Auto
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Pace preview — the real engine, against the page's current window ───────────

function PacePreview({
  pace,
  hasValue,
  unit,
  span,
}: {
  pace: PaceResult;
  hasValue: boolean;
  unit: MetricUnit;
  span: string;
}) {
  const upcoming = pace.periodKind === "upcoming";
  const wholePeriod =
    !pace.prorated &&
    (pace.periodKind === "day" || pace.periodKind === "week" || pace.periodKind === "month");
  const refWord = wholePeriod ? "target" : "pace";
  const elapsedPct = pace.periodDays > 0 ? Math.min(100, (pace.elapsedDays / pace.periodDays) * 100) : 0;

  // Verdict (only when there's a live value to plot).
  let verdict: { tone: "good" | "bad" | "neutral"; text: string } | null = null;
  if (hasValue && !upcoming && !pace.zeroTarget) {
    if (pace.neutral) {
      verdict = { tone: "neutral", text: `On ${refWord}` };
    } else {
      const pct = Math.abs(pace.deltaPct);
      const pctText = `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
      verdict = {
        tone: pace.isGood ? "good" : "bad",
        text: `${pctText} ${pace.isAbove ? "above" : "below"} ${refWord}`,
      };
    }
  }

  return (
    <div data-r10n-kpi-pace className="rounded-[7px] bg-gold/[0.07] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <TargetIcon data-r10n-kpi-pace-icon className="w-2.5 h-2.5 text-gold" />
          <p data-r10n-kpi-pace-label className="text-[9px] font-bold uppercase tracking-widest text-gold/90">Pace · right now</p>
        </div>
        <p className="text-[10px] font-medium text-muted-foreground tabular-nums truncate">
          {paceWindowLabel(pace)} · {span}
        </p>
      </div>

      {upcoming ? (
        <p className="text-[11px] text-muted-foreground">This period hasn&apos;t started yet.</p>
      ) : pace.zeroTarget ? (
        <p className="text-[11px] text-muted-foreground">Set a target above 0 to see the pace.</p>
      ) : (
        <>
          {/* The headline pace target */}
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-bold text-foreground tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
              {fmtValue(pace.expected, unit)}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                {wholePeriod ? `${refWord}` : `pace of ${fmtValue(pace.fullPeriodTarget, unit)}`}
              </span>
            </p>
            {verdict && (
              <span
                data-r10n-kpi-verdict
                data-tone={verdict.tone}
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-semibold shrink-0",
                  verdict.tone === "good"
                    ? "text-success"
                    : verdict.tone === "bad"
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {verdict.tone === "neutral" ? (
                  <span data-r10n-kpi-anchor-dot className="h-1 w-1 rounded-full bg-gold" aria-hidden />
                ) : pace.isAbove ? (
                  <TrendingUp className="w-2.5 h-2.5" aria-hidden />
                ) : (
                  <TrendingDown className="w-2.5 h-2.5" aria-hidden />
                )}
                {verdict.text}
              </span>
            )}
          </div>

          {/* Elapsed-days bar — visualises the proration (why the pace target is what it is) */}
          {pace.prorated && (
            <div className="mt-2">
              <div className="relative h-1 w-full rounded-full bg-border/55 overflow-hidden">
                <div
                  data-r10n-kpi-pace-bar
                  className="absolute inset-y-0 left-0 rounded-full bg-gold/70 transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${elapsedPct}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                {pace.elapsedDays} of {pace.periodDays} days elapsed
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Progressive-reveal wrapper ───────────────────────────────────────────────────

function Reveal({ reduce, children }: { reduce: boolean | null; children: React.ReactNode }) {
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

// ─── Labelled field wrapper ───────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground mb-1">{label}</p>
      {children}
    </div>
  );
}

// ─── Combine term row — pick a KPI + add/subtract toggle ─────────────────────────

function TermRow({
  term,
  options,
  isFirst,
  onChange,
  onRemove,
}: {
  term: CombineTerm;
  options: { value: string; label: string }[];
  /** The first term reads more naturally as "Start with" than "Add". */
  isFirst: boolean;
  onChange: (patch: Partial<CombineTerm>) => void;
  onRemove: () => void;
}) {
  const isAdd = term.sign === 1;
  return (
    <div className="rounded-[7px] border border-border bg-muted/20 px-2.5 py-2.5">
      <div className="flex items-center gap-1.5">
        {/* +/− toggle */}
        <div className="flex shrink-0 rounded-[6px] border border-border overflow-hidden">
          <button
            type="button"
            data-r10n-kpi-sign
            data-selected={isAdd}
            onClick={() => onChange({ sign: 1 })}
            aria-label="Add this KPI"
            aria-pressed={isAdd}
            className={cn(
              "w-7 h-7 flex items-center justify-center text-sm font-bold transition-colors active:scale-95",
              isAdd ? "bg-primary text-primary-foreground" : "bg-background text-foreground/60 hover:text-foreground",
            )}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => onChange({ sign: -1 })}
            aria-label="Subtract this KPI"
            aria-pressed={!isAdd}
            className={cn(
              "w-7 h-7 flex items-center justify-center text-sm font-bold border-l border-border transition-colors active:scale-95",
              !isAdd ? "bg-destructive text-white" : "bg-background text-foreground/60 hover:text-foreground",
            )}
          >
            −
          </button>
        </div>

        {/* KPI dropdown — label shown, metricKey stored */}
        <div className="flex-1 min-w-0">
          <Select
            value={term.metricKey}
            placeholder={isFirst ? "Start with…" : "Add a KPI…"}
            onChange={(v) => onChange({ metricKey: v })}
            options={options}
          />
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove KPI"
          className="p-1 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/8 transition-colors active:scale-90 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Native-styled Select (matches the form chrome) ───────────────────────────────

function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-r10n-kpi-input
        className={cn(
          "w-full appearance-none rounded-[7px] border border-border bg-background pl-3 pr-7 py-1.5 text-xs font-medium text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer",
          !value && placeholder && "text-muted-foreground",
        )}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
    </div>
  );
}

// ─── Filter row — field → operator → value, all dropdowns ─────────────────────────

function FilterRow({
  filter,
  fields,
  onChange,
  onRemove,
}: {
  filter: FilterClause;
  fields: FieldDef[];
  onChange: (patch: Partial<FilterClause>) => void;
  onRemove: () => void;
}) {
  const field = fields.find((f) => f.key === filter.field) ?? fields[0];

  // When the field changes, reset the operator to a legal one and the value to a sane default.
  function handleFieldChange(nextKey: string) {
    const nextField = fields.find((f) => f.key === nextKey);
    if (!nextField) return;
    const nextOp = nextField.operators.includes(filter.op) ? filter.op : nextField.operators[0];
    onChange({ field: nextKey, op: nextOp, value: defaultFilterValue(nextField, nextOp) });
  }

  // When the operator changes, the value control may change shape — reset to a default.
  function handleOpChange(nextOp: Operator) {
    onChange({ op: nextOp, value: defaultFilterValue(field, nextOp) });
  }

  return (
    <div className="rounded-[7px] border border-border bg-muted/20 px-2.5 py-2.5">
      <div className="flex items-start gap-1.5">
        <div className="flex-1 grid grid-cols-2 gap-1.5">
          {/* Field — always a dropdown of known fields */}
          <Select
            value={field.key}
            onChange={handleFieldChange}
            options={fields.map((f) => ({ value: f.key, label: f.label }))}
          />
          {/* Operator — driven by FieldDef.operators */}
          <Select
            value={filter.op}
            onChange={(v) => handleOpChange(v as Operator)}
            options={field.operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
          />
          {/* Value — driven by field type, full width below */}
          <div className="col-span-2">
            <FilterValue field={field} op={filter.op} value={filter.value} onChange={(value) => onChange({ value })} />
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove filter"
          className="p-1 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/8 transition-colors active:scale-90 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── The value control — its shape is dictated by the field type + operator ──────

function FilterValue({
  field,
  op,
  value,
  onChange,
}: {
  field: FieldDef;
  op: Operator;
  value: FilterClause["value"];
  onChange: (value: FilterClause["value"]) => void;
}) {
  // Value-less operators
  if (op === "is_set" || op === "is_not_set") {
    return (
      <p className="text-[11px] text-muted-foreground italic px-1 py-1.5">
        No value needed — checks whether the field {op === "is_set" ? "has" : "lacks"} a value.
      </p>
    );
  }

  // between → two numbers
  if (op === "between") {
    const pair: [number, number] = Array.isArray(value) && value.length === 2 && typeof value[0] === "number"
      ? (value as [number, number])
      : [0, 0];
    return (
      <div className="flex items-center gap-1.5">
        <NumberInput value={pair[0]} onChange={(n) => onChange([n, pair[1]])} />
        <span className="text-[11px] text-muted-foreground shrink-0">and</span>
        <NumberInput value={pair[1]} onChange={(n) => onChange([pair[0], n])} />
      </div>
    );
  }

  // enum → dropdown of enumValues (single, or multi for `in`)
  if (field.type === "enum") {
    const enumOpts = field.enumValues ?? [];
    if (op === "in") {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1">
          {enumOpts.map((ev) => {
            const on = selected.includes(ev.value);
            return (
              <button
                key={ev.value}
                type="button"
                data-r10n-kpi-seg
                data-selected={on}
                onClick={() =>
                  onChange(on ? selected.filter((v) => v !== ev.value) : [...selected, ev.value])
                }
                className={cn(
                  "px-2 py-1 rounded-[5px] text-[11px] font-medium transition-colors active:scale-95",
                  on
                    ? "bg-primary/10 text-primary border border-primary/30"
                    : "bg-background text-foreground/70 border border-border hover:border-foreground/25",
                )}
              >
                {ev.label}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <Select
        value={typeof value === "string" ? value : ""}
        placeholder="Select value"
        onChange={onChange}
        options={enumOpts.map((ev) => ({ value: ev.value, label: ev.label }))}
      />
    );
  }

  // boolean → true / false toggle
  if (field.type === "boolean") {
    const on = value === true || value === "true";
    return (
      <div className="flex gap-1">
        {[
          { v: true, label: "True" },
          { v: false, label: "False" },
        ].map((opt) => (
          <button
            key={String(opt.v)}
            type="button"
            data-r10n-kpi-seg
            data-selected={on === opt.v}
            onClick={() => onChange(opt.v)}
            className={cn(
              "flex-1 px-2 py-1 rounded-[5px] text-[11px] font-medium transition-colors active:scale-95",
              on === opt.v
                ? "bg-primary/10 text-primary border border-primary/30"
                : "bg-background text-foreground/70 border border-border hover:border-foreground/25",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  // money / count → number
  if (field.type === "money" || field.type === "count") {
    return <NumberInput value={typeof value === "number" ? value : 0} onChange={onChange} />;
  }

  // date → date input
  if (field.type === "date") {
    return (
      <input
        type="date"
        data-r10n-kpi-input
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[7px] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    );
  }

  // string → text (contains/eq/neq). The only free-text control — and it can only
  // ever target a known field with a known operator, so confidence holds.
  return (
    <input
      type="text"
      data-r10n-kpi-input
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={op === "contains" ? "Contains…" : "Value…"}
      className="w-full rounded-[7px] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
    />
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      data-r10n-kpi-input
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        onChange(Number.isNaN(n) ? 0 : n);
      }}
      className="w-full rounded-[7px] border border-border bg-background px-3 py-1.5 text-xs font-medium tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
    />
  );
}

// ─── Live preview card ────────────────────────────────────────────────────────────

function LivePreview({
  ready,
  query,
  unit,
  showRows,
  onToggleRows,
  combine = false,
  ratio = false,
  labelFor,
}: {
  ready: boolean;
  query: ReturnType<typeof useQuery<PreviewResponse>>;
  unit: MetricUnit;
  showRows: boolean;
  onToggleRows: () => void;
  /** Combine mode: rows are the per-term contributions, shown expanded by default. */
  combine?: boolean;
  /** Ratio mode: rows are the numerator & denominator, shown expanded by default. */
  ratio?: boolean;
  /** Resolve a metricKey to a friendly label (for combine/ratio breakdown rows). */
  labelFor?: (key: string) => string;
}) {
  // Not enough config to preview yet — calm prompt, not an error.
  if (!ready) {
    return (
      <div data-r10n-kpi-preview className="rounded-[7px] bg-primary/5 border border-primary/20 px-3.5 py-3">
        <p data-r10n-kpi-preview-label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1">
          Live Preview
        </p>
        <p className="text-xs text-muted-foreground">
          {combine
            ? "Add at least one KPI to see the combined total."
            : ratio
              ? "Pick a numerator and a denominator to see the ratio."
              : "Pick a scope and a measure to see what this KPI reads."}
        </p>
      </div>
    );
  }

  const data = query.data;
  const isLoading = query.isLoading || query.isFetching;
  const isError = query.isError && !query.isFetching;
  const sampleRows = data?.sampleRows ?? [];
  const hasRows = sampleRows.length > 0;
  // In combine/ratio mode the rows ARE the breakdown — expand them by default.
  const rowsExpanded = combine || ratio ? true : showRows;

  return (
    <div data-r10n-kpi-preview className="rounded-[7px] bg-primary/5 border border-primary/20 px-3.5 py-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p data-r10n-kpi-preview-label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
          Live Preview
        </p>
        {hasRows && !combine && !ratio && (
          <button
            data-r10n-kpi-link
            onClick={onToggleRows}
            className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors active:scale-95"
          >
            <ListTree className="w-3 h-3" />
            {showRows ? "Hide rows" : "View rows"}
          </button>
        )}
      </div>

      {/* Value line */}
      {isError ? (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>
            {(query.error as Error)?.message ?? "Couldn't reach the source"} — adjust and it&apos;ll retry.
          </span>
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-3">
          <div className="h-7 w-28 rounded-md bg-muted animate-pulse" />
          <div className="h-3.5 w-16 rounded bg-muted/70 animate-pulse" />
        </div>
      ) : (
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="text-2xl font-bold text-foreground tabular-nums"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {fmtPreviewValue(data?.value ?? 0, unit)}
          </span>
          <span className="text-xs text-muted-foreground">
            · {(data?.count ?? 0).toLocaleString("en-US")}{" "}
            {combine
              ? (data?.count ?? 0) === 1 ? "component" : "components"
              : ratio
                ? (data?.count ?? 0) === 1 ? "input" : "inputs"
                : (data?.count ?? 0) === 1 ? "record" : "records"}
          </span>
        </div>
      )}

      {/* Empty (legitimate zero) note — record-based only; a combine/ratio total of 0 is fine. */}
      {!combine && !ratio && !isLoading && !isError && (data?.count ?? 0) === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No records match these filters yet — this reads {fmtPreviewValue(0, unit)}.
        </p>
      )}

      {/* Sample rows */}
      <AnimatePresence initial={false}>
        {rowsExpanded && hasRows && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="rounded-[6px] border border-border bg-card divide-y divide-border/70 mt-1">
              {sampleRows.map((row, i) => {
                // Combine breakdown rows arrive as { id: metricKey, label: "+ key",
                // amount: signed contribution }. Resolve the metricKey to a friendly
                // label and surface the sign as a coloured +/− glyph.
                const isSubtract = combine && row.amount != null && row.amount < 0;
                const displayLabel =
                  (combine || ratio) && row.id && labelFor ? labelFor(row.id) : row.label;
                return (
                  <div key={row.id ?? `${row.label}-${i}`} className="flex items-center justify-between px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {combine && (
                        <span
                          data-r10n-kpi-sign-glyph
                          data-subtract={isSubtract}
                          className={cn(
                            "shrink-0 text-[11px] font-bold tabular-nums",
                            isSubtract ? "text-destructive" : "text-primary",
                          )}
                          aria-hidden
                        >
                          {isSubtract ? "−" : "+"}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-foreground truncate">{displayLabel}</p>
                        {(row.sublabel || row.date) && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {[row.sublabel, fmtRowDate(row.date)].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>
                    {row.amount != null && (
                      <span
                        className={cn(
                          "ml-3 shrink-0 text-[11px] font-semibold tabular-nums",
                          isSubtract ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {fmtRowAmount(row.amount)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
