"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronDown } from "lucide-react";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import { cn } from "@/lib/utils/cn";

interface SummaryData {
  summary: {
    content: string;
    weekStart: string;
    generatedAt: string;
  } | null;
}

const COLLAPSED_KEY = "weekly-summary-collapsed";

export function WeeklySummaryDigest() {
  const tz = useUserTimezone();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "true");
    } catch {}
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch {}
  }

  const { data, isPending, isError } = useQuery<SummaryData>({
    queryKey: ["weekly-summary"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/weekly-summary");
      if (!res.ok) throw new Error(`weekly-summary ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 2,
  });

  const summary = data?.summary;

  const weekLabel = summary
    ? formatWeekLabel(summary.weekStart, tz)
    : null;

  return (
    <div className="bg-card border border-border rounded-[10px] overflow-hidden">
      <button
        onClick={toggleCollapsed}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Weekly Summary
          </h3>
          {weekLabel && (
            <span className="text-[11px] text-muted-foreground">
              {weekLabel}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform duration-200",
            collapsed && "-rotate-90"
          )}
        />
      </button>

      {!collapsed && (
        <div className="px-5 pb-4 -mt-1">
          {isPending ? (
            <div className="space-y-2">
              <div className="h-3.5 bg-muted/60 rounded animate-pulse w-full" />
              <div className="h-3.5 bg-muted/60 rounded animate-pulse w-[90%]" />
              <div className="h-3.5 bg-muted/60 rounded animate-pulse w-[75%]" />
            </div>
          ) : summary ? (
            <p className="text-sm text-foreground/85 leading-relaxed max-w-[75ch]">
              {summary.content}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Summary unavailable this week.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatWeekLabel(weekStartIso: string, tz: string): string {
  const start = new Date(weekStartIso);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${format(toZonedDate(start, tz), "MMM d")} – ${format(toZonedDate(end, tz), "MMM d")}`;
}
