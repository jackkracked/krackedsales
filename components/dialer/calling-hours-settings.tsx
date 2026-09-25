"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, RotateCcw, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/untitled/base/buttons/button";
import { Toggle } from "@/components/untitled/base/toggle/toggle";
import { Badge } from "@/components/untitled/base/badges/badges";
import {
  REGIONS, REGION_LABELS, STATUTORY,
  type CallingHoursConfig, type Region, type RegionHours, type Window,
} from "@/lib/dialer/calling-hours";
import { cn } from "@/lib/utils/cn";

/**
 * When the dialer warns that it is an unsociable hour where the prospect is.
 *
 * WHY THE LAW IS THE DEFAULT AND THE SCREEN SAYS SO
 * These windows are statutory, not preferences: the US TCPA, Canada's CRTC and Australia's
 * ACMA. An admin may widen or narrow them, but they should know when they have stepped away
 * from the rule, so every region that has been changed is labelled and can be put back in one
 * click. An untouched install is already compliant.
 *
 * Times are always the PROSPECT'S local time, never the rep's. That is the whole point of the
 * warning and the screen repeats it rather than assuming it is obvious.
 */

const DAYS = [
  { key: "weekday" as const, label: "Monday to Friday" },
  { key: "saturday" as const, label: "Saturday" },
  { key: "sunday" as const, label: "Sunday" },
];

/** Half-hour steps. 8 → "8:00am", 21.5 → "9:30pm". */
const STEPS = Array.from({ length: 49 }, (_, i) => i / 2);
function label(v: number): string {
  if (v === 24) return "midnight";
  const whole = Math.floor(v);
  const mins = v % 1 ? "30" : "00";
  const suffix = whole < 12 ? "am" : "pm";
  const base = whole === 0 ? 12 : whole <= 12 ? whole : whole - 12;
  return `${base}:${mins}${suffix}`;
}

const same = (a: Window, b: Window) =>
  a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1];
const sameRegion = (a: RegionHours, b: RegionHours) =>
  same(a.weekday, b.weekday) && same(a.saturday, b.saturday) && same(a.sunday, b.sunday);

function TimeSelect({ value, onChange, ariaLabel }: { value: number; onChange: (v: number) => void; ariaLabel: string }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(
        "h-9 rounded-[8px] border border-border bg-card px-2.5 text-[13px] font-medium text-foreground tabular-nums",
        "transition-colors hover:bg-muted/50",
        "focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20",
      )}
    >
      {STEPS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
    </select>
  );
}

function DayRow({ day, window: w, onChange, region }: {
  day: (typeof DAYS)[number];
  window: Window;
  onChange: (w: Window) => void;
  /** Named in every control's label: five identical "Saturday opens" are unusable by voice
   *  control or a screen reader, because nothing says which country they belong to. */
  region: string;
}) {
  const allowed = w !== null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <span className="w-[140px] shrink-0 text-[13px] text-muted-foreground">{day.label}</span>
      <Toggle
        size="sm"
        isSelected={allowed}
        // Turning a day off is how Australia's Sunday ban is expressed, so it has to be
        // reachable rather than a special case buried in code.
        onChange={(on: boolean) => onChange(on ? [9, 17] : null)}
        aria-label={`${region}: allow calling on ${day.label}`}
      />
      {allowed ? (
        <div className="flex items-center gap-2">
          {/* Only the end being edited moves. The first version dragged the OTHER end to keep
              the window valid, which quietly widened Canada's open from 9:00 to 8:30 — earlier
              than the law allows — at a moment the admin was narrowing the close. It could also
              produce 24.5 or -0.5, which are not in the list, blanking a select and failing the
              save with no explanation. */}
          <TimeSelect
            value={w[0]}
            ariaLabel={`${region}: ${day.label} opens`}
            onChange={(v) => onChange([Math.min(v, 23.5), Math.max(Math.min(v, 23.5) + 0.5, w[1])])}
          />
          <span className="text-[13px] text-muted-foreground">to</span>
          <TimeSelect
            value={w[1]}
            ariaLabel={`${region}: ${day.label} closes`}
            onChange={(v) => onChange([Math.min(w[0], Math.max(v, 0.5) - 0.5), Math.max(v, 0.5)])}
          />
        </div>
      ) : (
        <span className="text-[13px] font-medium text-muted-foreground">No calling</span>
      )}
    </div>
  );
}

