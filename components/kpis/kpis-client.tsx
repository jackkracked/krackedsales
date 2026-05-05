"use client";

import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid, Legend, AreaChart, Area,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, DollarSign, Users, Target, Zap,
  ArrowUpRight, CheckCircle2, XCircle, ChevronLeft, ChevronRight,
  GripVertical, Pencil, X, RefreshCw,
} from "lucide-react";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils/cn";
import { useBrandCategoryStore } from "@/store/brand-category-store";

// ─── Default card orders ──────────────────────────────────────────────────────

const DEFAULT_EVERGREEN: string[] = [
  "cash-collected", "ad-spend", "roas", "processing-fees",
  "ads-mgmt", "software-cost", "team-fulfillment", "net-profit",
];

const DEFAULT_NORTH_STAR: string[] = [
  "leads-generated", "cost-per-lead", "booked-calls", "cost-per-booked-call",
  "show-rate", "no-show-calls", "audits-completed", "email-demos-started",
  "email-demo-conv-rate", "deals-closed", "new-mrr", "is-dtc",
];

// ─── Period types ─────────────────────────────────────────────────────────────

type Period = "weekly" | "monthly" | "quarterly";

// ─── Data types ───────────────────────────────────────────────────────────────

interface HeroMetrics {
  cashCollected: number; cashTarget: number;
  netProfit: number;
  leads: number; leadsTarget: number;
  roas: number; roasTarget: number;
  dealsClosed: number; dealsClosedTarget: number;
  adSpend: number; adSpendTarget: number;
}

interface DetailMetrics {
  cpl: number; cplTarget: number;
  cpbc: number; cpbcTarget: number;
  bookedCalls: number; bookedCallsTarget: number;
  noShowCalls: number; noShowCallsTarget: number;
  showRate: number; showRateTarget: number;
  audits: number; auditsTarget: number;
  emailDemosStarted: number; emailDemosStartedTarget: number;
  emailDemosSent: number; emailDemosSentTarget: number;
  emailConversionRate: number; emailConversionRateTarget: number;
  newMRR: number; newMRRTarget: number;
  processingFees: number;
  adsMgmt: number;
  softwareCost: number;
  teamFulfillment: number;
}

interface DealRow {
  client: string; cashCollected: number; auditCompleted: boolean; newMRR: number; date: string;
}

interface SubRow {
  label: string; sublabel: string;
  cashCollected: number; leads: number; adSpend: number;
  roas: number; bookedCalls: number; showRate: number;
  emailDemos: number; dealsClosed: number; cpl: number; cpbc: number;
}

interface PeriodData {
  hero: HeroMetrics;
  detail: DetailMetrics;
  deals: DealRow[];
  subRows: SubRow[];
  chartData: Array<{ label: string; cashCollected: number; adSpend: number; leads: number; cpl: number }>;
}

// ─── Placeholder data ─────────────────────────────────────────────────────────

const EMPTY: PeriodData = {
  hero: { cashCollected: 0, cashTarget: 25000, netProfit: 0, leads: 0, leadsTarget: 150, roas: 0, roasTarget: 4, dealsClosed: 0, dealsClosedTarget: 5, adSpend: 0, adSpendTarget: 5000 },
  detail: { cpl: 0, cplTarget: 50, cpbc: 0, cpbcTarget: 150, bookedCalls: 0, bookedCallsTarget: 30, noShowCalls: 0, noShowCallsTarget: 10, showRate: 0, showRateTarget: 60, audits: 0, auditsTarget: 5, emailDemosStarted: 0, emailDemosStartedTarget: 50, emailDemosSent: 0, emailDemosSentTarget: 50, emailConversionRate: 0, emailConversionRateTarget: 50, newMRR: 0, newMRRTarget: 2500, processingFees: 0, adsMgmt: 0, softwareCost: 0, teamFulfillment: 0 },
  deals: [],
  subRows: [],
  chartData: [],
};

const MARCH_DEALS: DealRow[] = [
  { client: "Coffee Library", cashCollected: 600, auditCompleted: false, newMRR: 0, date: "Mar 04" },
  { client: "Cuticle and CO", cashCollected: 8700, auditCompleted: false, newMRR: 0, date: "Mar 04" },
  { client: "Bruce Lee", cashCollected: 2700, auditCompleted: false, newMRR: 0, date: "Mar 09" },
  { client: "Yogi", cashCollected: 1200, auditCompleted: false, newMRR: 0, date: "Mar 11" },
  { client: "Seenaya", cashCollected: 3200, auditCompleted: true, newMRR: 0, date: "Mar 24" },
  { client: "Lebby Snacks", cashCollected: 600, auditCompleted: false, newMRR: 0, date: "Mar 25" },
  { client: "AUF 1", cashCollected: 3600, auditCompleted: true, newMRR: 0, date: "Mar 26" },
];

const MARCH_WEEKS: SubRow[] = [
  { label: "W1", sublabel: "Mar 01–07", cashCollected: 9300, leads: 48, adSpend: 1887, roas: 4.93, bookedCalls: 5, showRate: 100, emailDemos: 6, dealsClosed: 2, cpl: 34.28, cpbc: 377.42 },
  { label: "W2", sublabel: "Mar 08–14", cashCollected: 3900, leads: 82, adSpend: 2335, roas: 1.67, bookedCalls: 7, showRate: 100, emailDemos: 20, dealsClosed: 1, cpl: 28.48, cpbc: 333.58 },
  { label: "W3", sublabel: "Mar 15–21", cashCollected: 0, leads: 117, adSpend: 2771, roas: 0, bookedCalls: 19, showRate: 89.47, emailDemos: 43, dealsClosed: 0, cpl: 23.69, cpbc: 145.85 },
  { label: "W4", sublabel: "Mar 22–28", cashCollected: 7400, leads: 51, adSpend: 1277, roas: 5.79, bookedCalls: 10, showRate: 90, emailDemos: 57, dealsClosed: 1, cpl: 17.00, cpbc: 127.71 },
  { label: "W5", sublabel: "Mar 29–31", cashCollected: 0, leads: 0, adSpend: 0, roas: 0, bookedCalls: 0, showRate: 0, emailDemos: 0, dealsClosed: 0, cpl: 0, cpbc: 0 },
];

const DATA_MONTHLY: Record<string, PeriodData> = {
  "2026-03": {
    hero: { cashCollected: 20600, cashTarget: 25000, netProfit: 6607.23, leads: 298, leadsTarget: 150, roas: 2.49, roasTarget: 4, dealsClosed: 4, dealsClosedTarget: 5, adSpend: 8270, adSpendTarget: 5000 },
    detail: { cpl: 25.86, cplTarget: 50, cpbc: 246.14, cpbcTarget: 150, bookedCalls: 41, bookedCallsTarget: 30, noShowCalls: 3, noShowCallsTarget: 10, showRate: 92.68, showRateTarget: 60, audits: 3, auditsTarget: 5, emailDemosStarted: 126, emailDemosStartedTarget: 50, emailDemosSent: 60, emailDemosSentTarget: 50, emailConversionRate: 46.35, emailConversionRateTarget: 50, newMRR: 0, newMRRTarget: 2500, processingFees: 597.40, adsMgmt: 975, softwareCost: 250, teamFulfillment: 3900 },
    deals: MARCH_DEALS,
    subRows: MARCH_WEEKS,
    chartData: MARCH_WEEKS.map((w) => ({ label: w.label, cashCollected: w.cashCollected, adSpend: w.adSpend, leads: w.leads, cpl: w.cpl })),
  },
};

