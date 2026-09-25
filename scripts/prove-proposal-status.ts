import { deriveProposalStatus, type StatusInputs } from "../lib/proposals/status";

let fails = 0;
const check = (name: string, got: string, want: string) => {
  if (got !== want) { fails++; console.log(`  FAIL  ${name}: got "${got}", want "${want}"`); }
  else console.log(`  PASS  ${name.padEnd(62)} -> ${got}`);
};
const spread = (o: Partial<StatusInputs>): StatusInputs => ({
  status: "signed", type: "management", managementOption: "spread",
  firstMonthComplete: false, paidAt: null, subscriptionStatus: "active",
  collected: 0, expected: 3, amountCollected: 0, amountExpected: 4500, ...o,
});

console.log("\n=== spread lifecycle ===");
check("signed, no money", deriveProposalStatus(spread({})).status, "signed");
check("split portion 1 paid, first month incomplete", deriveProposalStatus(spread({ paidAt: new Date(), collected: 1, expected: 4, firstMonthComplete: false })).status, "partial");
check("first month collected -> active", deriveProposalStatus(spread({ paidAt: new Date(), firstMonthComplete: true, collected: 1 })).status, "active");
check("2 of 3 -> still active", deriveProposalStatus(spread({ paidAt: new Date(), firstMonthComplete: true, collected: 2 })).status, "active");
check("3 of 3 but sub still active (upsold) -> ACTIVE", deriveProposalStatus(spread({ paidAt: new Date(), firstMonthComplete: true, collected: 3, subscriptionStatus: "active" })).status, "active");
check("3 of 3 and sub canceled -> completed", deriveProposalStatus(spread({ paidAt: new Date(), firstMonthComplete: true, collected: 3, subscriptionStatus: "canceled" })).status, "completed");
check("card declined -> past_due", deriveProposalStatus(spread({ paidAt: new Date(), firstMonthComplete: true, collected: 1, subscriptionStatus: "past_due" })).status, "past_due");

console.log("\n=== safety: never silently 'completed' ===");
check("mirror gap (null sub), 3 of 3 -> active not completed", deriveProposalStatus(spread({ paidAt: new Date(), firstMonthComplete: true, collected: 3, subscriptionStatus: null })).status, "active");
check("canceled sub but only 2 of 3 -> active", deriveProposalStatus(spread({ paidAt: new Date(), firstMonthComplete: true, collected: 2, subscriptionStatus: "canceled" })).status, "active");

console.log("\n=== human decisions and pre-sale are never overwritten ===");
for (const s of ["draft", "sent", "lost", "void", "cancelled", "expired"]) {
  check(`${s} passes through`, deriveProposalStatus(spread({ status: s, paidAt: new Date(), firstMonthComplete: true, collected: 3 })).status, s);
}

console.log("\n=== non-spread proposals are NEVER re-classified ===");
const passthrough: [string, Partial<StatusInputs>][] = [
  ["project instalment partial", { type: "project", managementOption: null, status: "partial" }],
  ["project paid", { type: "project", managementOption: null, status: "paid" }],
  ["upfront management paid", { type: "management", managementOption: "upfront", status: "paid" }],
  ["legacy retainer", { type: "management", managementOption: null, status: "partial" }],
];
for (const [name, o] of passthrough) {
  const r = deriveProposalStatus(spread({ ...o, paidAt: new Date(), firstMonthComplete: true, collected: 3, subscriptionStatus: "canceled" }));
  check(name, r.status, String(o.status));
  if (r.derived) { fails++; console.log(`  FAIL  ${name} was marked derived`); }
}

console.log("\n=== progress label ===");
const p = deriveProposalStatus(spread({ paidAt: new Date(), firstMonthComplete: true, collected: 2, amountCollected: 3000, amountExpected: 4500 })).progress!;
check("label", p.label, "2 of 3 · $3,000 of $4,500");
const noMoney = deriveProposalStatus(spread({ paidAt: new Date(), firstMonthComplete: true, collected: 2, amountCollected: undefined, amountExpected: undefined })).progress!;
check("label without amounts", noMoney.label, "2 of 3");
const over = deriveProposalStatus(spread({ paidAt: new Date(), firstMonthComplete: true, collected: 4, expected: 3 })).progress!;
check("never shows 4 of 3", over.label.split(" · ")[0], "4 of 4");

console.log(`\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
