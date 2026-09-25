import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { issueNextInstalmentInvoice } from "@/lib/proposals/instalment-billing";
import { postToSalesChannel } from "@/lib/proposals/slack-notify";
import { acquireJobLock, releaseJobLock } from "@/lib/jobs/lock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOCK_KEY = "instalment-sweep";

/**
 * GET /api/cron/instalment-sweep
 *
 * The safety net under automatic instalment collection.
 *
 * WHY IT EXISTS
 * Collection is driven by a Stripe webhook: a client pays, we raise the next invoice. Every
 * link in that chain can break quietly. The webhook can fail to arrive, the raise can throw,
 * an invoice can be voided, a payment can be marked by hand somewhere that forgets to advance
 * the plan. Each of those leaves a paying client with an unbilled balance and NOBODY IS TOLD.
 *
 * That is not hypothetical. The call that raises the next invoice sat commented out for six
 * weeks and nine clients accumulated $20,975 that was never billed. The thing missing was not
 * the feature, it was anything that would notice.
 *
 * So once a day this asks the only question that matters: is there a paying client with money
 * owed and no invoice against it? If so it raises the invoice, and if it cannot, it says so
 * out loud in Slack rather than into a log nobody reads.
 *
 * It is safe to run repeatedly: the engine refuses any client who already has a live invoice,
 * and checks Stripe before creating anything.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await acquireJobLock(LOCK_KEY, 600))) {
    return NextResponse.json({ status: "refused", reason: "already running" });
  }

  const raised: string[] = [];
  const failed: string[] = [];

  try {
    // A paying client with an unpaid, unbilled instalment. Subscriptions excluded: they
    // collect their own money. Lost and void deals excluded: they are not owed.
    const stuck = await db().execute<{ id: string; contact_name: string; owed: string }>(sql`
      SELECT p.id, p.contact_name, sum(i.amount) FILTER (
               WHERE i.status NOT IN ('paid','superseded_by_subscription') AND i.stripe_invoice_id IS NULL
             )::text AS owed
        FROM proposals p
        JOIN proposal_instalments i ON i.proposal_id = p.id AND NOT i.is_deposit
       WHERE p.lost_at IS NULL
         AND p.status NOT IN ('lost','void')
         AND p.stripe_subscription_id IS NULL
         AND p.payment_structure = 'instalment'
       GROUP BY p.id, p.contact_name
      HAVING count(*) FILTER (WHERE i.status = 'paid') > 0
         AND count(*) FILTER (WHERE i.status NOT IN ('paid','superseded_by_subscription')
                                AND i.stripe_invoice_id IS NULL) > 0`);

    for (const row of stuck.rows) {
      try {
        const res = await issueNextInstalmentInvoice(row.id);
        if (res) raised.push(`${row.contact_name} #${res.instalmentNumber}`);
      } catch (e) {
        failed.push(`${row.contact_name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Only ever speaks when there is something to say. A daily "all fine" message trains
    // everyone to ignore the channel, which is how the original six weeks of silence worked.
    if (failed.length) {
      await postToSalesChannel(
        `:rotating_light: *Instalment billing needs a human.* ${failed.length} client(s) are ` +
          `owed money that could not be invoiced:\n${failed.map((f) => `• ${f}`).join("\n")}`,
      ).catch(() => {});
    } else if (raised.length) {
      await postToSalesChannel(
        `:white_check_mark: Instalment sweep raised ${raised.length} invoice(s) that the live ` +
          `path had missed: ${raised.join(", ")}`,
      ).catch(() => {});
    }

    const result = { status: "ok", checked: stuck.rows.length, raised, failed };
    await releaseJobLock(LOCK_KEY, {
      status: failed.length ? "failed" : "ok",
      detail: `checked ${stuck.rows.length}, raised ${raised.length}, failed ${failed.length}`,
      result,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/instalment-sweep]", e);
    await postToSalesChannel(
      `:rotating_light: The instalment billing sweep itself failed: ${message}. Nobody is ` +
        `checking whether clients are being billed until this is fixed.`,
    ).catch(() => {});
    await releaseJobLock(LOCK_KEY, { status: "failed", detail: message }).catch(() => {});
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
