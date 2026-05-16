import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY!.trim();
const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" as any });

async function run() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({
      label: d.toISOString().slice(0, 7),
      start: Math.floor(d.getTime() / 1000),
      end: Math.floor(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).getTime() / 1000),
    });
  }

  console.log("\n═══ CHURN AUDIT — Last 6 Months ═══\n");

  for (const m of months) {
    const events = await stripe.events.list({
      type: "customer.subscription.deleted",
      created: { gte: m.start, lt: m.end },
      limit: 100,
    });

    if (events.data.length === 0) {
      console.log(`${m.label}  →  No cancellations`);
      continue;
    }

    let totalMRR = 0;
    const details: string[] = [];
    for (const evt of events.data) {
      const sub = evt.data.object as any;
      const item = sub.items?.data?.[0];
      const unitAmount = item?.price?.unit_amount ?? 0;
      const interval = item?.price?.recurring?.interval ?? "month";
      const count = item?.price?.recurring?.interval_count ?? 1;
      let monthly = unitAmount;
      if (interval === "year") monthly = unitAmount / (12 * count);
      else if (interval === "week") monthly = (unitAmount * 52) / (12 * count);
      else monthly = unitAmount / count;
      monthly = monthly / 100;
      totalMRR += monthly;

      let customer = "unknown";
      if (sub.customer) {
        try {
          const cust = await stripe.customers.retrieve(sub.customer as string) as any;
          customer = cust.deleted ? "(deleted)" : `${cust.name ?? ""} <${cust.email ?? ""}>`.trim();
        } catch {}
      }

      const cancelledDate = sub.canceled_at
        ? new Date(sub.canceled_at * 1000).toISOString().slice(0, 10)
        : "?";
      details.push(`    • ${customer} — $${monthly.toFixed(0)}/mo — cancelled ${cancelledDate}`);
    }

    console.log(`${m.label}  →  ${events.data.length} cancellation(s), $${totalMRR.toFixed(0)} MRR lost`);
    details.forEach(d => console.log(d));
    console.log();
  }
}

run().catch(console.error);
