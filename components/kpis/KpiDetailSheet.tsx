"use client";

import { useEffect, useRef, useCallback } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { X, Loader2, Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { createPortal } from "react-dom";

interface DetailRow {
  label: string;
  sublabel?: string;
  amount?: number;
  date?: string;
  inPeriod: boolean;
}

interface DetailPage {
  title: string;
  explanation: string;
  kind: "list" | "breakdown" | "pending";
  unit?: "currency" | "count" | "ratio";
  periodSum: number | null;
  periodCount: number;
  totalCount?: number;
  isSnapshot?: boolean;
  rows: DetailRow[];
  breakdown?: { label: string; value: string }[];
  nextOffset: number | null;
}

interface KpiDetailSheetProps {
  metric: string;
  start: string;
  end: string;
  /** Optional rep scoping (dashboard rep cards). */
  userId?: string;
  ghlUserId?: string;
  email?: string;
  /** Label for the selected period, e.g. "Year to Date". */
  periodLabel?: string;
  onClose: () => void;
}

function fmtUSD(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function KpiDetailSheet({ metric, start, end, userId, ghlUserId, email, periodLabel, onClose }: KpiDetailSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<DetailPage>({
    queryKey: ["kpi-detail", metric, start, end, userId, ghlUserId, email],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ metric, offset: String(pageParam) });
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      if (userId) params.set("userId", userId);
      if (ghlUserId) params.set("ghlUserId", ghlUserId);
      if (email) params.set("email", email);
      const res = await fetch(`/api/kpis/detail?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    staleTime: 2 * 60 * 1000,
  });

  const meta = data?.pages[0];
  const rows = data?.pages.flatMap((p) => p.rows) ?? [];
  const unit = meta?.unit ?? "currency";

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => { panelRef.current?.focus(); }, []);

  // Infinite scroll
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) loadMore(); }, { rootMargin: "120px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const periodValueText = meta
    ? unit === "count" || meta.periodSum == null
      ? `${meta.periodCount.toLocaleString()} ${meta.periodCount === 1 ? "item" : "items"}`
      : `${fmtUSD(meta.periodSum)} · ${meta.periodCount} ${meta.periodCount === 1 ? "item" : "items"}`
    : "";

  const content = (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col h-full outline-none animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/60">Detail View</p>
            <h2 className="text-base font-bold text-foreground mt-0.5 truncate">{isLoading ? "Loading…" : meta?.title ?? metric}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-border/50 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Explanation + summary */}
        {meta && (
          <div className="px-5 py-3.5 border-b border-border shrink-0 space-y-3">
            <div className="flex gap-2">
              <Info className="w-3.5 h-3.5 text-muted-foreground/60 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">{meta.explanation}</p>
            </div>
            {meta.kind === "list" && (
              <div className="flex items-baseline justify-between gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {meta.isSnapshot ? "Current total" : `In ${periodLabel ?? "selected period"}`}
                </span>
                <span className="text-sm font-bold text-foreground tabular-nums">{periodValueText}</span>
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">Failed to load detail data.</div>
          ) : meta?.kind === "pending" ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              Detailed line items for this metric aren’t wired up yet — the explanation above describes how it’s calculated.
            </div>
          ) : meta?.kind === "breakdown" ? (
            <div className="divide-y divide-border">
              {(meta.breakdown ?? []).map((b, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3.5">
                  <p className="text-sm text-foreground">{b.label}</p>
                  <span className="text-sm font-medium text-muted-foreground tabular-nums">{b.value}</span>
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">No line items found.</div>
          ) : (
            <>
              <div className="divide-y divide-border">
                {rows.map((row, i) => (
                  <div
                    key={`${row.date ?? ""}-${row.label}-${i}`}
                    className={cn(
                      "flex items-center justify-between px-5 py-3 transition-colors border-l-2",
                      row.inPeriod
                        ? "bg-primary/5 border-l-primary"
                        : "border-l-transparent opacity-55 hover:opacity-100",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{row.label}</p>
                      {(row.sublabel || row.date) && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {[row.sublabel, row.date ? fmtDate(row.date) : undefined].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    {row.amount != null && (
                      <span className={cn("ml-4 shrink-0 text-sm font-semibold tabular-nums", row.amount >= 0 ? "text-foreground" : "text-red-500")}>
                        {fmtUSD(row.amount)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {/* Infinite-scroll sentinel */}
              <div ref={sentinelRef} className="h-10 flex items-center justify-center">
                {isFetchingNextPage && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isLoading && meta?.kind === "list" && rows.length > 0 && (
          <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {rows.length}{meta.totalCount != null ? ` of ${meta.totalCount}` : ""} shown
            </p>
            <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm bg-primary/60" /> in {periodLabel ?? "period"}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
