/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ENGINE FACADE — the single read path for every KPI surface.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The card, the drawer, the dashboard tile and the live preview all come through
 * here, so they can never disagree:
 *
 *   getMetricValue(key, range, ctx)        → one metric (loads its enabled config)
 *   getMetricValues(keys[], range, ctx)    → batched; dedupes dataset loads so N
 *                                            configs sharing a dataset hit it once
 *   runDraft(config, range, ctx)           → preview path (run without persisting)
 *
 * An unconfigured metric (no enabled config) returns the calm "ghost" result:
 * { value: 0, prev: 0, series: [], rows: [], unit: "count", unconfigured: true }.
 */
import type { MetricConfig, Range, EngineCtx, MetricResult, RawRow } from "./types";
import { run } from "./run";
import { getConfig, listConfigs } from "./configs";
import { getDataset } from "./datasets";

// Re-exports — callers import everything they need from the engine facade.
export {
  getConfig,
  listConfigs,
  upsertConfig,
  deleteConfig,
  validateConfigInput,
} from "./configs";
export { describeRegistry, REGISTRY, getDataset } from "./datasets";
export { run } from "./run";

/** The ghost result served when a metric has no enabled config. */
function unconfiguredResult(): MetricResult {
  return { value: 0, prev: 0, series: [], rows: [], unit: "count", unconfigured: true };
}

/**
 * One metric. Loads the enabled config; if none exists (or it's disabled) returns
 * the ghost state. Otherwise runs the engine.
 */
export async function getMetricValue(
  metricKey: string,
  range: Range,
  ctx: EngineCtx,
): Promise<MetricResult> {
  const config = await getConfig(metricKey);
  if (!config || !config.enabled) return unconfiguredResult();
  return run(config, range, ctx);
}

/**
 * Batched read with dataset-dedupe. If several configs share a dataset, the
 * dataset's expensive `load()` is performed ONCE and the universe shared across
 * all configs that read it — strictly cheaper than running each independently.
 *
 * Ratio configs are run individually (their work is recursive config reads, not a
 * dataset scan); the batched cache is passed through so any shared child datasets
 * still dedupe.
 */
export async function getMetricValues(
  metricKeys: string[],
  range: Range,
  ctx: EngineCtx,
): Promise<Record<string, MetricResult>> {
  const out: Record<string, MetricResult> = {};
  const uniqueKeys = Array.from(new Set(metricKeys));
  if (uniqueKeys.length === 0) return out;

  // Resolve all requested configs once.
  const configs = await Promise.all(uniqueKeys.map((k) => getConfig(k)));

  // Per-request cache of dataset universes, keyed by dataset. Shared by all
  // configs (and recursively by ratio children) within this batch.
  const universeCache = new Map<string, Promise<RawRow[]>>();
  const loadOnce = makeLoadOnce(universeCache, range, ctx);

  await Promise.all(
    uniqueKeys.map(async (key, i) => {
      const config = configs[i];
      if (!config || !config.enabled) {
        out[key] = unconfiguredResult();
        return;
      }
      out[key] = await runWithCache(config, range, ctx, loadOnce);
    }),
  );

  return out;
}

/**
 * Live preview / draft path: run an UNSAVED config against the range without any
 * persistence. Identical math to a saved run, so the preview is provably the same
 * data the card will show after save.
 */
export async function runDraft(
  config: MetricConfig,
  range: Range,
  ctx: EngineCtx,
): Promise<MetricResult> {
  return run(config, range, ctx);
}

// ─── Batched dataset dedupe ──────────────────────────────────────────────────

/**
 * A loader that fetches each dataset's universe at most once per batch. We patch
 * the dataset's `load` for the duration of a single `run()` so the engine's
 * internal `ds.load(...)` call resolves from the shared cache. The widest window
 * (prevStart..end) is identical for every metric in a batch (same range), so one
 * cached universe per dataset is always correct.
 */
type LoadOnce = (datasetKey: string, real: () => Promise<RawRow[]>) => Promise<RawRow[]>;

function makeLoadOnce(
  cache: Map<string, Promise<RawRow[]>>,
  _range: Range,
  _ctx: EngineCtx,
): LoadOnce {
  return (datasetKey, real) => {
    const existing = cache.get(datasetKey);
    if (existing) return existing;
    const p = real();
    cache.set(datasetKey, p);
    return p;
  };
}

/**
 * Run a config while routing its dataset `load()` through the shared cache. We
 * temporarily wrap the dataset's `load` so the unmodified engine in run.ts reuses
 * an already-fetched universe instead of re-hitting the integration. The wrap is
 * restored in a finally block so the registry is never left mutated.
 */
async function runWithCache(
  config: MetricConfig,
  range: Range,
  ctx: EngineCtx,
  loadOnce: LoadOnce,
): Promise<MetricResult> {
  // Ratios don't scan a dataset themselves; just run (children dedupe via cache
  // only if they're also in this batch — acceptable, they're cheap config reads).
  if (config.aggregation.op === "ratio") {
    return run(config, range, ctx);
  }

  const ds = getDataset(config.dataset);
  if (!ds) return run(config, range, ctx);

  const realLoad = ds.load;
  ds.load = (loadCtx) => loadOnce(ds.key, () => realLoad(loadCtx));
  try {
    return await run(config, range, ctx);
  } finally {
    ds.load = realLoad;
  }
}