export function CallingHoursSettings() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<{ callingHours: CallingHoursConfig }>({
    queryKey: ["calling-hours"],
    queryFn: async () => {
      const res = await fetch("/api/settings/calling-hours");
      // An expired session answers 401 with a JSON error body. Parsed blindly, that produced
      // `callingHours: undefined` and the page threw inside the seeding effect.
      if (!res.ok) throw new Error("Could not load the calling hours");
      return res.json();
    },
  });

  const [draft, setDraft] = useState<CallingHoursConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!data?.callingHours || draft) return;
    // Every region starts from what is actually in force, so the screen never shows a blank.
    const seeded: CallingHoursConfig = {};
    for (const r of REGIONS) seeded[r] = data.callingHours[r] ?? STATUTORY[r];
    setDraft(seeded);
  }, [data, draft]);

  const dirty = useMemo(() => {
    if (!draft || !data) return false;
    return REGIONS.some((r) => !sameRegion(draft[r]!, data.callingHours?.[r] ?? STATUTORY[r]));
  }, [draft, data]);

  const save = useMutation({
    mutationFn: async (config: CallingHoursConfig) => {
      const send = (allowDisabling: boolean) =>
        fetch("/api/settings/calling-hours", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callingHours: config, allowDisabling }),
        });

      let res = await send(false);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        // A midnight-to-midnight window does not widen the warning, it switches it off for that
        // day. The server refuses it until someone says out loud that they mean it.
        if (payload.needsConfirmation) {
          const go = window.confirm(
            `${payload.error}\n\nSetting a day to midnight-to-midnight means the dialer will never warn on that day, ` +
            `however late or early the call is. Continue?`,
          );
          if (!go) throw new Error("Nothing was changed.");
          res = await send(true);
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save");
          return res.json();
        }
        throw new Error(payload.error ?? "Could not save");
      }
      return res.json();
    },
    onSuccess: () => { setError(null); setSavedAt(Date.now()); qc.invalidateQueries({ queryKey: ["calling-hours"] }); },
    onError: (e: Error) => setError(e.message),
  });

  const setDay = (region: Region, day: keyof RegionHours, w: Window) =>
    setDraft((d) => (d ? { ...d, [region]: { ...d[region]!, [day]: w } } : d));

  return (
    <section className="rounded-[12px] border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            <Clock className="h-4 w-4" /> Calling hours
          </h2>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            When the dialer warns before connecting a call. Times are the{" "}
            <span className="font-medium text-foreground">prospect&rsquo;s</span> local time, worked
            out from their number. It only ever warns, never blocks.
          </p>
        </div>
        {dirty && (
          <Button
            size="sm"
            color="primary"
            isLoading={save.isPending}
            showTextWhileLoading
            onClick={() => draft && save.mutate(draft)}
          >
            Save changes
          </Button>
        )}
        {!dirty && savedAt && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 border-b border-border bg-muted/40 px-5 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[13px] text-foreground">{error}</p>
        </div>
      )}

      {isError ? (
        <div className="flex flex-wrap items-center gap-3 px-5 py-6">
          <p className="text-[13px] text-foreground">
            These settings could not be loaded. The dialer is still using the legal defaults.
          </p>
          <Button size="sm" color="secondary" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : isLoading || !draft ? (
        <div role="status" aria-busy="true" className="space-y-4 px-5 py-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
              <div className="h-9 w-full animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {REGIONS.map((region) => {
            const hours = draft[region]!;
            const isStatutory = sameRegion(hours, STATUTORY[region]);
            return (
              <div key={region} className="px-5 py-4">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-foreground">{REGION_LABELS[region]}</h3>
                  {isStatutory ? (
                    <Badge size="sm" color="gray">Legal default</Badge>
                  ) : (
                    <>
                      <Badge size="sm" color="warning">Changed</Badge>
                      <button
                        onClick={() => setDraft((d) => (d ? { ...d, [region]: STATUTORY[region] } : d))}
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <RotateCcw className="h-3 w-3" /> Reset
                      </button>
                    </>
                  )}
                </div>
                <div className="divide-y divide-border/60">
                  {DAYS.map((day) => (
                    <DayRow key={day.key} day={day} region={REGION_LABELS[region]} window={hours[day.key]} onChange={(w) => setDay(region, day.key, w)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
