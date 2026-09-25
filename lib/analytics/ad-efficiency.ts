import { db } from "@/lib/db";
import { customers, proposals } from "@/lib/db/schema";
import { and, gte, lt, isNotNull, eq, inArray, sql } from "drizzle-orm";
import { WON_STATUSES } from "@/lib/proposals/status";

/**
 * Ad efficiency, cohort-based. For each acquisition MONTH we credit the clients acquired
 * that month with ALL the revenue they have since paid (their LTV to date) — the standard
 * cohort-LTV approach — and compare it to what was spent on ads that month.
 *
 *   spend   = Meta ad spend that month (Facebook + Instagram consolidated into "Meta").
 *   clients = new clients that month (first paid invoice), by tagged source.
 *   gotBack = actual revenue those clients have paid to date (cohort LTV).
 *   cac     = spend / clients        roas = gotBack / spend
 *
 * TikTok has no spend feed and "Other" is organic → spend 0, cac/roas null (revenue only).
 * "All" spends the Meta total across every client (blended); "Meta" divides it by Meta
 * clients only (true ad efficiency).
 */

export type AdSource = "all" | "meta" | "tiktok" | "other";
export const AD_SOURCES: AdSource[] = ["all", "meta", "tiktok", "other"];
const SOURCE_LABEL: Record<AdSource, string> = { all: "All", meta: "Meta", tiktok: "TikTok", other: "Other" };

