/**
 * Load/save + validate the unit-economics assumptions. Hand-rolled normalization (this project
 * has no Zod): coerces every value finite and in-range, guarantees all four roles exist on every
 * package (the write-boundary NaN guard), dedupes package ids, and falls back to the seed.
 */
import { db } from "@/lib/db";
import { unitEconomicsSettings } from "@/lib/db/schema";
import { SEED_ASSUMPTIONS } from "./defaults";
import { ROLES, num, type Assumptions, type Role } from "./model";

export const CURRENT_SCHEMA_VERSION = 1;

export function normalizeAssumptions(input: unknown): Assumptions {
  const seed = SEED_ASSUMPTIONS;
  const o = (input ?? {}) as Record<string, unknown>;
  const clampPct = (v: unknown, fb: number) => Math.min(1, Math.max(0, num(v, fb)));

  const salaryIn = (o.roleMonthlySalary ?? {}) as Record<string, unknown>;
  const roleMonthlySalary = {} as Record<Role, number>;
  for (const r of ROLES) roleMonthlySalary[r] = Math.max(0, num(salaryIn[r], seed.roleMonthlySalary[r]));

  const tiersIn = Array.isArray(o.tiers) ? o.tiers : seed.tiers;
  if (!tiersIn.length) throw new Error("At least one package is required");
  const seenIds = new Set<string>();
  const tiers = tiersIn.map((raw, i) => {
    const t = (raw ?? {}) as Record<string, unknown>;
    const id = String(t.id ?? `tier_${i}`);
    if (seenIds.has(id)) throw new Error(`Duplicate package id: ${id}`);
    seenIds.add(id);
    const hoursIn = (t.hours ?? {}) as Record<string, unknown>;
    const hours = {} as Record<Role, number>;
    for (const r of ROLES) hours[r] = Math.max(0, num(hoursIn[r], 0)); // every role present
    return {
      id,
      name: String(t.name ?? "Package").slice(0, 60),
      monthlyPrice: Math.max(0, num(t.monthlyPrice, 0)),
      deliverables: String(t.deliverables ?? "").slice(0, 300),
      isCustom: !!t.isCustom,
      additionalMonths: Math.max(0, num(t.additionalMonths, 0)),
      hours,
      expectedMonthlyCount: Math.max(0, num(t.expectedMonthlyCount, 0)),
    };
  });

  const ovIn = (o.overhead ?? {}) as Record<string, unknown>;
  const overhead = {
    teamPayroll: Math.max(0, num(ovIn.teamPayroll, seed.overhead.teamPayroll)),
    founderComp: Math.max(0, num(ovIn.founderComp, seed.overhead.founderComp)),
    software: Math.max(0, num(ovIn.software, seed.overhead.software)),
    insurance: Math.max(0, num(ovIn.insurance, seed.overhead.insurance)),
    otherAdmin: Math.max(0, num(ovIn.otherAdmin, seed.overhead.otherAdmin)),
  };

  const caIn = (o.companyActuals ?? {}) as Record<string, unknown>;
  const companyActuals = {
    revenue: Math.max(0, num(caIn.revenue, seed.companyActuals.revenue)),
    adSpend: Math.max(0, num(caIn.adSpend, seed.companyActuals.adSpend)),
    commission: Math.max(0, num(caIn.commission, seed.companyActuals.commission)),
    processing: Math.max(0, num(caIn.processing, seed.companyActuals.processing)),
  };

  return {
    termMonths: Math.max(1, Math.round(num(o.termMonths, seed.termMonths))),
    commissionPct: clampPct(o.commissionPct, seed.commissionPct),
    processingPct: clampPct(o.processingPct, seed.processingPct),
    contractorFeePct: Math.max(0, num(o.contractorFeePct, seed.contractorFeePct)),
    ltvCacTarget: Math.max(0.1, num(o.ltvCacTarget, seed.ltvCacTarget)),
    roleMonthlySalary,
    tiers,
    overhead,
    companyActuals,
  };
}

export async function loadAssumptions(): Promise<Assumptions> {
  try {
    const [row] = await db().select().from(unitEconomicsSettings).limit(1);
    if (!row) return SEED_ASSUMPTIONS;
    return normalizeAssumptions(row.assumptions); // normalize is forward-safe across schema drift
  } catch {
    return SEED_ASSUMPTIONS;
  }
}

/** Single-row upsert (delete + insert), matching the app's cost_settings pattern. */
export async function saveAssumptions(a: unknown, updatedBy: string | null): Promise<Assumptions> {
  const normalized = normalizeAssumptions(a);
  await db().delete(unitEconomicsSettings);
  await db().insert(unitEconomicsSettings).values({ assumptions: normalized, schemaVersion: CURRENT_SCHEMA_VERSION, updatedBy });
  return normalized;
}
