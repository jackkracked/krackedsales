/**
 * Regression suite for the unit-economics engine. Run: `npx tsx lib/unit-economics/validate.ts`
 * Throws (non-zero exit) on any drift from Gage's §9 reference numbers or any robustness
 * failure. This is the locked "provably correct forever" gate the panel required.
 */
import { SEED_ASSUMPTIONS } from "./defaults";
import {
  computeTiers, computeTier, blendedTargetCac, blendedBreakevenCac, realizedCac, paybackMonths,
  computeCompanyPnL, type Assumptions, type TierInput,
} from "./model";

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  if (pass) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}  ${detail}`); failures++; }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x);

// ── §9: per-tier contribution % ─────────────────────────────────────────────────
console.log("§9 per-tier contribution %:");
const econ = computeTiers(SEED_ASSUMPTIONS);
const expectCm: Record<string, number> = { custom_1000: 31.2, limited_1500: 36.6, starter_3000: 43.2, growth_4500: 41.0, elite_7500: 48.5 };
for (const e of econ) check(`${e.name} = ${(e.contributionPct * 100).toFixed(1)}% (§9 ${expectCm[e.id]}%)`, near(e.contributionPct * 100, expectCm[e.id], 0.15));

// ── §7: worked example ($1,000 package) ─────────────────────────────────────────
console.log("§7 worked example ($1,000):");
const t1000 = econ.find((e) => e.id === "custom_1000")!;
check(`contribution ≈ $935 (got $${t1000.contribution.toFixed(0)})`, near(t1000.contribution, 935, 3));
check(`monthly contribution ≈ $312 (got $${t1000.monthlyContribution.toFixed(0)})`, near(t1000.monthlyContribution, 312, 2));
check(`variable cost ≈ $2,065 (got $${t1000.variableCostTerm.toFixed(0)})`, near(t1000.variableCostTerm, 2065, 3));
check(`conservative max CAC ≈ $935 (got $${t1000.conservativeMaxCac.toFixed(0)})`, near(t1000.conservativeMaxCac, 935, 3));
check(`recommended floor ≈ $312 (got $${t1000.recommendedMaxCacFloor.toFixed(0)})`, near(t1000.recommendedMaxCacFloor, 312, 2));

// ── §9: blended figures ─────────────────────────────────────────────────────────
console.log("§9 blended:");
check(`blended target (floor) ≈ $770 (got $${blendedTargetCac(econ, "floor").toFixed(0)})`, near(blendedTargetCac(econ, "floor"), 770, 12));
check(`blended breakeven ≈ $2,310 (got $${blendedBreakevenCac(econ).toFixed(0)})`, near(blendedBreakevenCac(econ), 2310, 20));
check(`realized CAC ≈ $729 sample (spend 9477 / 13)`, near(realizedCac(9477, 13)!, 729, 1));

// ── Robustness: NaN/undefined inputs never NaN the output ────────────────────────
console.log("Robustness — bad inputs are contained:");
const bad: Assumptions = JSON.parse(JSON.stringify(SEED_ASSUMPTIONS));
// @ts-expect-error inject a bad salary + a missing role hour + a NaN price
bad.roleMonthlySalary.designer = "oops"; bad.tiers[0].hours.strategist = undefined; bad.tiers[1].monthlyPrice = NaN;
const badEcon = computeTiers(bad);
check("no NaN/Infinity anywhere in outputs", badEcon.every((e) =>
  [e.contribution, e.contributionPct, e.recommendedMaxCacFloor, e.recommendedMaxCacHope, e.ltvContribution, e.rawLabourTerm].every(finite)));
check("blended stays finite with bad inputs", finite(blendedTargetCac(badEcon)) && finite(blendedBreakevenCac(badEcon)));

// ── Negative contribution: viable=false, max CAC clamped ≥ 0 ──────────────────────
console.log("Negative-contribution guardrails:");
const overserviced: TierInput = { ...SEED_ASSUMPTIONS.tiers[0], id: "x", monthlyPrice: 500, hours: { designer: 200, copywriter: 200, strategist: 200, tech: 50 } };
const neg = computeTier(overserviced, SEED_ASSUMPTIONS);
check("contribution is negative (real info, signed)", neg.contribution < 0);
check("viable = false", neg.viable === false);
check("recommended max CAC clamped to ≥ 0", neg.recommendedMaxCacFloor >= 0 && neg.conservativeMaxCac >= 0);

// ── Zero-denominator honesty ─────────────────────────────────────────────────────
console.log("Zero-denominator honesty:");
check("realizedCac(spend, 0 clients) = null (not Infinity)", realizedCac(5000, 0) === null);
check("paybackMonths(cac, 0 monthly) = null", paybackMonths(729, 0) === null);
check("payback $312 CAC on $312/mo ≈ 1.0 mo", near(paybackMonths(312, 312)!, 1, 0.01));

// ── Company P&L reconciles from real actuals (CFO C1) ────────────────────────────
console.log("Company P&L reconciliation (real actuals → net):");
// Overhead seed sums to $83,750 (§9). With actuals that leave ~$12,330 net, it must tie.
const overheadTotal = SEED_ASSUMPTIONS.overhead.teamPayroll + SEED_ASSUMPTIONS.overhead.founderComp + SEED_ASSUMPTIONS.overhead.software + SEED_ASSUMPTIONS.overhead.insurance + SEED_ASSUMPTIONS.overhead.otherAdmin;
check(`overhead seed sums to $83,750 (§9) (got $${overheadTotal})`, near(overheadTotal, 83750, 1));
const pnl = computeCompanyPnL({ revenue: 98580, adSpend: 500, commission: 1500, processing: 500 }, SEED_ASSUMPTIONS);
check(`net ties out (rev − var − overhead), got $${pnl.net.toFixed(0)}`, near(pnl.net, 98580 - 2500 - 83750, 1));
check("contribution checkpoint = revenue − variable", near(pnl.totalContribution, pnl.revenue - pnl.variableTotal, 0.01));

console.log("");
if (failures) { console.log(`❌ ${failures} FAILURE(S)`); process.exit(1); }
console.log("✅ ALL CHECKS PASS — engine matches §9 and is robust");