export interface AdMonth {
  month: string; // "YYYY-MM"
  label: string; // "May 26"
  spend: number; // dollars
  clients: number;
  gotBack: number; // dollars (cohort LTV to date)
  cac: number | null;
  roas: number | null;
  maturing: boolean; // cohort too young to have paid back yet
  clientList: AdClient[]; // who the new clients were that month (drill-down)
}
export interface AdClient { name: string; type: "project" | "management"; gotBack: number; paid: number }
export interface TypeBreakdown { clients: number; gotBack: number; avgValue: number }
export interface AdSourceData {
  source: AdSource;
  label: string;
  hasSpend: boolean;
  spend: number;
  clients: number;
  gotBack: number;
  cac: number | null;
  roas: number | null;
  byType: { project: TypeBreakdown; management: TypeBreakdown };
  trend: AdMonth[];
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key: string): string { const [y, m] = key.split("-").map(Number); return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`; }

function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  let y = start.getUTCFullYear(); let m = start.getUTCMonth();
  const last = new Date(end.getTime() - 1); const stopY = last.getUTCFullYear(); const stopM = last.getUTCMonth();
  while (y < stopY || (y === stopY && m <= stopM)) { out.push(`${y}-${String(m + 1).padStart(2, "0")}`); m++; if (m > 11) { m = 0; y++; } }
  return out;
}

/** Meta ad spend per month (all Meta placements folded into one "Meta" total). Keyed "YYYY-MM". */
async function metaSpendByMonth(start: Date, end: Date): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!adAccountId) return map;
  try {
    const since = start.toISOString().slice(0, 10);
    const until = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);
    const { meta } = await import("@/lib/meta/client");
    const res = await meta.get<{ data: Array<{ spend?: string; date_start?: string }> }>(
      `/${adAccountId}/insights`,
      { fields: "spend", level: "account", time_increment: "monthly", time_range: JSON.stringify({ since, until }), limit: "500" },
    );
    for (const row of res.data ?? []) {
      if (!row.date_start) continue;
      const key = row.date_start.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + parseFloat(row.spend ?? "0"));
    }
  } catch (e) {
    console.error("[analytics/ad-efficiency] Meta spend fetch failed:", e);
  }
  return map;
}

interface CohortCell { clients: number; gotBack: number; list: { name: string; gotBack: number; paid: number }[] } // dollars
type MonthSourceType = Map<string, Map<AdSource, { project: CohortCell; management: CohortCell }>>;

/** New clients + their cohort revenue, by month × source × type, WITH names.
 *  "Got back" per client = actual CLEARED CASH to date (customers.ltvNet), the true cohort-LTV.
 *  We never credit the signed/committed contract value — only money that has actually landed —
 *  so ad efficiency reflects real return, not promised return. */
async function cohortsByMonth(start: Date, end: Date): Promise<MonthSourceType> {
  // From won proposals, per client (by email): the business type only (the proposal's
  // management/project is authoritative; customers.type is a Stripe-billing artifact that
  // mislabels invoice-billed retainers as one-off). Contract value is intentionally NOT used.
  const propRows = await db()
    .select({ email: sql<string>`lower(${proposals.contactEmail})`.as("email"), type: proposals.type, createdAt: proposals.createdAt })
    .from(proposals)
    // WON_STATUSES covers "active"/"completed" too; without them a spread client drops out of
    // typeByEmail entirely and their cohort revenue is silently mis-bucketed.
    .where(inArray(proposals.status, [...WON_STATUSES, "partial", "signed"]));
  const typeByEmail = new Map<string, string>();
  const latestByEmail = new Map<string, Date>();
  for (const p of propRows) {
    if (!p.email) continue;
    const at = p.createdAt ? new Date(p.createdAt) : null;
    const cur = latestByEmail.get(p.email);
    if (at && (!cur || at > cur)) { latestByEmail.set(p.email, at); typeByEmail.set(p.email, p.type); }
  }

  const rows = await db()
    .select({
      name: customers.name,
      email: customers.email,
      month: sql<string>`to_char(date_trunc('month', ${customers.firstPaidAt}), 'YYYY-MM')`.as("month"),
      src: sql<string>`lower(coalesce(${customers.source}, 'other'))`.as("src"),
      custType: customers.type,
      ltvCents: customers.ltvNet,
    })
    .from(customers)
    .where(and(eq(customers.isTest, false), isNotNull(customers.firstPaidAt), gte(customers.firstPaidAt, start), lt(customers.firstPaidAt, end)));

  const map: MonthSourceType = new Map();
  const blank = (): { project: CohortCell; management: CohortCell } => ({ project: { clients: 0, gotBack: 0, list: [] }, management: { clients: 0, gotBack: 0, list: [] } });
  for (const r of rows) {
    const src: AdSource = r.src === "facebook" || r.src === "instagram" ? "meta" : r.src === "tiktok" ? "tiktok" : "other";
    const email = r.email ? r.email.toLowerCase() : null;
    const propType = email ? typeByEmail.get(email) : undefined;
    const typ: "project" | "management" = propType === "management" ? "management" : propType === "project" ? "project" : r.custType === "subscription" ? "management" : "project";
    if (!map.has(r.month)) map.set(r.month, new Map());
    const byS = map.get(r.month)!;
    if (!byS.has(src)) byS.set(src, blank());
    const cell = byS.get(src)![typ];
    // Credit ACTUAL cleared cash (cohort LTV to date) — never the signed/committed contract value.
    const paid = Number(r.ltvCents ?? 0) / 100;
    cell.clients += 1;
    cell.gotBack += paid;
    cell.list.push({ name: r.name || "Unknown", gotBack: paid, paid });
  }
  return map;
}

const safeDiv = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export async function loadAdEfficiency(start: Date, end: Date): Promise<{ months: string[]; sources: Record<AdSource, AdSourceData> }> {
  // Snap to WHOLE calendar months. A 30/90-day range otherwise slices a month in half and
  // shows spend with no clients (e.g. "Last 30 days" starting Jun 21 hid June's real clients).
  // Every bucket is now a full month: ad spend and new clients always line up.
  const snapStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const lastDay = new Date(end.getTime() - 1);
  const snapEnd = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth() + 1, 1));
  const months = monthsBetween(snapStart, snapEnd);
  const [spend, cohorts] = await Promise.all([metaSpendByMonth(snapStart, snapEnd), cohortsByMonth(snapStart, snapEnd)]);

  // Cohorts younger than this are still paying back; flag so nobody misreads a low return.
  const now = new Date();
  const maturingBefore = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); // current + previous month
  const isMaturing = (monthKey: string) => new Date(monthKey + "-01T00:00:00.000Z") >= maturingBefore;

  const cellFor = (monthKey: string, source: AdSource, type: "project" | "management"): CohortCell => {
    const byS = cohorts.get(monthKey);
    if (!byS) return { clients: 0, gotBack: 0, list: [] };
    if (source === "all") {
      let clients = 0, gotBack = 0; const list: { name: string; gotBack: number; paid: number }[] = [];
      for (const v of byS.values()) { clients += v[type].clients; gotBack += v[type].gotBack; list.push(...v[type].list); }
      return { clients, gotBack, list };
    }
    return byS.get(source)?.[type] ?? { clients: 0, gotBack: 0, list: [] };
  };

  const build = (source: AdSource): AdSourceData => {
    const hasSpend = source === "all" || source === "meta"; // only Meta has a spend feed
    const trend: AdMonth[] = months.map((mo) => {
      const p = cellFor(mo, source, "project");
      const m = cellFor(mo, source, "management");
      const clients = p.clients + m.clients;
      const gotBack = p.gotBack + m.gotBack;
      const mSpend = hasSpend ? (spend.get(mo) ?? 0) : 0;
      const clientList: AdClient[] = [
        ...p.list.map((c) => ({ name: c.name, type: "project" as const, gotBack: c.gotBack, paid: c.paid })),
        ...m.list.map((c) => ({ name: c.name, type: "management" as const, gotBack: c.gotBack, paid: c.paid })),
      ].sort((a, b) => b.gotBack - a.gotBack);
      return { month: mo, label: monthLabel(mo), spend: mSpend, clients, gotBack, cac: hasSpend ? safeDiv(mSpend, clients) : null, roas: hasSpend ? safeDiv(gotBack, mSpend) : null, maturing: isMaturing(mo), clientList };
    });
    const spendTotal = trend.reduce((a, r) => a + r.spend, 0);
    const clientsTotal = trend.reduce((a, r) => a + r.clients, 0);
    const gotBackTotal = trend.reduce((a, r) => a + r.gotBack, 0);
    const typeAgg = (type: "project" | "management"): TypeBreakdown => {
      const cells = months.map((mo) => cellFor(mo, source, type));
      const clients = cells.reduce((a, c) => a + c.clients, 0);
      const gotBack = cells.reduce((a, c) => a + c.gotBack, 0);
      return { clients, gotBack, avgValue: clients > 0 ? gotBack / clients : 0 };
    };
    return {
      source, label: SOURCE_LABEL[source], hasSpend,
      spend: spendTotal, clients: clientsTotal, gotBack: gotBackTotal,
      cac: hasSpend ? safeDiv(spendTotal, clientsTotal) : null,
      roas: hasSpend ? safeDiv(gotBackTotal, spendTotal) : null,
      byType: { project: typeAgg("project"), management: typeAgg("management") },
      trend,
    };
  };

  const sources = {} as Record<AdSource, AdSourceData>;
  for (const s of AD_SOURCES) sources[s] = build(s);
  return { months, sources };
}