const DATA_QUARTERLY: Record<string, PeriodData> = {
  "2026-Q1": {
    hero: { cashCollected: 58400, cashTarget: 75000, netProfit: 18200, leads: 712, leadsTarget: 450, roas: 2.64, roasTarget: 4, dealsClosed: 11, dealsClosedTarget: 15, adSpend: 22100, adSpendTarget: 15000 },
    detail: { cpl: 31.04, cplTarget: 50, cpbc: 261.80, cpbcTarget: 150, bookedCalls: 84, bookedCallsTarget: 90, noShowCalls: 9, noShowCallsTarget: 30, showRate: 89.28, showRateTarget: 60, audits: 7, auditsTarget: 15, emailDemosStarted: 234, emailDemosStartedTarget: 150, emailDemosSent: 130, emailDemosSentTarget: 150, emailConversionRate: 41.2, emailConversionRateTarget: 50, newMRR: 0, newMRRTarget: 7500, processingFees: 1492.10, adsMgmt: 2925, softwareCost: 750, teamFulfillment: 11700 },
    deals: MARCH_DEALS,
    subRows: [
      { label: "Jan", sublabel: "January", cashCollected: 19100, leads: 198, adSpend: 7100, roas: 2.69, bookedCalls: 22, showRate: 86.4, emailDemos: 52, dealsClosed: 3, cpl: 35.86, cpbc: 322.73 },
      { label: "Feb", sublabel: "February", cashCollected: 18700, leads: 216, adSpend: 6730, roas: 2.78, bookedCalls: 21, showRate: 90.5, emailDemos: 56, dealsClosed: 4, cpl: 31.16, cpbc: 320.48 },
      { label: "Mar", sublabel: "March", cashCollected: 20600, leads: 298, adSpend: 8270, roas: 2.49, bookedCalls: 41, showRate: 92.68, emailDemos: 126, dealsClosed: 4, cpl: 25.86, cpbc: 246.14 },
    ],
    chartData: [
      { label: "Jan", cashCollected: 19100, adSpend: 7100, leads: 198, cpl: 35.86 },
      { label: "Feb", cashCollected: 18700, adSpend: 6730, leads: 216, cpl: 31.16 },
      { label: "Mar", cashCollected: 20600, adSpend: 8270, leads: 298, cpl: 25.86 },
    ],
  },
};

const DATA_WEEKLY: Record<string, PeriodData> = {
  "2026-03-W1": {
    hero: { cashCollected: 9300, cashTarget: 6250, netProfit: 3210, leads: 48, leadsTarget: 37, roas: 4.93, roasTarget: 4, dealsClosed: 2, dealsClosedTarget: 1, adSpend: 1887, adSpendTarget: 1250 },
    detail: { cpl: 34.28, cplTarget: 50, cpbc: 377.42, cpbcTarget: 150, bookedCalls: 5, bookedCallsTarget: 7, noShowCalls: 0, noShowCallsTarget: 2, showRate: 100, showRateTarget: 60, audits: 0, auditsTarget: 1, emailDemosStarted: 6, emailDemosStartedTarget: 12, emailDemosSent: 10, emailDemosSentTarget: 12, emailConversionRate: 12.5, emailConversionRateTarget: 50, newMRR: 0, newMRRTarget: 625, processingFees: 269.70, adsMgmt: 195, softwareCost: 62.50, teamFulfillment: 750 },
    deals: MARCH_DEALS.filter(d => d.date.startsWith("Mar 0")),
    subRows: [],
    chartData: [],
  },
  "2026-03-W2": {
    hero: { cashCollected: 3900, cashTarget: 6250, netProfit: 890, leads: 82, leadsTarget: 37, roas: 1.67, roasTarget: 4, dealsClosed: 1, dealsClosedTarget: 1, adSpend: 2335, adSpendTarget: 1250 },
    detail: { cpl: 28.48, cplTarget: 50, cpbc: 333.58, cpbcTarget: 150, bookedCalls: 7, bookedCallsTarget: 7, noShowCalls: 0, noShowCallsTarget: 2, showRate: 100, showRateTarget: 60, audits: 0, auditsTarget: 1, emailDemosStarted: 20, emailDemosStartedTarget: 12, emailDemosSent: 16, emailDemosSentTarget: 12, emailConversionRate: 24.39, emailConversionRateTarget: 50, newMRR: 0, newMRRTarget: 625, processingFees: 113.10, adsMgmt: 195, softwareCost: 62.50, teamFulfillment: 900 },
    deals: MARCH_DEALS.filter(d => ["Mar 09", "Mar 11"].includes(d.date)),
    subRows: [],
    chartData: [],
  },
  "2026-03-W3": {
    hero: { cashCollected: 0, cashTarget: 6250, netProfit: -2300, leads: 117, leadsTarget: 37, roas: 0, roasTarget: 4, dealsClosed: 0, dealsClosedTarget: 1, adSpend: 2771, adSpendTarget: 1250 },
    detail: { cpl: 23.69, cplTarget: 50, cpbc: 145.85, cpbcTarget: 150, bookedCalls: 19, bookedCallsTarget: 7, noShowCalls: 2, noShowCallsTarget: 2, showRate: 89.47, showRateTarget: 60, audits: 3, auditsTarget: 1, emailDemosStarted: 43, emailDemosStartedTarget: 12, emailDemosSent: 29, emailDemosSentTarget: 12, emailConversionRate: 36.75, emailConversionRateTarget: 50, newMRR: 0, newMRRTarget: 625, processingFees: 0, adsMgmt: 195, softwareCost: 62.50, teamFulfillment: 0 },
    deals: [],
    subRows: [],
    chartData: [],
  },
  "2026-03-W4": {
    hero: { cashCollected: 7400, cashTarget: 6250, netProfit: 2860, leads: 51, leadsTarget: 37, roas: 5.79, roasTarget: 4, dealsClosed: 1, dealsClosedTarget: 1, adSpend: 1277, adSpendTarget: 1250 },
    detail: { cpl: 17.00, cplTarget: 50, cpbc: 127.71, cpbcTarget: 150, bookedCalls: 10, bookedCallsTarget: 7, noShowCalls: 1, noShowCallsTarget: 2, showRate: 90, showRateTarget: 60, audits: 0, auditsTarget: 1, emailDemosStarted: 57, emailDemosStartedTarget: 12, emailDemosSent: 5, emailDemosSentTarget: 12, emailConversionRate: 111.76, emailConversionRateTarget: 50, newMRR: 0, newMRRTarget: 625, processingFees: 214.60, adsMgmt: 195, softwareCost: 62.50, teamFulfillment: 0 },
    deals: MARCH_DEALS.filter(d => ["Mar 24", "Mar 25", "Mar 26"].includes(d.date)),
    subRows: [],
    chartData: [],
  },
};

// ─── Period helpers ───────────────────────────────────────────────────────────

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getQuarterNum(date: Date) { return Math.floor(date.getMonth() / 3) + 1; }
function getQuarterKey(date: Date) { return `${date.getFullYear()}-Q${getQuarterNum(date)}`; }

function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  return Math.ceil((date.getDate() + firstDay) / 7);
}

function getWeekKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-W${getWeekOfMonth(date)}`;
}

function getPeriodKey(period: Period, date: Date): string {
  if (period === "monthly") return getMonthKey(date);
  if (period === "quarterly") return getQuarterKey(date);
  return getWeekKey(date);
}

function navigatePeriod(period: Period, date: Date, dir: -1 | 1): Date {
  if (period === "monthly") return new Date(date.getFullYear(), date.getMonth() + dir, 1);
  if (period === "quarterly") return new Date(date.getFullYear(), date.getMonth() + dir * 3, 1);
  return new Date(date.getTime() + dir * 7 * 24 * 60 * 60 * 1000);
}

function getPeriodLabel(period: Period, date: Date): string {
  if (period === "monthly") {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (period === "quarterly") {
    return `Q${getQuarterNum(date)} ${date.getFullYear()}`;
  }
  const day = date.getDay();
  const mon = new Date(date); mon.setDate(date.getDate() - ((day + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(mon)} – ${fmt(sun)}, ${sun.getFullYear()} · W${getWeekOfMonth(date)}`;
}

