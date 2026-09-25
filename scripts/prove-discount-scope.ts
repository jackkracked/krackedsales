/**
 * Prove the discount MATHS across every scope, management option and split shape.
 *
 * THE INVARIANT
 * Three surfaces must agree on every proposal, or a client is quoted one number and charged
 * another: the headline term total, the sum of the payment schedule, and the amount Stripe is
 * told to collect. This asserts all three against each other for each combination.
 *
 *   npx tsx scripts/prove-discount-scope.ts
 */
import {
  managementSchedule, fullTermTotal, firstPaymentDiscount, discountInfo, discountSentence,
  type BillingTerms,
} from "../lib/proposals/billing";

const MONTHLY = 1000;
const mk = (o: Partial<BillingTerms>): BillingTerms => ({
  type: "management", paymentStructure: "subscription", totalAmount: MONTHLY, currency: "usd",
  billingInterval: "month", billingIntervalCount: 1, autoRenew: true,
  managementOption: "spread", autoRebillMode: "none", startDate: new Date("2026-08-15T12:00:00.000Z"),
  ...o,
} as BillingTerms);

let fails = 0, cases = 0;
const check = (name: string, cond: boolean, detail = "") => {
  cases++;
  if (!cond) { fails++; console.log(`  FAIL  ${name}  ${detail}`); }
};
const money = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => "$" + n.toFixed(2);

// A discount of 250 expressed both ways, so percent and fixed can never diverge.
const DISCOUNTS: Array<{ label: string; f: Partial<BillingTerms> }> = [
  { label: "none", f: {} },
  { label: "recurring $250", f: { listAmount: MONTHLY, discountType: "fixed", discountValue: 250, discountScope: "recurring" } },
  { label: "recurring 25%", f: { listAmount: MONTHLY, discountType: "percent", discountValue: 25, discountScope: "recurring" } },
  { label: "first_payment $250", f: { listAmount: MONTHLY, discountType: "fixed", discountValue: 250, discountScope: "first_payment" } },
  { label: "first_payment 25%", f: { listAmount: MONTHLY, discountType: "percent", discountValue: 25, discountScope: "first_payment" } },
  // A legacy row: discount present, scope never set. Must behave exactly as "recurring" did.
  { label: "legacy null scope", f: { listAmount: MONTHLY, discountType: "fixed", discountValue: 250, discountScope: null } },
];
const SPLITS: Array<{ label: string; v: Array<{ amount: number; offsetDays?: number }> | undefined }> = [
  { label: "no split", v: undefined },
  { label: "split 600+400", v: [{ amount: 600, offsetDays: 0 }, { amount: 400, offsetDays: 14 }] },
  { label: "split 400+300+300", v: [{ amount: 400, offsetDays: 0 }, { amount: 300, offsetDays: 7 }, { amount: 300, offsetDays: 21 }] },
];

console.log("\n=== Discount scope: schedule vs headline vs Stripe ===\n");

