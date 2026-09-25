/**
 * TEST-MODE proof that runs THE ACTUAL ENGINE, not a copy of it.
 *
 * The earlier proof (prove-auto-collect.mjs) re-implemented the logic inline, so it proved
 * Stripe's behaviour rather than ours. This one seeds real rows, calls the real
 * `issueNextInstalmentInvoice`, and asserts on what it returns and what it writes.
 *
 * SAFETY: refuses to run unless STRIPE_SECRET_KEY has been forced to a TEST key, which it does
 * itself below before any application module is imported. Every row it creates is prefixed
 * ZZTEST and deleted in a finally block.
 *
 * Run: node_modules/.bin/tsx --env-file=.env.verify scripts/stripe-test/prove-engine-real.ts
 */
import { readFileSync } from "fs";

// Point the app's Stripe client at TEST mode before anything imports it.
const testKey = (() => {
  const m = readFileSync(".env.verify", "utf8").match(/^STRIPE_TEST_SECRET_KEY=(.*)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
})();
if (!testKey.startsWith("sk_test_")) {
  console.error("REFUSING: no sk_test_ key available. This must never run against live Stripe.");
  process.exit(1);
}
process.env.STRIPE_SECRET_KEY = testKey;

(async () => {
  const { db } = await import("@/lib/db");
  const { proposals, proposalInstalments } = await import("@/lib/db/schema");
  const { issueNextInstalmentInvoice, authoriseFutureCharges } = await import("@/lib/proposals/instalment-billing");
  const { stripe } = await import("@/lib/stripe/client");
  const { eq, like } = await import("drizzle-orm");

  const pass: string[] = [], fail: string[] = [];
  const ok = (n: string, c: boolean, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };
  const DAY = 86_400_000;
  const TAG = "ZZTEST-ENGINE";

  async function seed(opts: {
    name: string; withCard: boolean; structure?: string;
    subId?: string | null; lost?: boolean; statuses: string[]; dueOffsets: number[];
  }) {
    const cus = await stripe().customers.create({ name: `${TAG} ${opts.name}`, email: `zztest-${Date.now()}@example.com` });
    if (opts.withCard) {
      const pm = await stripe().paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
      await stripe().paymentMethods.attach(pm.id, { customer: cus.id });
      await stripe().customers.update(cus.id, { invoice_settings: { default_payment_method: pm.id } });
    }
    const [p] = await db().insert(proposals).values({
      token: `${TAG}-${Math.random().toString(36).slice(2, 10)}`,
      title: `${TAG} ${opts.name}`, contactName: `${TAG} ${opts.name}`,
      type: "project", status: "partial", totalAmount: 1500, currency: "usd",
      ghlContactId: `${TAG}-contact`,
      paymentStructure: opts.structure ?? "instalment",
      stripeCustomerId: cus.id, stripeSubscriptionId: opts.subId ?? null,
      signedAt: new Date(), sentAt: new Date(),
      ...(opts.lost ? { lostAt: new Date(), status: "lost" } : {}),
    }).returning();
    for (const [i, st] of opts.statuses.entries()) {
      await db().insert(proposalInstalments).values({
        proposalId: p.id, instalmentNumber: i + 1, amount: 500, isDeposit: false,
        status: st, ...(st === "paid" ? { paidAt: new Date(Date.now() - 30 * DAY) } : {}),
        // A settled row needs an invoice id for realism; an unbilled one must not have one.
        ...(st === "paid" ? { stripeInvoiceId: `in_${TAG}_${i}` } : {}),
        dueDate: new Date(Date.now() + opts.dueOffsets[i] * DAY),
      });
    }
    return p.id;
  }

  try {
    console.log("=== The real engine, against seeded rows ===\n");

    // 1. The happy path: a paying client with a card, one instalment left.
    const happy = await seed({ name: "Happy", withCard: true, statuses: ["paid", "pending"], dueOffsets: [-30, 20] });
    const r1 = await issueNextInstalmentInvoice(happy);
    ok("raises the next instalment for a paying client", r1 !== null, r1 ? `#${r1.instalmentNumber}` : "null");
    ok("chooses automatic collection when a card is on file", r1?.autoCharge === true);
    const [row1] = await db().select().from(proposalInstalments).where(eq(proposalInstalments.proposalId, happy));
    const rows1 = await db().select().from(proposalInstalments).where(eq(proposalInstalments.proposalId, happy));
    ok("writes the invoice id to the row", rows1.some((r) => r.instalmentNumber === 2 && !!r.stripeInvoiceId));
    ok("the invoice amount comes from the row, not a constant", (await stripe().invoices.retrieve(r1!.invoiceId)).total === 50000,
       `$${(await stripe().invoices.retrieve(r1!.invoiceId)).total / 100}`);
    void row1;

    // 2. Running it again must not raise a second invoice.
    const r1b = await issueNextInstalmentInvoice(happy);
    ok("a second run raises nothing (one live invoice at a time)", r1b === null);

    // 3. A deal on a subscription must never be touched.
    const sub = await seed({ name: "OnSub", withCard: true, subId: "sub_ZZTEST", statuses: ["paid", "pending"], dueOffsets: [-30, 20] });
    ok("refuses a proposal that has a subscription", (await issueNextInstalmentInvoice(sub)) === null);

    // 4. superseded_by_subscription must count as settled, never as billable.
    const sup = await seed({ name: "Superseded", withCard: true, statuses: ["paid", "superseded_by_subscription"], dueOffsets: [-30, 20] });
    ok("treats superseded_by_subscription as settled, raises nothing", (await issueNextInstalmentInvoice(sup)) === null);

    // 5. A lost deal must never be billed.
    const lost = await seed({ name: "Lost", withCard: true, lost: true, statuses: ["paid", "pending"], dueOffsets: [-30, 20] });
    ok("refuses a lost proposal", (await issueNextInstalmentInvoice(lost)) === null);

    // 6. An unpaid instalment that already has an invoice blocks the next one.
    const blocked = await seed({ name: "Blocked", withCard: true, statuses: ["paid", "failed", "pending"], dueOffsets: [-60, -30, 10] });
    await db().update(proposalInstalments).set({ stripeInvoiceId: "in_ZZTEST_failed" })
      .where(eq(proposalInstalments.proposalId, blocked));
    ok("a failed instalment blocks the next, never skipped", (await issueNextInstalmentInvoice(blocked)) === null);

    // 7. Nothing left to bill: the engine stops.
    const done = await seed({ name: "Done", withCard: true, statuses: ["paid", "paid"], dueOffsets: [-60, -30] });
    ok("STOPS when every instalment is settled", (await issueNextInstalmentInvoice(done)) === null);

    // 8. No card on file: falls back to an invoice rather than skipping the client.
    const nocard = await seed({ name: "NoCard", withCard: false, statuses: ["paid", "pending"], dueOffsets: [-30, 20] });
    const r8 = await issueNextInstalmentInvoice(nocard);
    ok("bills a client with no card by invoice", r8 !== null && r8.autoCharge === false, r8 ? "send_invoice" : "null");

    // 9. THE DOUBLE-CHARGE GUARD. Simulate the crash: Stripe has the invoice, the row does not.
    const crashed = await seed({ name: "Crashed", withCard: true, statuses: ["paid", "pending"], dueOffsets: [-30, 20] });
    const r9 = await issueNextInstalmentInvoice(crashed);
    const beforeCount = (await stripe().invoices.list({ customer: (await db().select().from(proposals).where(eq(proposals.id, crashed)))[0].stripeCustomerId!, limit: 20 })).data.length;
    await db().update(proposalInstalments).set({ stripeInvoiceId: null })
      .where(eq(proposalInstalments.proposalId, crashed));      // the write that never landed
    const r9b = await issueNextInstalmentInvoice(crashed);
    const custId = (await db().select().from(proposals).where(eq(proposals.id, crashed)))[0].stripeCustomerId!;
    const afterCount = (await stripe().invoices.list({ customer: custId, limit: 20 })).data.length;
    ok("after a lost DB write, it finds the existing invoice instead of charging again",
       afterCount === beforeCount && r9b === null, `invoices ${beforeCount} -> ${afterCount}`);
    const healed = (await db().select().from(proposalInstalments).where(eq(proposalInstalments.proposalId, crashed)))
      .find((r) => r.instalmentNumber === 2);
    ok("and heals the row so billing can continue", healed?.stripeInvoiceId === r9?.invoiceId);

    // 10. An overdue instalment still gets notice before the card is debited.
    const late = await seed({ name: "Late", withCard: true, statuses: ["paid", "pending"], dueOffsets: [-60, -25] });
    const r10 = await issueNextInstalmentInvoice(late);
    const gapDays = r10 ? (r10.sendsOn.getTime() - Date.now()) / DAY : -1;
    ok("an overdue instalment is NOT debited on the spot", gapDays > 2, `charges in ${gapDays.toFixed(1)} days`);
    const inv10 = await stripe().invoices.retrieve(r10!.invoiceId);
    ok("and it is still a draft right now", inv10.status === "draft", `status=${inv10.status}`);

    // 11. THE DETERMINISTIC ONE: no card, and already overdue. Stripe rejects a past due_date,
  //     so before the floor was applied this threw on every attempt and collected nothing.
  const lateNoCard = await seed({ name: "LateNoCard", withCard: false, statuses: ["paid", "pending"], dueOffsets: [-60, -25] });
  let threw = false;
  const r11 = await issueNextInstalmentInvoice(lateNoCard).catch(() => { threw = true; return null; });
  ok("overdue + no card: bills instead of throwing", !threw && r11 !== null, threw ? "THREW" : `#${r11?.instalmentNumber}`);
  ok("and the invoice it raised is a send_invoice", r11?.autoCharge === false);

  // 12. A cancelled instalment is terminal: the engine must not resurrect it.
  const cancelled = await seed({ name: "Cancelled", withCard: true, statuses: ["paid", "cancelled", "pending"], dueOffsets: [-60, -30, 20] });
  const r12 = await issueNextInstalmentInvoice(cancelled);
  ok("a cancelled instalment is never re-billed", r12 === null || r12.instalmentNumber === 3,
     r12 ? `raised #${r12.instalmentNumber}` : "raised nothing");

  // 13. The heal must refuse a $0 invoice carrying the right row id.
  const zeroRow = await seed({ name: "ZeroHeal", withCard: true, statuses: ["paid", "pending"], dueOffsets: [-30, 20] });
  const zrows = await db().select().from(proposalInstalments).where(eq(proposalInstalments.proposalId, zeroRow));
  const target = zrows.find((r) => r.instalmentNumber === 2)!;
  const custZ = (await db().select().from(proposals).where(eq(proposals.id, zeroRow)))[0].stripeCustomerId!;
  const empty = await stripe().invoices.create({ customer: custZ, collection_method: "send_invoice",
    due_date: Math.floor((Date.now() + 20 * DAY) / 1000), metadata: { instalment_row: target.id } });
  await stripe().invoices.finalizeInvoice(empty.id, { auto_advance: false });
  const r13 = await issueNextInstalmentInvoice(zeroRow);
  ok("a $0 invoice is not mistaken for this instalment", r13 !== null && r13.invoiceId !== empty.id,
     r13 ? "raised a real one" : "wrongly healed to the empty invoice");

  // 14-16. REGISTERING THE CARD FOR FUTURE CHARGES (Jack's Option 1, 2026-09-24).
  console.log("\n=== Registering the card for the rest of the plan ===");

  // A normal card: agreed silently, client does nothing.
  const mandate = await seed({ name: "Mandate", withCard: true, statuses: ["pending", "pending"], dueOffsets: [-1, 29] });
  const mCust = (await db().select().from(proposals).where(eq(proposals.id, mandate)))[0].stripeCustomerId!;
  const mInv = await stripe().invoices.create({ customer: mCust, collection_method: "charge_automatically",
    metadata: { instalment_number: "1" } });
  await stripe().invoiceItems.create({ customer: mCust, invoice: mInv.id, amount: 50000, currency: "usd", description: "Instalment 1 of 2" });
  await stripe().invoices.finalizeInvoice(mInv.id, { auto_advance: true });
  const res14 = await authoriseFutureCharges(mandate, mInv.id);
  ok("an ordinary card is registered silently", res14 === "authorised", res14);
  const stored = (await db().select().from(proposals).where(eq(proposals.id, mandate)))[0];
  ok("the card is recorded against the deal", !!stored.stripePaymentMethodId);
  const cust14: any = await stripe().customers.retrieve(mCust);
  ok("and set as the card future invoices will charge", !!cust14.invoice_settings?.default_payment_method);

  // Running again must not pester the client a second time.
  const res15 = await authoriseFutureCharges(mandate, mInv.id);
  ok("a second payment does not ask again", res15 === "already-authorised", res15);

  // A card whose bank demands the cardholder: recorded, not chased, and never throws.
  const auth = await seed({ name: "NeedsAuth", withCard: false, statuses: ["pending", "pending"], dueOffsets: [-1, 29] });
  const aCust = (await db().select().from(proposals).where(eq(proposals.id, auth)))[0].stripeCustomerId!;
  const authPm = await stripe().paymentMethods.create({ type: "card", card: { token: "tok_authenticationRequiredOnSetup" } });
  await stripe().paymentMethods.attach(authPm.id, { customer: aCust });
  const aInv = await stripe().invoices.create({ customer: aCust, collection_method: "send_invoice",
    due_date: Math.floor((Date.now() + 20 * DAY) / 1000), metadata: { instalment_number: "1" } });
  const res16 = await authoriseFutureCharges(auth, aInv.id);
  ok("a bank that wants the cardholder is handled, not crashed", res16 === "needs-the-client" || res16 === "authorised", res16);
  ok("and nothing was stored as authorised when it was not",
     res16 !== "needs-the-client" || !(await db().select().from(proposals).where(eq(proposals.id, auth)))[0].stripePaymentMethodId);

  console.log(`\n=== RESULT: ${pass.length} passed, ${fail.length} failed ===`);
    if (fail.length) console.log("FAILED:", fail.join(" | "));
  } finally {
    const ids = await db().select({ id: proposals.id }).from(proposals).where(like(proposals.token, `${TAG}%`));
    for (const { id } of ids) await db().delete(proposalInstalments).where(eq(proposalInstalments.proposalId, id));
    const del = await db().delete(proposals).where(like(proposals.token, `${TAG}%`)).returning({ id: proposals.id });
    console.log(`\ncleaned up ${del.length} test proposals`);
  }

})();