function getSubPeriodLabel(period: Period): string {
  if (period === "monthly") return "Weekly breakdown";
  if (period === "quarterly") return "Monthly breakdown";
  return "";
}

function getPeriodData(period: Period, date: Date): PeriodData {
  if (period === "monthly") return DATA_MONTHLY[getMonthKey(date)] ?? EMPTY;
  if (period === "quarterly") return DATA_QUARTERLY[getQuarterKey(date)] ?? EMPTY;
  return DATA_WEEKLY[getWeekKey(date)] ?? EMPTY;
}

function getPeriodDateRange(period: Period, date: Date): { since: string; until: string } {
  function iso(d: Date) { return d.toISOString().split("T")[0]; }
  const todayIso = iso(new Date());
  function capUntil(d: Date) { const s = iso(d); return s > todayIso ? todayIso : s; }

  if (period === "monthly") {
    const since = new Date(date.getFullYear(), date.getMonth(), 1);
    const until = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    // Pass end-of-month even for the current month — Meta/GHL cap to today internally,
    // and capping to today here caused Meta to miss same-day spend data.
    return { since: iso(since), until: iso(until) };
  }
  if (period === "quarterly") {
    const startMonth = (getQuarterNum(date) - 1) * 3;
    const since = new Date(date.getFullYear(), startMonth, 1);
    const until = new Date(date.getFullYear(), startMonth + 3, 0);
    return { since: iso(since), until: iso(until) };
  }
  const day = date.getUTCDay();
  const monMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((day + 6) % 7));
  const sunMs = monMs + 6 * 86_400_000;
  return { since: new Date(monMs).toISOString().slice(0, 10), until: capUntil(new Date(sunMs)) };
}

