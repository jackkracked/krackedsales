"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface GhlCalendar { id: string; name: string }

/**
 * Calls-page calendar allowlist. Tick the calendars whose Meet calls should show
 * on the Calls page; leave all unticked to show every calendar. Hides internal
 * calls (e.g. team 1:1s) that sit on calendars you don't select.
 */
export function CallCalendarsSettings() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: calData, isLoading } = useQuery<{ calendars: GhlCalendar[] }>({
    queryKey: ["ghl-calendars"],
    queryFn: () => fetch("/api/calendar/ghl-calendars").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });
  const calendars = calData?.calendars ?? [];

  const { data: settingsData } = useQuery<{ allowedCalendarIds: string[] }>({
    queryKey: ["call-settings"],
    queryFn: () => fetch("/api/settings/call-settings").then((r) => r.json()),
  });

  // Seed the selection from saved settings (and after a save reconciles).
  useEffect(() => {
    if (settingsData?.allowedCalendarIds && !dirty) setSelected(new Set(settingsData.allowedCalendarIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsData]);

  const save = useMutation({
    mutationFn: () =>
      fetch("/api/settings/call-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedCalendarIds: [...selected] }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["call-settings"] });
      qc.invalidateQueries({ queryKey: ["calls"] });
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
    setDirty(true);
    setSaved(false);
  }

  return (
    <div data-r10n-settings-card className="rounded-[10px] border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <CalendarCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Calls page: which calendars show</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Tick the calendars whose Meet calls should appear on the Calls page. Leave all unticked to show every calendar. Dialer calls always show.
      </p>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-[8px] bg-muted/50" />)}</div>
      ) : calendars.length === 0 ? (
        <p className="text-xs text-muted-foreground">No calendars found.</p>
      ) : (
        <div className="space-y-1.5">
          {calendars.map((c) => {
            const on = selected.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[8px] border px-3 py-2 text-left transition-colors",
                  on ? "border-primary/40 bg-primary/[0.06]" : "border-border hover:bg-muted/40",
                )}
              >
                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="text-[13px] text-foreground">{c.name}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="flex items-center gap-1.5 rounded-[8px] bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
        >
          {save.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
        {saved && <span className="text-[12px] font-medium text-emerald-600">Saved</span>}
        {selected.size > 0 && <span className="text-[11.5px] text-muted-foreground">{selected.size} calendar{selected.size === 1 ? "" : "s"} selected</span>}
      </div>
    </div>
  );
}
