import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customers, customerPayments } from "@/lib/db/schema";
import { and, asc, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Customers list for the Customers tab. Admin-only. Read-only.
 *
 * Money is aggregated from `customer_payments` over an optional [from, to] date range, so the same tab
 * shows revenue for today / this month / this year / last year / all time — the row's "LTV" column and
 * who appears both shift with the range. Identity + current status/MRR come from the `customers` table.
 * With no range it's all-time. Filters: status, type, q, includeTest. Sort: ltv|mrr|payments|last|first|name.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const p = req.nextUrl.searchParams;
  const status = p.get("status");
  const type = p.get("type");
  const q = p.get("q")?.trim();
  const sort = p.get("sort") ?? "ltv";
  const dir = p.get("dir") === "asc" ? asc : desc;
  const includeTest = p.get("includeTest") === "1";
  const fromRaw = p.get("from");
  const toRaw = p.get("to");
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  const hasRange = !!(from || to);

  // Per-customer money aggregated over the range.
  const rangeConds = [];
  if (from && !isNaN(from.getTime())) rangeConds.push(gte(customerPayments.paidAt, from));
  if (to && !isNaN(to.getTime())) rangeConds.push(lt(customerPayments.paidAt, to));
  const agg = db()
    .select({
      dedupeKey: customerPayments.dedupeKey,
      revenue: sql<number>`sum(${customerPayments.amountNet})::int`.as("revenue"),
      pmts: sql<number>`count(*)::int`.as("pmts"),
      firstAt: sql<Date>`min(${customerPayments.paidAt})`.as("first_at"),
      lastAt: sql<Date>`max(${customerPayments.paidAt})`.as("last_at"),
    })
    .from(customerPayments)
    .where(rangeConds.length ? and(...rangeConds) : undefined)
    .groupBy(customerPayments.dedupeKey)
    .as("agg");

  const conds = [];
  if (!includeTest) conds.push(eq(customers.isTest, false));
  if (status === "active" || status === "inactive") conds.push(eq(customers.status, status));
  if (type === "subscription" || type === "one_off") conds.push(eq(customers.type, type));
  if (q) conds.push(or(ilike(customers.name, `%${q}%`), ilike(customers.email, `%${q}%`)));

  const sortMap = { ltv: agg.revenue, mrr: customers.currentMrr, payments: agg.pmts, last: agg.lastAt, first: agg.firstAt, name: customers.name } as const;
  const sortCol = sortMap[sort as keyof typeof sortMap] ?? agg.revenue;

  const rows = await db()
    .select({
      id: customers.id,
      email: customers.email,
      name: customers.name,
      contactId: customers.contactId,
      status: customers.status,
      type: customers.type,
      source: customers.source,
      currentMrr: customers.currentMrr,
      subscriptionDetail: customers.subscriptionDetail,
      subscriptionStatus: customers.subscriptionStatus,
      isTest: customers.isTest,
      currency: customers.currency,
      grossPaid: customers.grossPaid,
      refunded: customers.refunded,
      ltvNet: agg.revenue,
      paymentsCount: agg.pmts,
      firstPaidAt: agg.firstAt,
      lastPaidAt: agg.lastAt,
    })
    .from(agg)
    .innerJoin(customers, eq(customers.dedupeKey, agg.dedupeKey))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(dir(sortCol))
    .limit(3000);

  // Period summary (scoped to the range) + all-time current state.
  const [period] = await db()
    .select({
      customers: sql<number>`count(distinct ${customerPayments.dedupeKey})::int`,
      collected: sql<number>`coalesce(sum(${customerPayments.amountNet}), 0)::double precision`,
      payments: sql<number>`count(*)::int`,
    })
    .from(customerPayments)
    .innerJoin(customers, eq(customers.dedupeKey, customerPayments.dedupeKey))
    .where(and(includeTest ? undefined : eq(customers.isTest, false), ...rangeConds));

  const newConds = [includeTest ? undefined : eq(customers.isTest, false)];
  if (from && !isNaN(from.getTime())) newConds.push(gte(customers.firstPaidAt, from));
  if (to && !isNaN(to.getTime())) newConds.push(lt(customers.firstPaidAt, to));
  const [{ newCount }] = await db()
    .select({ newCount: sql<number>`count(*)::int` })
    .from(customers)
    .where(and(...newConds.filter(Boolean)));

  const [current] = await db()
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`sum(case when ${customers.status} = 'active' then 1 else 0 end)::int`,
      mrr: sql<number>`coalesce(sum(case when ${customers.status} = 'active' then ${customers.currentMrr} else 0 end), 0)::double precision`,
      ltv: sql<number>`coalesce(sum(${customers.ltvNet}), 0)::double precision`,
    })
    .from(customers)
    .where(eq(customers.isTest, false));

  const [{ tests }] = await db()
    .select({ tests: sql<number>`sum(case when ${customers.isTest} then 1 else 0 end)::int` })
    .from(customers);

  return NextResponse.json({
    customers: rows,
    hasRange,
    period: { ...period, newCount },
    current,
    testCount: tests ?? 0,
  });
}