function isCurrentPeriod(period: Period, date: Date, today: Date): boolean {
  if (period === "monthly") return getMonthKey(date) === getMonthKey(today);
  if (period === "quarterly") return getQuarterKey(date) === getQuarterKey(today);
  return getWeekKey(date) === getWeekKey(today);
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmtPct(n: number) { return `${n.toFixed(2)}%`; }
function fmtX(n: number) { return n > 0 ? `${n.toFixed(2)}x` : "—"; }
function fmtNum(n: number) { return n > 0 ? n.toLocaleString("en-US") : "—"; }

function progressColor(pct: number, higherIsBetter = true) {
  const good = higherIsBetter ? pct >= 90 : pct <= 100;
  const ok = higherIsBetter ? pct >= 60 : pct <= 130;
  if (good) return { bar: "bg-emerald-500", text: "text-emerald-600" };
  if (ok) return { bar: "bg-amber-400", text: "text-amber-600" };
  return { bar: "bg-rose-500", text: "text-rose-600" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TrendIcon({ value, target, higherIsBetter = true }: { value: number; target: number; higherIsBetter?: boolean }) {
  if (!target) return <Minus className="w-3.5 h-3.5 text-muted-foreground/30" />;
  const ratio = value / target;
  const good = higherIsBetter ? ratio >= 1 : ratio <= 1;
  if (good) return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (ratio >= 0.7) return <Minus className="w-3.5 h-3.5 text-amber-500" />;
  return <TrendingDown className="w-3.5 h-3.5 text-rose-500" />;
}

// Map progress bar class → hex for SVG gradients
function sparklineColor(barClass: string | undefined): string {
  if (barClass === "bg-emerald-500") return "#10b981";
  if (barClass === "bg-amber-400") return "#f59e0b";
  if (barClass === "bg-rose-500") return "#f43f5e";
  return "#6366f1";
}

// ─── Override popover (shared) ────────────────────────────────────────────────

function OverridePopover({ onReset, onClose }: { onReset: () => void; onClose: () => void }) {
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-44 bg-card border border-border rounded-[8px] shadow-xl p-3">
      <p className="text-[11px] text-foreground font-medium mb-2.5">Reset to live data?</p>
      <div className="flex gap-1.5">
        <button
          onClick={onReset}
          className="flex-1 px-2 py-1 text-[11px] font-medium bg-foreground text-background rounded-[5px] hover:opacity-80 transition-opacity"
        >
          Reset
        </button>
        <button
          onClick={onClose}
          className="flex-1 px-2 py-1 text-[11px] font-medium bg-muted text-muted-foreground rounded-[5px] hover:bg-muted/80 transition-colors"
        >
          Keep
        </button>
      </div>
    </div>
  );
}

// ─── HeroCard ─────────────────────────────────────────────────────────────────

function HeroCard({
  label, value, target, icon: Icon, format = "currency", higherIsBetter = true, live, loading,
  isOverridden, onResetOverride, onConfirmReset, resetPopoverOpen, onCloseResetPopover,
}: {
  label: string; value: number; target?: number; icon: React.ElementType;
  format?: "currency" | "number" | "percent" | "x"; higherIsBetter?: boolean;
  live?: boolean; loading?: boolean;
  isOverridden?: boolean; onResetOverride?: () => void; onConfirmReset?: () => void;
  resetPopoverOpen?: boolean; onCloseResetPopover?: () => void;
}) {
  const display = format === "currency" ? fmtCurrency(value)
    : format === "percent" ? fmtPct(value)
    : format === "x" ? fmtX(value)
    : (value > 0 ? value.toLocaleString() : "0");
  const pct = target && target > 0 ? Math.min((value / target) * 100, 100) : null;
  const colors = pct !== null ? progressColor(pct, higherIsBetter) : null;
  const targetDisplay = !target ? null
    : format === "currency" ? fmtCurrency(target)
    : format === "percent" ? fmtPct(target)
    : format === "x" ? `${target}x`
    : String(target);

  return (
    <div className="bg-card border border-border rounded-[10px] p-4 flex flex-col gap-3 hover:border-primary/20 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide leading-tight truncate">{label}</p>
          {live && (
            <span className={cn("shrink-0 w-1.5 h-1.5 rounded-full", loading ? "bg-amber-400 animate-pulse" : "bg-emerald-500")} title={loading ? "Fetching live data…" : "Live data"} />
          )}
        </div>
        <div className="w-6 h-6 rounded-[5px] bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-3 h-3 text-primary" />
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5">
          <p className="text-xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{display}</p>
          {isOverridden && (
            <div className="relative">
              <button
                onClick={onResetOverride}
                className="w-1.5 h-1.5 rounded-[1px] bg-orange-500 hover:bg-orange-600 transition-colors cursor-pointer shrink-0"
                title="Manually overridden — click to reset to calculated value"
              />
              {resetPopoverOpen && onConfirmReset && onCloseResetPopover && (
                <OverridePopover onReset={onConfirmReset} onClose={onCloseResetPopover} />
              )}
            </div>
          )}
        </div>
        {targetDisplay && <p className="text-[11px] text-muted-foreground mt-0.5">Target: {targetDisplay}</p>}
      </div>
      {pct !== null && colors && (
        <div className="space-y-1">
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", colors.bar)} style={{ width: `${pct}%` }} />
          </div>
          <p className={cn("text-[10px] font-medium", colors.text)}>{pct.toFixed(0)}% of target</p>
        </div>
      )}
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string; value: number; target?: number;
  format?: "currency" | "number" | "percent" | "x";
  higherIsBetter?: boolean; subtext?: string;
  live?: boolean; loading?: boolean; accent?: boolean; tooltip?: string;
  sparkline?: number[];
  // drag — visual affordance only (listeners live on the wrapper)
  isDraggable?: boolean;
  // edit
  isEditing?: boolean;
  editValue?: string;
  onEditValueChange?: (v: string) => void;
  onEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (v: string) => void;
  // override
  isOverridden?: boolean;
  onResetOverride?: () => void;
  onConfirmReset?: () => void;
  resetPopoverOpen?: boolean;
  onCloseResetPopover?: () => void;
}

function MetricCard({
  label, value, target,
  format = "number",
  higherIsBetter = true,
  subtext, live, loading, accent, tooltip, sparkline,
  isDraggable = false,
  isEditing = false,
  editValue = "",
  onEditValueChange,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  isOverridden = false,
  onResetOverride,
  onConfirmReset,
  resetPopoverOpen = false,
  onCloseResetPopover,
}: MetricCardProps) {
  const display = format === "currency" ? fmtCurrency(Math.abs(value))
    : format === "percent" ? fmtPct(value)
    : format === "x" ? fmtX(value)
    : fmtNum(value);
  const targetDisplay = !target ? null
    : format === "currency" ? fmtCurrency(target)
    : format === "percent" ? fmtPct(target)
    : format === "x" ? `${target}x`
    : String(target);
  const pct = target && target > 0 ? (value / target) * 100 : null;
  const colors = pct !== null ? progressColor(pct, higherIsBetter) : null;

  const hasSparkline = sparkline && sparkline.length >= 2;
  const lineColor = sparklineColor(colors?.bar);
  const gradientId = `sl-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const sparkData = hasSparkline ? sparkline!.map((v) => ({ v })) : [];

  return (
    <div
      className={cn(
        "border rounded-[10px] p-4 flex flex-col gap-2 hover:border-primary/20 transition-colors group relative",
        accent
          ? "bg-emerald-50 border-emerald-200"
          : "bg-card border-border"
      )}
    >
      {/* Drag handle — centered at top edge, visual affordance only (drag activates on wrapper) */}
      {isDraggable && !isEditing && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 flex items-center justify-center px-3 py-1 opacity-0 group-hover:opacity-25 transition-opacity z-10 pointer-events-none select-none">
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      )}

      {/* Tooltip — delayed so it doesn't flash on casual hover */}
      {tooltip && (
        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-56 opacity-0 group-hover:opacity-100 transition-opacity duration-0 group-hover:duration-150 delay-0 group-hover:delay-1000">
          <div className="bg-zinc-900 dark:bg-zinc-800 rounded-[8px] px-3 py-2 shadow-xl text-[11px] text-zinc-100 leading-relaxed text-center">
            {tooltip}
          </div>
          <div className="w-2 h-2 bg-zinc-900 dark:bg-zinc-800 rotate-45 mx-auto -mt-1" />
        </div>
      )}

      {/* Label row */}
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide leading-tight truncate">{label}</p>
            {live && (
              <span
                className={cn("w-1.5 h-1.5 rounded-full shrink-0", loading ? "bg-amber-400 animate-pulse" : "bg-emerald-500")}
                title={loading ? "Fetching live data…" : "Live data"}
              />
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5 h-[14px] leading-none">
            {subtext ?? ""}
          </p>
        </div>
        {/* Pencil (hover) + trend icon — always same row */}
        <div className="flex items-center gap-0.5 shrink-0">
          {onEdit && (
            <button
              onClick={isEditing ? onCancelEdit : onEdit}
              className={cn(
                "p-0.5 rounded transition-all",
                isEditing
                  ? "opacity-100 text-muted-foreground hover:text-foreground"
                  : "opacity-0 group-hover:opacity-35 hover:!opacity-100 text-muted-foreground hover:text-foreground"
              )}
            >
              {isEditing ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
            </button>
          )}
          {target && target > 0 && !isEditing && (
            <TrendIcon value={value} target={target} higherIsBetter={higherIsBetter} />
          )}
        </div>
      </div>

      {/* Value + sparkline */}
      <div className="flex items-end justify-between gap-3 min-h-[56px]">
        {/* Left: value / inline input + progress indicator */}
        <div className="flex flex-col justify-end gap-1.5 min-w-0 flex-1">
          {isEditing ? (
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              value={editValue}
              onChange={(e) => onEditValueChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveEdit?.(editValue);
                if (e.key === "Escape") onCancelEdit?.();
              }}
              onBlur={() => onCancelEdit?.()}
              className={cn(
                "text-2xl font-bold leading-none bg-transparent border-0 border-b-2 border-emerald-500 outline-none focus:ring-0 p-0 w-full min-w-0",
                accent ? "text-emerald-800" : "text-foreground"
              )}
              style={{ fontFamily: "var(--font-heading)" }}
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <p
                className={cn("text-2xl font-bold leading-none", accent ? "text-emerald-800" : "text-foreground")}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {value < 0 ? "-" : ""}{display}
              </p>
              {/* Override indicator: orange square */}
              {isOverridden && (
                <div className="relative">
                  <button
                    onClick={onResetOverride}
                    className="w-2 h-2 rounded-[2px] bg-orange-500 hover:bg-orange-600 transition-colors cursor-pointer shrink-0"
                    title="Manually overridden — click to reset to calculated value"
                  />
                  {resetPopoverOpen && onConfirmReset && onCloseResetPopover && (
                    <OverridePopover onReset={onConfirmReset} onClose={onCloseResetPopover} />
                  )}
                </div>
              )}
            </div>
          )}
          {!isEditing && (pct !== null && colors ? (
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", colors.bar)} />
                <p className={cn("text-[10px] font-medium", colors.text)}>{Math.abs(pct).toFixed(0)}% of target</p>
              </div>
              {targetDisplay && <p className="text-[10px] text-muted-foreground">/ {targetDisplay}</p>}
            </div>
          ) : !isEditing && targetDisplay ? (
            <p className="text-[10px] text-muted-foreground">/ {targetDisplay}</p>
          ) : null)}
        </div>

        {/* Right: sparkline */}
        {!isEditing && (
          <div className="w-[45%] h-14 shrink-0">
            {hasSparkline ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={lineColor}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <svg width="100%" height="100%" preserveAspectRatio="none">
                <line
                  x1="0" y1="70%" x2="100%" y2="70%"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  className="text-muted-foreground/15"
                />
              </svg>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SortableMetricCard ───────────────────────────────────────────────────────

interface SortableMetricCardProps extends MetricCardProps {
  cardKey: string;
  editingAny: boolean;
}

function SortableMetricCard({ cardKey, editingAny, ...rest }: SortableMetricCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: cardKey,
    disabled: editingAny,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : (transition ?? "transform 180ms ease"),
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(!editingAny && "cursor-grab active:cursor-grabbing")}
      {...(!editingAny ? (listeners as React.HTMLAttributes<HTMLDivElement>) : {})}
      {...(attributes as React.HTMLAttributes<HTMLDivElement>)}
    >
      <MetricCard {...rest} isDraggable={!editingAny} />
    </div>
  );
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────

function SectionLabel({ label, color, dimmed }: { label: string; color: "blue" | "green"; dimmed?: boolean }) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-[7px] mb-1 transition-opacity",
      color === "green" ? "bg-emerald-600/8 border border-emerald-600/15" : "bg-primary/8 border border-primary/15",
      dimmed && "opacity-40",
    )}>
      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", color === "green" ? "bg-emerald-500" : "bg-primary")} />
      <span className={cn("text-[11px] font-bold uppercase tracking-wider", color === "green" ? "text-emerald-700 dark:text-emerald-400" : "text-primary")}>{label}</span>
    </div>
  );
}

// ─── ChartTooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-[8px] px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value >= 1000 ? fmtCurrency(p.value) : p.value > 0 ? p.value : "—"}</p>
      ))}
    </div>
  );
}

// ─── BreakdownTable ───────────────────────────────────────────────────────────

function BreakdownTable({ subRows, period }: { subRows: SubRow[]; period: Period }) {
  if (!subRows.length) return (
    <div className="text-center py-8 text-sm text-muted-foreground">No breakdown data available for this period.</div>
  );

  const cols = [
    { label: "Cash Collected", key: "cashCollected" as keyof SubRow, fmt: (v: number) => fmtCurrency(v) },
    { label: "Leads", key: "leads" as keyof SubRow, fmt: (v: number) => fmtNum(v) },
    { label: "Ad Spend", key: "adSpend" as keyof SubRow, fmt: (v: number) => fmtCurrency(v) },
    { label: "ROAS", key: "roas" as keyof SubRow, fmt: (v: number) => fmtX(v) },
    { label: "Booked Calls", key: "bookedCalls" as keyof SubRow, fmt: (v: number) => fmtNum(v) },
    { label: "Show Rate", key: "showRate" as keyof SubRow, fmt: (v: number) => v > 0 ? fmtPct(v) : "—" },
    { label: "Email Demos", key: "emailDemos" as keyof SubRow, fmt: (v: number) => fmtNum(v) },
    { label: "Deals", key: "dealsClosed" as keyof SubRow, fmt: (v: number) => fmtNum(v) },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-28">
              {period === "quarterly" ? "Month" : "Week"}
            </th>
            {cols.map((c) => (
              <th key={c.key} className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subRows.map((row) => (
            <tr key={row.label} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
              <td className="py-2 pr-4">
                <p className="text-sm font-semibold text-foreground">{row.label}</p>
                <p className="text-[10px] text-muted-foreground">{row.sublabel}</p>
              </td>
              {cols.map((c) => {
                const val = row[c.key] as number;
                return (
                  <td key={c.key} className={cn("text-center px-2 py-2 text-sm", val === 0 ? "text-muted-foreground/30" : "text-foreground")}>
                    {c.fmt(val)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── DealsTable ───────────────────────────────────────────────────────────────

function DealsTable({ deals }: { deals: DealRow[] }) {
  if (!deals.length) return (
    <div className="text-center py-8 text-sm text-muted-foreground">No deals closed in this period.</div>
  );
  const total = deals.reduce((s, d) => s + d.cashCollected, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {["Client", "Cash Collected", "Audit", "New MRR", "Date"].map((h) => (
              <th key={h} className={cn("py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide", h === "Client" ? "text-left pr-4" : "text-center px-3")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.client} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
              <td className="py-2.5 pr-4 font-medium text-foreground">{d.client}</td>
              <td className="text-center px-3 py-2.5 font-semibold text-emerald-600">{fmtCurrency(d.cashCollected)}</td>
              <td className="text-center px-3 py-2.5">
                {d.auditCompleted
                  ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3 h-3" /> Yes</span>
                  : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-600"><XCircle className="w-3 h-3" /> No</span>}
              </td>
              <td className="text-center px-3 py-2.5 text-muted-foreground">{d.newMRR > 0 ? fmtCurrency(d.newMRR) : "—"}</td>
              <td className="text-center px-3 py-2.5 text-muted-foreground">{d.date}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border">
            <td className="py-2.5 pr-4 text-xs font-semibold text-muted-foreground uppercase">Total</td>
            <td className="text-center px-3 py-2.5 font-bold text-emerald-600">{fmtCurrency(total)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── DemosStartedTable ────────────────────────────────────────────────────────

function DemosStartedTable({
  demos,
  isLoading,
}: {
  demos: Array<{ id: string; contact: string; pipeline: string; stage: string; date: string }>;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    );
  }
  if (!demos.length) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No demos started in this period.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {["Contact", "Pipeline", "Stage", "Date"].map((h) => (
              <th
                key={h}
                className={cn(
                  "py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide",
                  h === "Contact" ? "text-left pr-4" : "text-center px-3"
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {demos.map((d) => (
            <tr key={d.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
              <td className="py-2.5 pr-4 font-medium text-foreground">{d.contact}</td>
              <td className="text-center px-3 py-2.5 text-muted-foreground text-xs">{d.pipeline}</td>
              <td className="text-center px-3 py-2.5">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                  {d.stage}
                </span>
              </td>
              <td className="text-center px-3 py-2.5 text-muted-foreground">{d.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function KpisClient() {
  const today = new Date();
  const [period, setPeriod] = useState<Period>("monthly");
  const [refDate, setRefDate] = useState<Date>(today);

  const baseData = getPeriodData(period, refDate);
  const periodLabel = getPeriodLabel(period, refDate);
  const isCurrent = isCurrentPeriod(period, refDate, today);
  const { since, until } = getPeriodDateRange(period, refDate);
  const periodKey = getPeriodKey(period, refDate);

  // ── Card order state ──
  const [evergreenOrder, setEvergreenOrder] = useState<string[]>(DEFAULT_EVERGREEN);
  const [northStarOrder, setNorthStarOrder] = useState<string[]>(DEFAULT_NORTH_STAR);
  const orderLoadedRef = useRef(false);

  // ── Edit / override state ──
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [resetPopoverKey, setResetPopoverKey] = useState<string | null>(null);

  // ── Drag state ──
  const [activeDragInfo, setActiveDragInfo] = useState<{ id: string; section: "evergreen" | "northstar" } | null>(null);

  const queryClient = useQueryClient();

  // ── DnD sensors ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Live data queries ──

  const { data: adsData, isFetching: adsFetching } = useQuery({
    queryKey: ["meta-ads", since, until],
    queryFn: async () => {
      const res = await fetch(`/api/meta/ads?since=${since}&until=${until}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ spend: number; leads: number; cpl: number | null }>;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: commentLeadData } = useQuery({
    queryKey: ["comment-leads-count", since, until],
    queryFn: async () => {
      const res = await fetch(`/api/comment-leads/count?since=${since}&until=${until}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ count: number }>;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: demosData } = useQuery({
    queryKey: ["demos-count", since, until],
    queryFn: async () => {
      const res = await fetch(`/api/clickup/demos/count?since=${since}&until=${until}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ count: number }>;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: demosListData } = useQuery({
    queryKey: ["demos-started", since, until],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/demos/started?since=${since}&until=${until}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ demos: Array<{ id: string; contact: string; pipeline: string; stage: string; date: string }> }>;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: noShowCallsData } = useQuery({
    queryKey: ["no-show-calls", since, until],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/opportunities/no-show-calls?since=${since}&until=${until}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ count: number }>;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // DTC count — read directly from the Zustand brand category store (populated
  // as leads are rendered on the pipeline page and their websites are analysed).
  const { categories } = useBrandCategoryStore();

  const { data: dailyAdsData } = useQuery({
    queryKey: ["meta-ads-daily", since, until],
    queryFn: async () => {
      const res = await fetch(`/api/meta/ads/daily?since=${since}&until=${until}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ days: Array<{ date: string; spend: number; leads: number }> }>;
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const { data: computedCostsData } = useQuery({
    queryKey: ["computed-costs", since, until],
    queryFn: async () => {
      const res = await fetch(`/api/kpi/computed-costs?since=${since}&until=${until}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ softwareCost: number; teamFulfillment: number }>;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: bookedCallsData } = useQuery({
    queryKey: ["booked-calls", since, until],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/opportunities/booked-calls?since=${since}&until=${until}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ count: number }>;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // ── Card order from DB ──

  const { data: cardOrderData } = useQuery({
    queryKey: ["kpi-card-order"],
    queryFn: async () => {
      const res = await fetch("/api/kpi/card-order");
      if (!res.ok) return { order: [] };
      return res.json() as Promise<{ order: Array<{ section: string; cardKey: string; position: number }> }>;
    },
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (orderLoadedRef.current || !cardOrderData?.order?.length) return;
    orderLoadedRef.current = true;
    const eg = cardOrderData.order
      .filter(o => o.section === "evergreen")
      .sort((a, b) => a.position - b.position)
      .map(o => o.cardKey);
    const ns = cardOrderData.order
      .filter(o => o.section === "northstar")
      .sort((a, b) => a.position - b.position)
      .map(o => o.cardKey);
    if (eg.length > 0) {
      const merged = [...eg, ...DEFAULT_EVERGREEN.filter(k => !eg.includes(k))];
      setEvergreenOrder(merged);
    }
    if (ns.length > 0) {
      const merged = [...ns, ...DEFAULT_NORTH_STAR.filter(k => !ns.includes(k))];
      setNorthStarOrder(merged);
    }
  }, [cardOrderData]);

  // ── Overrides from DB ──

  const { data: overridesData } = useQuery({
    queryKey: ["kpi-overrides", periodKey],
    queryFn: async () => {
      const res = await fetch(`/api/kpi/overrides?period=${encodeURIComponent(periodKey)}`);
      if (!res.ok) return { overrides: [] };
      return res.json() as Promise<{ overrides: Array<{ metricKey: string; value: number }> }>;
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  const overrides: Record<string, number> = {};
  for (const o of overridesData?.overrides ?? []) {
    overrides[o.metricKey] = o.value;
  }

  // ── Derived live values ──

  const adSpend = adsData?.spend ?? baseData.hero.adSpend;
  const metaFormLeads = adsData?.leads ?? 0;
  const commentLeadCount = commentLeadData?.count ?? 0;
  const totalLeads = metaFormLeads + commentLeadCount;
  const combinedCpl = adSpend > 0 && totalLeads > 0 ? adSpend / totalLeads : baseData.detail.cpl;
  const emailDemosStarted = demosData?.count ?? baseData.detail.emailDemosStarted;
  const emailConversionRate = totalLeads > 0 && emailDemosStarted > 0
    ? parseFloat(((emailDemosStarted / totalLeads) * 100).toFixed(2))
    : baseData.detail.emailConversionRate;
  const bookedCalls = bookedCallsData?.count ?? baseData.detail.bookedCalls;
  const cpbc = adSpend > 0 && bookedCalls > 0
    ? parseFloat((adSpend / bookedCalls).toFixed(2))
    : baseData.detail.cpbc;
  const noShowCalls = noShowCallsData?.count ?? baseData.detail.noShowCalls;

  // DTC count — count all domains in the brand category store that are classified
  // as ecommerce. The pipeline page populates this store as cards are rendered.
  const dtcCount = Object.values(categories).filter((e) => e.category === "ecommerce").length;

  // Show-up rate = (booked − no-shows) / booked × 100
  // Only compute live when both values are available from the API
  const showRate = (bookedCallsData && noShowCallsData && bookedCalls > 0)
    ? parseFloat((((bookedCalls - noShowCalls) / bookedCalls) * 100).toFixed(2))
    : baseData.detail.showRate;

  const data: PeriodData = {
    ...baseData,
    hero: {
      ...baseData.hero,
      adSpend,
      leads: totalLeads > 0 ? totalLeads : baseData.hero.leads,
    },
    detail: {
      ...baseData.detail,
      cpl: combinedCpl,
      emailDemosStarted,
      emailConversionRate,
      bookedCalls,
      cpbc,
      noShowCalls,
      showRate,
      softwareCost: computedCostsData?.softwareCost ?? baseData.detail.softwareCost,
      teamFulfillment: computedCostsData?.teamFulfillment ?? baseData.detail.teamFulfillment,
    },
  };

  const dailyDays = dailyAdsData?.days ?? [];
  const sl = {
    adSpend:       dailyDays.length >= 2 ? dailyDays.map((d) => d.spend) : data.subRows.map((r) => r.adSpend),
    leads:         dailyDays.length >= 2 ? dailyDays.map((d) => d.leads) : data.subRows.map((r) => r.leads),
    cpl:           dailyDays.length >= 2
                     ? dailyDays.map((d) => d.spend > 0 && d.leads > 0 ? d.spend / d.leads : 0)
                     : data.subRows.map((r) => r.cpl),
    cashCollected: data.subRows.map((r) => r.cashCollected),
    roas:          data.subRows.map((r) => r.roas),
    bookedCalls:   data.subRows.map((r) => r.bookedCalls),
    cpbc:          data.subRows.map((r) => r.cpbc),
    showRate:      data.subRows.map((r) => r.showRate),
    emailDemos:    data.subRows.map((r) => r.emailDemos),
    dealsClosed:   data.subRows.map((r) => r.dealsClosed),
  };

  // ── Override helpers ──

  function rv(key: string, calculated: number): number {
    return key in overrides ? overrides[key] : calculated;
  }

  function startEdit(key: string, currentValue: number) {
    setEditingKey(key);
    setEditValue(String(currentValue));
    setResetPopoverKey(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditValue("");
  }

  function saveEdit(key: string, raw: string) {
    const num = parseFloat(raw);
    if (isNaN(num)) { cancelEdit(); return; }
    queryClient.setQueryData<{ overrides: Array<{ metricKey: string; value: number }> }>(
      ["kpi-overrides", periodKey],
      (old) => ({
        overrides: [
          ...(old?.overrides ?? []).filter(o => o.metricKey !== key),
          { metricKey: key, value: num },
        ],
      })
    );
    setEditingKey(null);
    setEditValue("");
    fetch("/api/kpi/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metricKey: key, period: periodKey, value: num }),
    }).catch(console.error);
  }

  function resetOverride(key: string) {
    queryClient.setQueryData<{ overrides: Array<{ metricKey: string; value: number }> }>(
      ["kpi-overrides", periodKey],
      (old) => ({ overrides: (old?.overrides ?? []).filter(o => o.metricKey !== key) })
    );
    setResetPopoverKey(null);
    fetch("/api/kpi/overrides", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metricKey: key, period: periodKey }),
    }).catch(console.error);
  }

  // ── Card order helpers ──

  function saveCardOrder(section: "evergreen" | "northstar", order: string[]) {
    fetch("/api/kpi/card-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: order.map((key, i) => ({ section, cardKey: key, position: i })),
      }),
    }).catch(console.error);
  }

  function handleDragStart(e: DragStartEvent, section: "evergreen" | "northstar") {
    setActiveDragInfo({ id: String(e.active.id), section });
    setResetPopoverKey(null);
  }

  function handleDragEnd(e: DragEndEvent, section: "evergreen" | "northstar") {
    setActiveDragInfo(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const isEg = section === "evergreen";
    const order = isEg ? evergreenOrder : northStarOrder;
    const setter = isEg ? setEvergreenOrder : setNorthStarOrder;
    const oldIdx = order.indexOf(String(active.id));
    const newIdx = order.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const newOrder = arrayMove(order, oldIdx, newIdx);
    setter(newOrder);
    saveCardOrder(section, newOrder);
  }

  // ── Card props builder ──

  function getCardProps(key: string): MetricCardProps & { calculatedValue: number } {
    // Live computed metrics — use rv() so manual overrides on any input propagate automatically
    const resolvedCash            = rv("cash-collected",   data.hero.cashCollected);
    const resolvedSpend           = rv("ad-spend",         data.hero.adSpend);
    const resolvedProcessingFees  = rv("processing-fees",  data.detail.processingFees);
    const resolvedAdsMgmt         = rv("ads-mgmt",         data.detail.adsMgmt);
    const resolvedSoftwareCost    = rv("software-cost",    data.detail.softwareCost);
    const resolvedTeamFulfillment = rv("team-fulfillment", data.detail.teamFulfillment);
    const liveRoas       = resolvedSpend > 0 ? parseFloat((resolvedCash / resolvedSpend).toFixed(2)) : 0;
    const liveNetProfit  = parseFloat((resolvedCash - resolvedSpend - resolvedProcessingFees - resolvedAdsMgmt - resolvedSoftwareCost - resolvedTeamFulfillment).toFixed(2));

    const configs: Record<string, MetricCardProps & { calculatedValue: number }> = {
      // Evergreen
      "cash-collected": { label: "Cash Collected", calculatedValue: data.hero.cashCollected, value: rv("cash-collected", data.hero.cashCollected), target: data.hero.cashTarget, format: "currency", sparkline: sl.cashCollected, tooltip: "Total revenue collected from clients this period" },
      "ad-spend": { label: "Ad Spend", calculatedValue: data.hero.adSpend, value: rv("ad-spend", data.hero.adSpend), target: data.hero.adSpendTarget, format: "currency", higherIsBetter: false, live: true, loading: adsFetching, sparkline: sl.adSpend, tooltip: "Total Facebook/Instagram ad spend. Live from Meta Ads API." },
      "roas": { label: "ROAS", calculatedValue: liveRoas, value: rv("roas", liveRoas), target: data.hero.roasTarget, format: "x", sparkline: sl.roas, tooltip: "Return on Ad Spend = Cash Collected ÷ Ad Spend" },
      "processing-fees": { label: "Processing Fees", calculatedValue: data.detail.processingFees, value: rv("processing-fees", data.detail.processingFees), format: "currency", sparkline: [], tooltip: "Payment processing fees (Stripe, etc.)" },
      "ads-mgmt": { label: "Ads Management", calculatedValue: data.detail.adsMgmt, value: rv("ads-mgmt", data.detail.adsMgmt), format: "currency", sparkline: [], tooltip: "Cost of managing Facebook/Instagram ad accounts" },
      "software-cost": { label: "Software Cost", calculatedValue: data.detail.softwareCost, value: rv("software-cost", data.detail.softwareCost), format: "currency", sparkline: [], tooltip: "SaaS tools, subscriptions, and software used this period" },
      "team-fulfillment": { label: "Team Fulfillment", calculatedValue: data.detail.teamFulfillment, value: rv("team-fulfillment", data.detail.teamFulfillment), format: "currency", sparkline: [], tooltip: "Contractor and team payout costs for the period" },
      "net-profit": { label: "Net Profit", calculatedValue: liveNetProfit, value: rv("net-profit", liveNetProfit), format: "currency", accent: true, sparkline: [], tooltip: "Net Profit = Cash Collected − Ad Spend − Processing Fees − Ads Management − Software Cost − Team Fulfillment" },
      // North Star
      "leads-generated": { label: "Leads Generated", calculatedValue: data.hero.leads, value: rv("leads-generated", data.hero.leads), target: data.hero.leadsTarget, live: true, loading: adsFetching, sparkline: sl.leads, tooltip: "Total leads = Meta form submissions + Facebook comment leads matching active keywords" },
      "cost-per-lead": { label: "Cost Per Lead", calculatedValue: data.detail.cpl, value: rv("cost-per-lead", data.detail.cpl), target: data.detail.cplTarget, format: "currency", higherIsBetter: false, subtext: "FB Form", live: true, loading: adsFetching, sparkline: sl.cpl, tooltip: "CPL = Ad Spend ÷ Total Leads (Meta form leads + comment leads)" },
      "booked-calls": { label: "Booked Calls", calculatedValue: data.detail.bookedCalls, value: rv("booked-calls", data.detail.bookedCalls), target: data.detail.bookedCallsTarget, live: true, sparkline: sl.bookedCalls, tooltip: 'Appointments in the "Email Design Demo | Intro Call" calendar during this period. Live from GHL.' },
      "cost-per-booked-call": { label: "Cost Per Booked Call", calculatedValue: data.detail.cpbc, value: rv("cost-per-booked-call", data.detail.cpbc), target: data.detail.cpbcTarget, format: "currency", higherIsBetter: false, live: true, sparkline: sl.cpbc, tooltip: "CPBC = Ad Spend ÷ Booked Calls" },
      "show-rate": { label: "Show-up Rate", calculatedValue: data.detail.showRate, value: rv("show-rate", data.detail.showRate), target: data.detail.showRateTarget, format: "percent", sparkline: sl.showRate, tooltip: "Show-up Rate = Calls Attended ÷ Booked Calls × 100" },
      "no-show-calls": { label: "No-Show Calls", calculatedValue: data.detail.noShowCalls, value: rv("no-show-calls", data.detail.noShowCalls), target: data.detail.noShowCallsTarget, higherIsBetter: false, live: true, sparkline: [], tooltip: 'Opportunities that entered the "Intro Call (No-Show)" stage in GHL during this period. Live from GHL.' },
      "audits-completed": { label: "Audits Completed", calculatedValue: data.detail.audits, value: rv("audits-completed", data.detail.audits), target: data.detail.auditsTarget, sparkline: [], tooltip: "Email audits completed and delivered to prospects this period" },
      "email-demos-started": { label: "Email Demos Started", calculatedValue: data.detail.emailDemosStarted, value: rv("email-demos-started", data.detail.emailDemosStarted), target: data.detail.emailDemosStartedTarget, live: true, sparkline: sl.emailDemos, tooltip: "Tasks that entered Copy status in the DEMOS board in ClickUp. Live from ClickUp API." },
      "email-demo-conv-rate": { label: "Email Demo Conv. Rate", calculatedValue: data.detail.emailConversionRate, value: rv("email-demo-conv-rate", data.detail.emailConversionRate), target: data.detail.emailConversionRateTarget, format: "percent", subtext: "Leads → Starting Demo", live: true, sparkline: [], tooltip: "Conv. Rate = Email Demos Started ÷ Total Leads × 100" },
      "deals-closed": { label: "Deals Closed", calculatedValue: data.hero.dealsClosed, value: rv("deals-closed", data.hero.dealsClosed), target: data.hero.dealsClosedTarget, sparkline: sl.dealsClosed, tooltip: "Number of new clients signed this period" },
      "new-mrr": { label: "New MRR", calculatedValue: data.detail.newMRR, value: rv("new-mrr", data.detail.newMRR), target: data.detail.newMRRTarget, format: "currency", sparkline: [], tooltip: "New Monthly Recurring Revenue added from deals closed this period" },
      "is-dtc": { label: "Is DTC", calculatedValue: dtcCount, value: rv("is-dtc", dtcCount), sparkline: [], tooltip: "Total leads in the pipeline whose website was identified as a DTC / ecommerce brand. Populated as you browse the pipeline page." },
    };
    return configs[key] ?? { label: key, value: 0, calculatedValue: 0 };
  }

  // ── Shared props for a sortable card ──

  function cardInteractionProps(key: string, props: MetricCardProps & { calculatedValue: number }) {
    return {
      isEditing: editingKey === key,
      editValue: editingKey === key ? editValue : "",
      onEditValueChange: setEditValue,
      onEdit: () => startEdit(key, props.value),
      onCancelEdit: cancelEdit,
      onSaveEdit: (v: string) => saveEdit(key, v),
      isOverridden: key in overrides,
      onResetOverride: () => setResetPopoverKey(key),
      onConfirmReset: () => resetOverride(key),
      resetPopoverOpen: resetPopoverKey === key,
      onCloseResetPopover: () => setResetPopoverKey(null),
      editingAny: editingKey !== null,
    };
  }

  const PERIODS: { key: Period; label: string }[] = [
    { key: "weekly", label: "Weekly" },
    { key: "monthly", label: "Monthly" },
    { key: "quarterly", label: "Quarterly" },
  ];

  function handlePeriodChange(p: Period) {
    setPeriod(p);
    setRefDate(today);
    setEditingKey(null);
  }

  const isDragging = activeDragInfo !== null;

  return (
    <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
      {/* Global cursor during drag */}
      {isDragging && <style>{`html * { cursor: grabbing !important; }`}</style>}

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>KPIs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Email Design Demo Pipeline</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <div className="flex items-center bg-muted rounded-lg p-1">
            {PERIODS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handlePeriodChange(key)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  period === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-card border border-border rounded-lg px-1 py-1">
            <button
              onClick={() => setRefDate(navigatePeriod(period, refDate, -1))}
              className="p-1 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Previous period"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-medium text-foreground px-2 min-w-[160px] text-center whitespace-nowrap">
              {periodLabel}
            </span>
            <button
              onClick={() => setRefDate(navigatePeriod(period, refDate, 1))}
              className="p-1 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Next period"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {!isCurrent && (
              <button
                onClick={() => setRefDate(today)}
                className="ml-1 px-2 py-0.5 text-[10px] font-medium rounded-[5px] bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                Today
              </button>
            )}
          </div>
        </div>
      </div>

      <>
        {/* ── Hero strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {(["cash-collected", "net-profit", "leads-generated", "roas", "deals-closed", "ad-spend"] as const).map((key) => {
            const heroIconMap: Record<string, React.ElementType> = {
              "cash-collected": DollarSign, "net-profit": TrendingUp,
              "leads-generated": Users, "roas": Zap,
              "deals-closed": Target, "ad-spend": ArrowUpRight,
            };
            const heroTargetMap: Record<string, number | undefined> = {
              "cash-collected": data.hero.cashTarget, "net-profit": undefined,
              "leads-generated": data.hero.leadsTarget, "roas": data.hero.roasTarget,
              "deals-closed": data.hero.dealsClosedTarget, "ad-spend": data.hero.adSpendTarget,
            };
            const heroFormatMap: Record<string, "currency" | "number" | "percent" | "x"> = {
              "cash-collected": "currency", "net-profit": "currency",
              "leads-generated": "number", "roas": "x",
              "deals-closed": "number", "ad-spend": "currency",
            };
            const heroHiBMap: Record<string, boolean> = {
              "cash-collected": true, "net-profit": true,
              "leads-generated": true, "roas": true,
              "deals-closed": true, "ad-spend": false,
            };
            const heroLiveMap: Record<string, boolean> = {
              "leads-generated": true, "ad-spend": true,
            };
            const props = getCardProps(key);
            return (
              <HeroCard
                key={key}
                label={props.label}
                value={props.value}
                target={heroTargetMap[key]}
                icon={heroIconMap[key]}
                format={heroFormatMap[key]}
                higherIsBetter={heroHiBMap[key]}
                live={heroLiveMap[key]}
                loading={heroLiveMap[key] ? adsFetching : undefined}
                isOverridden={key in overrides}
                onResetOverride={() => setResetPopoverKey(`hero:${key}`)}
                onConfirmReset={() => resetOverride(key)}
                resetPopoverOpen={resetPopoverKey === `hero:${key}`}
                onCloseResetPopover={() => setResetPopoverKey(null)}
              />
            );
          })}
        </div>

        {/* ── Evergreen Metrics ── */}
        <div>
          <SectionLabel label="Evergreen Metrics" color="blue" dimmed={activeDragInfo?.section === "northstar"} />
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e) => handleDragStart(e, "evergreen")}
            onDragEnd={(e) => handleDragEnd(e, "evergreen")}
            onDragCancel={() => setActiveDragInfo(null)}
          >
            <SortableContext items={evergreenOrder} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 mt-3">
                {evergreenOrder.map((key) => {
                  const props = getCardProps(key);
                  return (
                    <SortableMetricCard
                      key={key}
                      cardKey={key}
                      {...props}
                      {...cardInteractionProps(key, props)}
                    />
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.25, 1, 0.5, 1)" }}>
              {activeDragInfo?.section === "evergreen" && (
                <div style={{ transform: "scale(1.02)", boxShadow: "0 16px 48px rgba(0,0,0,0.12)", borderRadius: "10px" }}>
                  <MetricCard {...getCardProps(activeDragInfo.id)} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>

        {/* ── North Star Metrics ── */}
        <div>
          <SectionLabel label="North Star Metrics" color="green" dimmed={activeDragInfo?.section === "evergreen"} />
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e) => handleDragStart(e, "northstar")}
            onDragEnd={(e) => handleDragEnd(e, "northstar")}
            onDragCancel={() => setActiveDragInfo(null)}
          >
            <SortableContext items={northStarOrder} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 mt-3">
                {northStarOrder.map((key) => {
                  const props = getCardProps(key);
                  return (
                    <SortableMetricCard
                      key={key}
                      cardKey={key}
                      {...props}
                      {...cardInteractionProps(key, props)}
                    />
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.25, 1, 0.5, 1)" }}>
              {activeDragInfo?.section === "northstar" && (
                <div style={{ transform: "scale(1.02)", boxShadow: "0 16px 48px rgba(0,0,0,0.12)", borderRadius: "10px" }}>
                  <MetricCard {...getCardProps(activeDragInfo.id)} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>

        {/* ── Breakdown table ── */}
        {(period === "monthly" || period === "quarterly") && data.subRows.length > 0 && (
          <div className="bg-card border border-border rounded-[10px] p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4" style={{ fontFamily: "var(--font-heading)" }}>
              {getSubPeriodLabel(period)} — {periodLabel}
            </h2>
            <BreakdownTable subRows={data.subRows} period={period} />
          </div>
        )}

        {/* ── Deals Closed ── */}
        <div className="bg-card border border-border rounded-[10px] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Deals Closed</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
              {data.deals.length} client{data.deals.length !== 1 ? "s" : ""}
            </span>
          </div>
          <DealsTable deals={data.deals} />
        </div>

        {/* ── Demos Started ── */}
        <div className="bg-card border border-border rounded-[10px] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Demos Started</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
              {demosListData?.demos.length ?? "—"} demo{demosListData && demosListData.demos.length !== 1 ? "s" : ""}
            </span>
          </div>
          <DemosStartedTable demos={demosListData?.demos ?? []} isLoading={demosListData === undefined} />
        </div>

        {/* ── Charts ── */}
        {data.chartData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-[10px] p-5">
              <h2 className="text-sm font-semibold text-foreground mb-0.5" style={{ fontFamily: "var(--font-heading)" }}>Cash vs Ad Spend</h2>
              <p className="text-xs text-muted-foreground mb-4">
                {period === "quarterly" ? "Month by month" : "Week by week"} comparison
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="cashCollected" name="Cash Collected" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="adSpend" name="Ad Spend" fill="var(--muted-foreground)" opacity={0.45} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border rounded-[10px] p-5">
              <h2 className="text-sm font-semibold text-foreground mb-0.5" style={{ fontFamily: "var(--font-heading)" }}>Lead Generation</h2>
              <p className="text-xs text-muted-foreground mb-4">Leads generated and cost per lead</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="leads" name="Leads" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="cpl" name="CPL ($)" fill="#f59e0b" opacity={0.7} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border rounded-[10px] p-5">
              <h2 className="text-sm font-semibold text-foreground mb-0.5" style={{ fontFamily: "var(--font-heading)" }}>Cash by Deal</h2>
              <p className="text-xs text-muted-foreground mb-4">Cash collected per closed client</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.deals.map(d => ({ name: d.client, value: d.cashCollected }))} layout="vertical" barSize={16}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={88} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                  <Bar dataKey="value" name="Cash Collected" radius={[0, 4, 4, 0]}>
                    {data.deals.map((d, i) => <Cell key={i} fill="var(--primary)" opacity={d.cashCollected >= 3000 ? 1 : 0.55} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border rounded-[10px] p-5 flex flex-col justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-0.5" style={{ fontFamily: "var(--font-heading)" }}>Net Profit Summary</h2>
                <p className="text-xs text-muted-foreground mb-6">{periodLabel}</p>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cash Collected</span>
                  <span className="font-semibold text-foreground">{fmtCurrency(getCardProps("cash-collected").value)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Costs</span>
                  <span className="font-semibold text-rose-600">-{fmtCurrency(getCardProps("ad-spend").value + getCardProps("processing-fees").value + getCardProps("ads-mgmt").value + getCardProps("software-cost").value + getCardProps("team-fulfillment").value)}</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between">
                  <span className="text-base font-bold text-foreground">Net Profit</span>
                  <span className={cn("text-xl font-bold", getCardProps("net-profit").value >= 0 ? "text-emerald-600" : "text-rose-600")} style={{ fontFamily: "var(--font-heading)" }}>
                    {getCardProps("net-profit").value < 0 ? "-" : ""}{fmtCurrency(getCardProps("net-profit").value)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </>

      <div className="h-4" />
    </div>
  );
}
