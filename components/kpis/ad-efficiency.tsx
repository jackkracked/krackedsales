"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { RefreshCw, TrendingUp, Info, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { AdSource, AdSourceData } from "@/lib/analytics/ad-efficiency";

const SOURCES: { key: AdSource; label: string }[] = [
  { key: "all", label: "All" },
  { key: "meta", label: "Meta" },
  { key: "tiktok", label: "TikTok" },
  { key: "other", label: "Other" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number) => "$" + Math.round(n).toLocaleString();
const moneyK = (n: number) => (Math.abs(n) >= 1000 ? "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "$" + Math.round(n));
const cacStr = (n: number | null) => (n == null ? "—" : money(n));
const roasStr = (n: number | null) => (n == null ? "—" : n.toFixed(1) + "×");

const SPEND_COLOR = "var(--muted-foreground)";
const BACK_COLOR = "var(--r10n-chart-line, var(--primary))";

interface AdResponse { months: string[]; sources: Record<AdSource, AdSourceData> }

export function AdEfficiency() {
  const [range, setRange] = useState(() => {
    const now = new Date();
    return { start: iso(new Date(now.getTime() - 365 * 86_400_000)), end: iso(new Date(now.getTime() + 86_400_000)), preset: "365d" };
  });
  const [source, setSource] = useState<AdSource>("meta");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery<AdResponse>({
    queryKey: ["ad-efficiency", range.start, range.end],
    queryFn: async () => {
      const r = await fetch(`/api/analytics/ad-efficiency?start=${range.start}&end=${range.end}`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 60_000,
  });

  const s = data?.sources?.[source];
  const isPaid = s?.hasSpend ?? true;
  const rows = useMemo(() => (s ? [...s.trend].reverse() : []), [s]); // newest first for the table

  return (
    <div className="space-y-5">
      {/* Header: source selector + date range */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
          {SOURCES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSource(key)}
              className={cn("rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors", source === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <DateRangePicker value={range} onChange={(r) => setRange({ start: r.start, end: r.end, preset: r.preset ?? "" })} />
        </div>
      </div>

      {isLoading || !s ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* Plain-English summary */}
          <p className="text-sm text-foreground">
            {isPaid ? (
              <>Over this period, <span className="font-semibold">{s.label === "All" ? "ads" : s.label}</span> cost{" "}
                <span className="font-semibold">{money(s.spend)}</span> and the{" "}
                <span className="font-semibold">{s.clients}</span> client{s.clients === 1 ? "" : "s"} they brought in have paid back{" "}
                <span className="font-semibold text-primary">{money(s.gotBack)}</span>
                {s.roas != null && <> — a <span className="font-semibold text-primary">{roasStr(s.roas)}</span> return</>}.</>
            ) : (
              <><span className="font-semibold">{s.label}</span> has no ad-spend feed (organic / referral). It brought in{" "}
                <span className="font-semibold">{s.clients}</span> client{s.clients === 1 ? "" : "s"} who have paid{" "}
                <span className="font-semibold text-primary">{money(s.gotBack)}</span>.</>
            )}
          </p>

          {/* Top-line cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Spent on ads" value={isPaid ? money(s.spend) : "—"} />
            <Stat label="New clients" value={s.clients.toLocaleString()} />
            <Stat label="Cost / client" value={cacStr(s.cac)} />
            <Stat label="Got back" value={money(s.gotBack)} accent />
            <Stat label="Return" value={roasStr(s.roas)} accent={s.roas != null && s.roas >= 1} />
          </div>

          {/* Spend vs got-back by month */}
          <div className="rounded-[10px] border border-border bg-card p-5" data-r10n-analytics-card>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">Spent vs got back, by month</h4>
              <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: SPEND_COLOR }} /> Spent</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: BACK_COLOR }} /> Got back</span>
              </span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={s.trend} margin={{ top: 8, right: 4, bottom: 0, left: -4 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => moneyK(v)} />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={<AdTooltip />} />
                <Legend wrapperStyle={{ display: "none" }} />
                <Bar dataKey="spend" name="Spent" fill={SPEND_COLOR} radius={[3, 3, 0, 0]} maxBarSize={26} />
                <Bar dataKey="gotBack" name="Got back" fill={BACK_COLOR} radius={[3, 3, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Month-by-month table */}
          <div className="overflow-hidden rounded-[10px] border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-semibold">Month</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Spent</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Clients</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Cost / ea</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Got back</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Return</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.month}>
                    <tr
                      onClick={() => setExpanded(expanded === r.month ? null : r.month)}
                      className={cn("cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30", expanded === r.month && "bg-muted/20")}
                    >
                      <td className="px-4 py-2.5 text-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", expanded === r.month && "rotate-180")} />
                          {r.label}
                          {r.maturing && <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">still maturing</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{isPaid ? money(r.spend) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{r.clients}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{cacStr(r.cac)}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{money(r.gotBack)}</td>
                      <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", r.roas == null ? "text-muted-foreground/50" : r.maturing ? "text-muted-foreground" : r.roas >= 1 ? "text-primary" : "text-destructive")}>
                        {roasStr(r.roas)}
                      </td>
                    </tr>
                    {expanded === r.month && (
                      <tr className="border-b border-border/50 bg-muted/10">
                        <td colSpan={6} className="px-4 py-3">
                          {r.clientList.length === 0 ? (
                            <p className="pl-5 text-xs text-muted-foreground">No new clients this month.</p>
                          ) : (
                            <div className="space-y-1.5 pl-5">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">New clients ({r.clientList.length})</p>
                              {r.clientList.map((c, i) => (
                                <div key={i} className="flex items-center justify-between gap-3 text-xs">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide", c.type === "management" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{c.type === "management" ? "Mgmt" : "Project"}</span>
                                    <span className="truncate text-foreground">{c.name}</span>
                                  </span>
                                  <span className="shrink-0 whitespace-nowrap text-right tabular-nums">
                                    <span className="font-medium text-foreground">{money(c.gotBack)}</span>
                                    {c.gotBack > c.paid + 0.5 ? (
                                      <span className="ml-1.5 text-[10px] text-muted-foreground">contract · {money(c.paid)} paid so far</span>
                                    ) : (
                                      <span className="ml-1.5 text-[10px] text-muted-foreground">paid</span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No data in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* By type */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TypeCard title="Project clients" data={s.byType.project} />
            <TypeCard title="Management clients" data={s.byType.management} />
          </div>

          {rows.some((r) => r.maturing) && (
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Recent months read low on return because those clients were only just acquired and are still paying back. Their return climbs over the following months.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[10px] border border-border bg-card p-4" data-r10n-analytics-card>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold leading-none tabular-nums", accent ? "text-primary" : "text-foreground")} style={{ fontFamily: "var(--font-heading)" }}>{value}</p>
    </div>
  );
}

function TypeCard({ title, data }: { title: string; data: { clients: number; gotBack: number; avgValue: number } }) {
  return (
    <div className="rounded-[10px] border border-border bg-card p-4" data-r10n-analytics-card>
      <div className="flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold text-foreground">{title}</p>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="text-xl font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{data.clients}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">clients</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold tabular-nums text-primary" style={{ fontFamily: "var(--font-heading)" }}>{money(data.gotBack)}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">got back · {money(data.avgValue)} avg</p>
        </div>
      </div>
    </div>
  );
}

interface AdTipRow { payload: { label: string; spend: number; clients: number; gotBack: number; cac: number | null; roas: number | null; maturing: boolean } }
function AdTooltip({ active, payload }: { active?: boolean; payload?: AdTipRow[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] shadow-md">
      <p className="mb-1 font-semibold text-foreground">{p.label}{p.maturing && <span className="ml-1.5 font-normal text-muted-foreground">· still maturing</span>}</p>
      <div className="space-y-0.5 text-muted-foreground">
        <p>Spent: <span className="tabular-nums text-foreground">{p.cac == null ? "—" : money(p.spend)}</span></p>
        <p>Clients: <span className="tabular-nums text-foreground">{p.clients}</span> · Cost/ea: <span className="tabular-nums text-foreground">{cacStr(p.cac)}</span></p>
        <p>Got back: <span className="tabular-nums text-foreground">{money(p.gotBack)}</span></p>
        <p>Return: <span className="font-semibold tabular-nums text-foreground">{roasStr(p.roas)}</span></p>
      </div>
    </div>
  );
}