for (const d of DISCOUNTS) for (const sp of SPLITS) {
  // `totalAmount` is the RECURRING price. Under first_payment it stays whole; under recurring the
  // builder has already subtracted, so model that here exactly as the builder stores it.
  const isFirst = d.f.discountScope === "first_payment";
  const monthly = d.f.discountValue ? (isFirst ? MONTHLY : 750) : MONTHLY;
  // Split portions always sum to the RECURRING price; the once-off comes off portion 1 after.
  const split = sp.v ? sp.v.map((p, i) => ({ ...p, amount: money(p.amount * (monthly / MONTHLY)) })) : undefined;
  const p = mk({ totalAmount: monthly, firstPaymentSplit: split, ...d.f });
  const name = `${d.label} / ${sp.label}`;

  const rows = managementSchedule(p)!;
  const scheduleSum = money(rows.reduce((s, r) => s + r.amount, 0));
  const headline = fullTermTotal(p);
  const oneOff = firstPaymentDiscount(p);

  // 1. THE CORE INVARIANT: the schedule the client reads must add up to the headline they agreed.
  check(`${name}: schedule sums to headline`, scheduleSum === headline, `${fmt(scheduleSum)} vs ${fmt(headline)}`);

  // 2. Stripe is told: recurring price `monthly`, charged 3x, minus a once-coupon of `oneOff`.
  //    That must land on the same number. This is the line that would have caught the $2,250 bug.
  const stripeCollects = money(monthly * 3 - oneOff);
  check(`${name}: Stripe total == headline`, stripeCollects === headline, `${fmt(stripeCollects)} vs ${fmt(headline)}`);

  // 3. A once-off discount comes off the FIRST ROW ONLY (the first PORTION when split).
  if (oneOff > 0) {
    const expectedFirst = money((split ? split[0].amount : monthly) - oneOff);
    check(`${name}: row 0 discounted`, rows[0].amount === expectedFirst, `${fmt(rows[0].amount)} vs ${fmt(expectedFirst)}`);
    for (let i = 1; i < rows.length; i++) {
      const expected = split && i < split.length ? split[i].amount : monthly;
      check(`${name}: row ${i} at full price`, rows[i].amount === expected, `${fmt(rows[i].amount)} vs ${fmt(expected)}`);
    }
    // The saving is once, not once per month — the whole point of the scope.
    check(`${name}: saves exactly 250`, oneOff === 250, String(oneOff));
    check(`${name}: headline is 2750`, headline === 2750, fmt(headline));
  }

  // 4. A recurring discount is inside the monthly price, so it repeats: 750 x 3 = 2250.
  if (d.f.discountValue && !isFirst) {
    check(`${name}: recurring headline is 2250`, headline === 2250, fmt(headline));
    check(`${name}: no once-off applied`, oneOff === 0, String(oneOff));
  }

  // 5. Client-facing figures are TERM-level and must reconcile with the headline, or the page
  //    shows a struck-through price that disagrees with the total underneath it.
  const info = discountInfo(p);
  if (d.f.discountValue) {
    check(`${name}: discountInfo present`, !!info);
    if (info) {
      check(`${name}: info.billed == headline`, info.billed === headline, `${fmt(info.billed)} vs ${fmt(headline)}`);
      check(`${name}: list - saved == billed`, money(info.listAmount - info.saved) === info.billed,
        `${fmt(info.listAmount)} - ${fmt(info.saved)} != ${fmt(info.billed)}`);
      check(`${name}: saved is 750 or 250`, info.saved === (isFirst ? 250 : 750), fmt(info.saved));
      check(`${name}: sentence exists`, !!discountSentence(p, fmt));
    }
  } else {
    check(`${name}: no discount -> null`, info === null);
    check(`${name}: no discount -> no sentence`, discountSentence(p, fmt) === null);
    check(`${name}: undiscounted headline 3000`, headline === 3000, fmt(headline));
  }
}

// ── Edge cases that would each produce a wrong charge ────────────────────────────────────────
// A percent discount on a split must still come off the first PORTION, not the monthly figure.
{
  const p = mk({
    totalAmount: MONTHLY, discountScope: "first_payment", discountType: "percent", discountValue: 25,
    listAmount: MONTHLY, firstPaymentSplit: [{ amount: 600, offsetDays: 0 }, { amount: 400, offsetDays: 14 }],
  });
  const rows = managementSchedule(p)!;
  check("percent split: portion 1 is 350", rows[0].amount === 350, fmt(rows[0].amount));
  check("percent split: portion 2 untouched", rows[1].amount === 400, fmt(rows[1].amount));
}
// A discount larger than the payment must clamp to it, never go negative (Stripe would reject).
{
  const p = mk({ totalAmount: MONTHLY, discountScope: "first_payment", discountType: "fixed", discountValue: 5000, listAmount: MONTHLY });
  check("over-discount clamps to the payment", firstPaymentDiscount(p) === MONTHLY, String(firstPaymentDiscount(p)));
  check("over-discount never negative", managementSchedule(p)![0].amount >= 0);
}
// Upfront: one charge of 3 months. The scope still changes the money, so it must still apply.
{
  const p = mk({ managementOption: "upfront", totalAmount: MONTHLY, discountScope: "first_payment", discountType: "fixed", discountValue: 250, listAmount: MONTHLY });
  check("upfront first_payment total is 2750", fullTermTotal(p) === 2750, fmt(fullTermTotal(p)));
}
// A project is a single payment: scope "total" behaves like the old baked-in discount.
{
  const p = mk({ type: "project", paymentStructure: "single", managementOption: null, totalAmount: 750, listAmount: 1000, discountType: "fixed", discountValue: 250, discountScope: "total" });
  check("project total is 750", fullTermTotal(p) === 750, fmt(fullTermTotal(p)));
  check("project has no once-off", firstPaymentDiscount(p) === 0);
  check("project shows 250 saved", discountInfo(p)?.saved === 250, String(discountInfo(p)?.saved));
}

console.log(`\n  ${cases - fails}/${cases} assertions passed`);
if (fails) { console.log(`  ${fails} FAILED\n`); process.exit(1); }
console.log("  ALL GREEN\n");
