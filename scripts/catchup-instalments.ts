/**
 * Catch up the instalments that were never billed while the automation was switched off.
 *
 * DRY RUN BY DEFAULT. It prints exactly what it would do and touches nothing. Pass --commit to
 * act, and --only "<client name>" to do a single client first.
 *
 * DATE RULE, Jack 2026-09-24: instalments fall 30 days after the previous payment. Applied to
 * these existing clients it is clamped to the LATER of the agreed date and the recalculated one,
 * so nobody is ever charged earlier than the schedule they were shown. Without that clamp
 * Olive & Piper would move from 16 October to 16 September, pulling $5,125 forward a month.
 *
 * Run:  node_modules/.bin/tsx --env-file=.env.verify scripts/catchup-instalments.ts
 *       ... --only "Roots Apothecary" --commit
 */
import { and, asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { issueNextInstalmentInvoice } from "@/lib/proposals/instalment-billing";

const COMMIT = process.argv.includes("--commit");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;
const DAY = 86_400_000;

(async () => {
  const stuck = await db().execute<{ id: string; contact_name: string }>(sql`
    SELECT p.id, p.contact_name
      FROM proposals p JOIN proposal_instalments i ON i.proposal_id = p.id AND NOT i.is_deposit
     WHERE p.lost_at IS NULL AND p.stripe_subscription_id IS NULL
     GROUP BY p.id, p.contact_name
    HAVING count(*) FILTER (WHERE i.status = 'paid') > 0
       AND count(*) FILTER (WHERE i.status <> 'paid' AND i.stripe_invoice_id IS NULL) > 0
     ORDER BY p.contact_name`);

  const targets = stuck.rows.filter((r) => !ONLY || r.contact_name === ONLY);
  if (ONLY && targets.length === 0) {
    console.error(`No stuck proposal named "${ONLY}". Known: ${stuck.rows.map((r) => r.contact_name).join(", ")}`);
    process.exit(1);
  }

  console.log(COMMIT ? "=== COMMIT: this WILL create real Stripe invoices ===" : "=== DRY RUN: nothing will be touched ===");
  console.log(`${targets.length} client(s)\n`);

  for (const t of targets) {
    const rows = await db().select().from(proposalInstalments)
      .where(and(eq(proposalInstalments.proposalId, t.id), eq(proposalInstalments.isDeposit, false)))
      .orderBy(asc(proposalInstalments.instalmentNumber));

    const paid = rows.filter((r) => r.status === "paid");
    const lastPaid = paid.reduce<Date | null>((a, r) => (r.paidAt && (!a || r.paidAt > a) ? r.paidAt : a), null);
    if (!lastPaid) { console.log(`${t.contact_name}: no paid instalment, skipped`); continue; }

    const unbilled = rows.filter((r) => r.status !== "paid" && !r.stripeInvoiceId);
    console.log(`${t.contact_name}  (last paid ${lastPaid.toISOString().slice(0, 10)})`);

    for (const [idx, r] of unbilled.entries()) {
      const agreed = new Date(r.dueDate);
      const raw = new Date(lastPaid.getTime() + (idx + 1) * 30 * DAY);
      // Compare by DAY, and keep the agreed time of day. The recalculated timestamp inherits
      // the minute the client happened to pay, and writing that back would silently shift an
      // agreed due date by a few hours for no reason, which then shows up as a "changed" date
      // in any audit of what the client was promised.
      const recalculated = new Date(agreed);
      recalculated.setUTCFullYear(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate());
      const dayOf = (d: Date) => d.toISOString().slice(0, 10);
      // THE AGREED DATE WINS, unless it is impossible.
      //
      // The 30-day rule exists for dates our own failure made nonsense: an instalment dated
      // before the client had even signed, or one already in the past. It was never meant to
      // PUSH a perfectly good future date later. Applied bluntly it delayed Gymkhana from the
      // 10th to the 21st of October simply because they paid their previous instalment late,
      // which is 11 days of contract nobody asked for. Jack, 2026-09-24: "I don't want them or
      // us feeling responsible for an extra amount of days."
      //
      // So: honour the agreed date. Recalculate only when it has already passed, or when it
      // falls before the payment it is supposed to follow.
      const agreedIsUsable =
        dayOf(agreed) > dayOf(new Date()) && agreed.getTime() > lastPaid.getTime();
      const chosen = agreedIsUsable ? agreed : recalculated;
      const moved = dayOf(chosen) !== dayOf(agreed);
      // Exactly when the card would be debited, computed the same way the engine computes it:
      // on the due date, unless that date has passed, in which case a 3-day notice floor.
      const NOTICE_MS = 3 * 86_400_000;
      const chargeAt = new Date(Math.max(chosen.getTime(), Date.now() + NOTICE_MS));
      const onDueDate = chargeAt.toISOString().slice(0, 10) === chosen.toISOString().slice(0, 10);
      console.log(
        `   #${r.instalmentNumber}  $${String(r.amount).padEnd(5)}` +
        ` due ${chosen.toISOString().slice(0, 10)}` +
        `${moved ? " (moved later)" : "             "}` +
        `  ->  CHARGES ${chargeAt.toISOString().slice(0, 10)}` +
        `${onDueDate ? "  exactly on the due date" : "  ** NOT on the due date, its date has passed **"}`,
      );
      if (COMMIT && moved) {
        await db().update(proposalInstalments).set({ dueDate: chosen })
          .where(eq(proposalInstalments.id, r.id));
      }
    }

    if (COMMIT) {
      // One invoice per client per run, by design: the engine raises only the next outstanding
      // instalment. The rest follow automatically as each is paid.
      const res = await issueNextInstalmentInvoice(t.id).catch((e) => {
        console.log(`   FAILED: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (res) {
        console.log(`   RAISED instalment ${res.instalmentNumber}: ${res.invoiceId}` +
          `  ${res.autoCharge ? "charging the card on file" : "emailing an invoice"}` +
          `  ${res.sendsOn <= new Date() ? "now" : "on " + res.sendsOn.toISOString().slice(0, 10)}`);
      } else {
        console.log(`   nothing raised (already has a live invoice, or nothing left to bill)`);
      }
    }
    console.log();
  }

  if (!COMMIT) console.log("Dry run only. Re-run with --commit to act.");

})();
