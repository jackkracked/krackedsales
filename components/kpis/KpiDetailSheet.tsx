"use client";

import { useEffect, useRef, useCallback } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { createPortal } from "react-dom";

interface DetailRow {
  /** Stable id (e.g. proposal id) — required for editable rows. */
  id?: string;
  label: string;
  sublabel?: string;
  amount?: number;
  date?: string;
  inPeriod: boolean;
  /** Present on editable rows (active/complete project status, etc.). */
  status?: string;
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
  /** When set, rows render an inline editor. "projectStatus" = active/complete toggle. */
  editable?: "projectStatus";
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

  // Editable rows (e.g. mark a project active/complete) — update + refresh the
  // drawer AND the card behind it so the count moves in lockstep.
  const queryClient = useQueryClient();
  const setProjectStatus = useMutation({
    mutationFn: async ({ proposalId, status }: { proposalId: string; status: "active" | "complete" }) => {
      const res = await fetch("/api/projects/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, status }),
      });
      if (!res.ok) throw new Error("Failed to update project status");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi-detail"] });
      queryClient.invalidateQueries({ queryKey: ["kpi-metrics"] });
    },
  });

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
        data-r10n-kpi-drawer
        className="relative w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col h-full outline-none animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <p data-r10n-kpi-eyebrow className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/60">Detail View</p>
            <h2 data-r10n-kpi-drawer-title className="text-base font-bold text-foreground mt-0.5 truncate">{isLoading ? "Loading…" : meta?.title ?? metric}</h2>
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
              <div data-r10n-kpi-summary className="flex items-baseline justify-between gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
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
                {rows.map((row, i) => {
                  const editable = meta?.editable === "projectStatus" && !!row.id;
                  // For editable rows the status is shown by the toggle, so the
                  // sublabel line carries the deal value instead.
                  const subBits = editable
                    ? [row.amount != null ? fmtUSD(row.amount) : undefined, row.date ? `paid ${fmtDate(row.date)}` : undefined]
                    : [row.sublabel, row.date ? fmtDate(row.date) : undefined];
                  return (
                    <div
                      key={row.id ?? `${row.date ?? ""}-${row.label}-${i}`}
                      data-r10n-kpi-row
                      data-in-period={row.inPeriod}
                      className={cn(
                        "flex items-center justify-between px-5 py-3 transition-colors border-l-2",
                        row.inPeriod
                          ? "bg-primary/5 border-l-primary"
                          : "border-l-transparent opacity-55 hover:opacity-100",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{row.label}</p>
                        {subBits.some(Boolean) && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {subBits.filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      {editable ? (
                        <ProjectStatusToggle
                          status={(row.status as "active" | "complete") ?? "active"}
                          pending={setProjectStatus.isPending && setProjectStatus.variables?.proposalId === row.id}
                          onChange={(s) => setProjectStatus.mutate({ proposalId: row.id as string, status: s })}
                        />
                      ) : row.amount != null ? (
                        <span data-r10n-kpi-amount data-negative={row.amount < 0} className={cn("ml-4 shrink-0 text-sm font-semibold tabular-nums", row.amount >= 0 ? "text-foreground" : "text-red-500")}>
                          {fmtUSD(row.amount)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
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
              <span data-r10n-kpi-dot className="inline-block w-2 h-2 rounded-sm bg-primary/60" /> in {periodLabel ?? "period"}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}

// ─── Active / Complete segmented toggle (Active Projects drill-down) ────────────

function ProjectStatusToggle({
  status,
  pending,
  onChange,
}: {
  status: "active" | "complete";
  pending: boolean;
  onChange: (s: "active" | "complete") => void;
}) {
  return (
    <div className="ml-3 shrink-0 flex rounded-[7px] border border-border overflow-hidden text-[11px] font-semibold">
      {(["active", "complete"] as const).map((s) => {
        const on = status === s;
        return (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => { if (!on) onChange(s); }}
            className={cn(
              "px-2.5 py-1 transition-colors disabled:opacity-60",
              s === "complete" && "border-l border-border",
              on
                ? s === "complete"
                  ? "bg-success-subtle text-success"
                  : "bg-primary/10 text-primary"
                : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {pending && !on ? <Loader2 className="w-3 h-3 animate-spin" /> : s === "complete" ? "Complete" : "Active"}
          </button>
        );
      })}
    </div>
  );
}
