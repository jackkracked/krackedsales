"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/avatar";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { startOfMonth, addDays, format } from "date-fns";

interface RepRow {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  calls: number;
  demos: number;
  proposalsSent: number;
  dealsClosed: number;
  openLeads: number;
}


function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full",
        active ? "bg-emerald-500" : "bg-muted-foreground/40"
      )}
    />
  );
}

const COLUMNS = [
  { key: "calls", label: "Calls", align: "right" as const },
  { key: "demos", label: "Demos", align: "right" as const },
  { key: "proposalsSent", label: "Proposals", align: "right" as const },
  { key: "dealsClosed", label: "Closed", align: "right" as const },
  { key: "openLeads", label: "Open", align: "right" as const },
];

export function RepPerformanceLeaderboard() {
  const defaultRange = useMemo(() => {
    const now = new Date();
    const s = startOfMonth(now);
    const e = addDays(startOfMonth(new Date(now.getFullYear(), now.getMonth() + 1, 1)), 0);
    return { start: format(s, "yyyy-MM-dd"), end: format(e, "yyyy-MM-dd"), preset: "mtd" };
  }, []);

  const [dateRange, setDateRange] = useState<{ start: string; end: string; preset?: string }>(defaultRange);

  // Map picker presets to legacy API `range` param; fall back to start/end params
  const queryParams = useMemo(() => {
    const presetMap: Record<string, string> = {
      today: "range=today",
      yesterday: "range=today",
      wtd: "range=week",
      mtd: "range=month",
      last_7: "range=30d",
      last_30: "range=30d",
      ytd: "range=all",
    };
    if (dateRange.preset && presetMap[dateRange.preset]) {
      return presetMap[dateRange.preset];
    }
    return `start=${dateRange.start}&end=${dateRange.end}`;
  }, [dateRange]);

  const { data, isPending } = useQuery<{ reps: RepRow[] }>({
    queryKey: ["rep-performance", queryParams],
    queryFn: () =>
      fetch(`/api/dashboard/rep-performance?${queryParams}`).then((r) => r.json()),
    staleTime: 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
  });

  const reps = data?.reps ?? [];
  const isLoading = isPending && !data;

  return (
    <div className="bg-card border border-border rounded-[10px] overflow-hidden shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Rep Performance
        </h3>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Rep
            </th>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground",
                  col.align === "right" ? "text-right" : "text-left"
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-3" colSpan={6}>
                    <div className="h-4 bg-muted/60 rounded animate-pulse w-full" />
                  </td>
                </tr>
              ))
            : reps.map((rep) => (
                <tr
                  key={rep.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={rep.name} size={28} variant="rep" />
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate leading-tight">
                          {rep.name}
                        </p>
                        <StatusDot active={rep.isActive} />
                      </div>
                    </div>
                  </td>
                  {COLUMNS.map((col) => (
                    <td
                      key={col.key}
                      className="px-4 py-3 text-right tabular-nums text-sm text-foreground/80"
                    >
                      {rep[col.key as keyof RepRow] as number}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>

      {!isLoading && reps.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No activity in this period.
        </div>
      )}
    </div>
  );
}
