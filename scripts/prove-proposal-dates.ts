import { managementSchedule, termWindow, clientSentence, billingAnchor, fmtDay, type BillingTerms } from "../lib/proposals/billing";

const mk = (o: Partial<BillingTerms>): BillingTerms => ({
  type: "management", paymentStructure: "subscription", totalAmount: 1500, currency: "usd",
  billingInterval: "month", billingIntervalCount: 1, autoRenew: true,
  managementOption: "spread", autoRebillMode: "none", ...o,
} as BillingTerms);

let fails = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (!cond) { fails++; console.log(`  FAIL  ${name} ${detail}`); }
};

// Every stored-time convention seen in the DB, plus hostile ones.
const stamps = ["T00:00:00.000Z", "T05:00:00.000Z", "T12:00:00.000Z", "T23:00:00.000Z"];
// Start days chosen to cross month-length boundaries, DST and a leap year.
const days = ["2026-01-31", "2026-02-27", "2026-03-08", "2026-08-10", "2026-10-31", "2026-11-01", "2026-12-31", "2028-02-28"];
const splits: (undefined | Array<{amount:number;offsetDays?:number}>)[] = [
  undefined,
  [{ amount: 750, offsetDays: 0 }, { amount: 750, offsetDays: 14 }],
  [{ amount: 500, offsetDays: 0 }, { amount: 500, offsetDays: 7 }, { amount: 500, offsetDays: 21 }],
  [{ amount: 750, offsetDays: 0 }, { amount: 750, offsetDays: 3 }],
];

const parse = (s: string) => new Date(s + " UTC");
let cases = 0;

for (const day of days) for (const stamp of stamps) for (const split of splits) {
  const p = mk({ startDate: new Date(day + stamp), firstPaymentSplit: split });
  const rows = managementSchedule(p)!;
  const dates = rows.map(r => parse(r.when));
  cases++;

  // 1. Row 1 must equal the anchor day exactly (the 10-vs-11-Aug bug).
  check(`${day}${stamp} row1==anchor`, rows[0].when === fmtDay(billingAnchor(p)), `got ${rows[0].when} vs ${fmtDay(billingAnchor(p))}`);

  // 2. The monthly payments must be exactly 30 days apart from one another.
  const monthlyStart = split ? split.length - 1 : 0; // last split portion onward
  for (let i = monthlyStart + 1; i < dates.length; i++) {
    const gap = Math.round((+dates[i] - +dates[i-1]) / 86400000);
    check(`${day}${stamp} split=${split?.length ?? 0} gap[${i}]`, gap === 30, `= ${gap}d`);
  }

  // 3. Dates must be strictly increasing.
  for (let i = 1; i < dates.length; i++) check(`${day}${stamp} monotonic[${i}]`, +dates[i] > +dates[i-1]);

  // 4. The sentence must quote the same start day as row 1.
  const sentence = clientSentence(p);
  check(`${day}${stamp} sentence==row1`, sentence.includes(rows[0].when), `sentence lacks ${rows[0].when}`);

  // 5. The term window must start on the anchor and end on/after the final payment.
  const w = termWindow(p)!;
  check(`${day}${stamp} window start`, fmtDay(w.start) === rows[0].when);
  check(`${day}${stamp} window end`, +w.end >= +dates[dates.length-1]);
}

// 6. contractStartAt must win everywhere at once, never in only one place.
const withContract = mk({ startDate: new Date("2026-08-10T12:00:00Z"), contractStartAt: new Date("2026-08-11T12:00:00Z") });
const r2 = managementSchedule(withContract)!;
check("contractStartAt drives row1", r2[0].when === "11 Aug 2026", `got ${r2[0].when}`);
check("contractStartAt drives sentence", clientSentence(withContract).includes("11 Aug 2026"));
check("contractStartAt drives window", fmtDay(termWindow(withContract)!.start) === "11 Aug 2026");

// 7. A frozen snapshot must win over recomputation, unchanged, on every surface.
const snapshot = [
  { label: "Payment 1 of 3", when: "11 Aug 2026", amount: 1500 }, // the OLD buggy output
  { label: "Payment 2 of 3", when: "9 Sep 2026", amount: 1500 },
  { label: "Payment 3 of 3", when: "9 Oct 2026", amount: 1500 },
];
const frozen = mk({ startDate: new Date("2026-08-10T05:00:00Z"), scheduleSnapshot: snapshot });
check("snapshot renders verbatim", JSON.stringify(managementSchedule(frozen)) === JSON.stringify(snapshot),
  `got ${JSON.stringify(managementSchedule(frozen))}`);
// And a proposal with NO snapshot must still compute the corrected dates.
const fresh = mk({ startDate: new Date("2026-08-10T05:00:00Z") });
check("no snapshot => corrected", managementSchedule(fresh)![0].when === "10 Aug 2026",
  `got ${managementSchedule(fresh)![0].when}`);
// An empty array must not be mistaken for a freeze.
const emptySnap = mk({ startDate: new Date("2026-08-10T05:00:00Z"), scheduleSnapshot: [] });
check("empty snapshot => computes", managementSchedule(emptySnap)![0].when === "10 Aug 2026");

// 8. A snapshot must NOT survive once money has moved. The re-freeze at first payment calls
// managementSchedule() to build corrected rows; if the snapshot short-circuited unconditionally
// it would hand back the OLD rows and write them straight back, making the freeze a no-op.
const staleSnap = [
  { label: "Payment 1 of 3", when: "7 Aug 2026", amount: 1500 },   // estimated off startDate
  { label: "Payment 2 of 3", when: "5 Sep 2026", amount: 1500 },
  { label: "Payment 3 of 3", when: "5 Oct 2026", amount: 1500 },
];
// Pre-payment: no contractStartAt, so the client keeps seeing exactly what they were sent.
const preSigned = mk({ startDate: new Date("2026-08-06T12:00:00Z"), scheduleSnapshot: staleSnap });
check("pre-payment: snapshot still wins", JSON.stringify(managementSchedule(preSigned)) === JSON.stringify(staleSnap));
// Post-payment: contractStartAt is the truth, so the stale snapshot must be overridden.
const paidLate = mk({
  startDate: new Date("2026-08-06T12:00:00Z"),
  contractStartAt: new Date("2026-08-20T12:00:00Z"),
  scheduleSnapshot: staleSnap,
});
const recomputed = managementSchedule(paidLate)!;
check("post-payment: stale snapshot is OVERRIDDEN by the real anchor", recomputed[0].when === "20 Aug 2026", `got ${recomputed[0].when}`);
check("post-payment: later rows chain 30 days off the real anchor", recomputed[1].when === "19 Sep 2026", `got ${recomputed[1].when}`);

console.log(`\n${cases} schedule permutations + 3 anchor checks + 3 snapshot checks + 3 stale-snapshot checks. FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
