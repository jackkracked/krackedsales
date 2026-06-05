"use client";

import { useState, useMemo, useCallback } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  format,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  subDays,
  addDays,
  isSameDay,
  isWithinInterval,
  eachDayOfInterval,
  getDay,
  getDaysInMonth,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DateRangePickerProps {
  value: { start: string; end: string; preset?: string } | null;
  onChange: (range: { start: string; end: string; preset?: string }) => void;
  className?: string;
}

interface Preset {
  label: string;
  key: string;
  range: () => { start: Date; end: Date };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toYMD = (d: Date) => format(d, "yyyy-MM-dd");
const parseYMD = (s: string) => new Date(s + "T12:00:00");
const td = () => startOfDay(new Date());

const PRESETS: Preset[] = [
  { label: "Today", key: "today", range: () => ({ start: td(), end: addDays(td(), 1) }) },
  { label: "Yesterday", key: "yesterday", range: () => ({ start: subDays(td(), 1), end: td() }) },
  { label: "Last 7 Days", key: "7d", range: () => ({ start: subDays(td(), 7), end: addDays(td(), 1) }) },
  { label: "Last 30 Days", key: "30d", range: () => ({ start: subDays(td(), 30), end: addDays(td(), 1) }) },
  { label: "Week to Date", key: "wtd", range: () => ({ start: startOfWeek(td(), { weekStartsOn: 1 }), end: addDays(td(), 1) }) },
  { label: "Month to Date", key: "mtd", range: () => ({ start: startOfMonth(td()), end: addDays(td(), 1) }) },
  { label: "Year to Date", key: "ytd", range: () => ({ start: startOfYear(td()), end: addDays(td(), 1) }) },
];

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatTriggerLabel(value: DateRangePickerProps["value"], tz: string): string {
  if (!value) return "Select dates";
  if (value.preset) {
    const match = PRESETS.find((p) => p.key === value.preset);
    if (match) return match.label;
  }
  const start = parseYMD(value.start);
  const end = subDays(parseYMD(value.end), 1);
  if (isSameDay(start, end)) return format(toZonedDate(start, tz), "MMM d, yyyy");
  return `${format(toZonedDate(start, tz), "MMM d")} – ${format(toZonedDate(end, tz), "MMM d, yyyy")}`;
}

// ─── Custom Calendar ─────────────────────────────────────────────────────────

function MiniCalendar({
  year,
  month,
  rangeStart,
  rangeEnd,
  onDayClick,
}: {
  year: number;
  month: number; // 0-indexed
  rangeStart: Date | null;
  rangeEnd: Date | null;
  onDayClick: (d: Date) => void;
}) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = getDaysInMonth(firstDay);
  // Monday = 0, Sunday = 6
  const startDow = (getDay(firstDay) + 6) % 7;

  const days: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));

  const isToday = (d: Date) => isSameDay(d, new Date());
  const isStart = (d: Date) => rangeStart && isSameDay(d, rangeStart);
  const isEnd = (d: Date) => rangeEnd && isSameDay(d, rangeEnd);
  const inRange = (d: Date) => {
    if (!rangeStart || !rangeEnd) return false;
    const s = rangeStart < rangeEnd ? rangeStart : rangeEnd;
    const e = rangeStart < rangeEnd ? rangeEnd : rangeStart;
    return isWithinInterval(d, { start: s, end: e });
  };

  return (
    <div className="w-[252px]">
      <p className="text-sm font-semibold text-foreground text-center mb-2" style={{ fontFamily: "var(--font-heading)" }}>
        {MONTHS[month]} {year}
      </p>
      <div className="grid grid-cols-7 gap-0">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="h-8 flex items-center justify-center text-[11px] font-medium text-muted-foreground/60">
            {wd}
          </div>
        ))}
        {days.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="h-8" />;
          const start = isStart(day);
          const end = isEnd(day);
          const mid = inRange(day) && !start && !end;
          const t = isToday(day);

          return (
            <button
              key={day.getDate()}
              onClick={() => onDayClick(day)}
              className={cn(
                "h-8 flex items-center justify-center text-sm transition-colors relative",
                // Range middle
                mid && "bg-primary/8",
                // Range start
                start && "bg-primary text-primary-foreground rounded-l-md font-semibold",
                // Range end
                end && "bg-primary text-primary-foreground rounded-r-md font-semibold",
                // Both start and end (single day)
                start && end && "rounded-md",
                // Today indicator
                t && !start && !end && "font-bold text-primary",
                // Default
                !start && !end && !mid && "hover:bg-muted/60 rounded-md",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const tz = useUserTimezone();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [clickCount, setClickCount] = useState(0);
  const [activePreset, setActivePreset] = useState<string | undefined>(value?.preset);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  const handleOpenChange = useCallback((next: boolean) => {
    if (next && value) {
      const s = parseYMD(value.start);
      const e = subDays(parseYMD(value.end), 1);
      setRangeStart(s);
      setRangeEnd(e);
      setActivePreset(value.preset);
      setMode(value.preset ? "preset" : "custom");
      setCalMonth(s.getMonth());
      setCalYear(s.getFullYear());
      setClickCount(2);
    }
    setOpen(next);
  }, [value]);

  const handlePresetClick = useCallback((preset: Preset) => {
    const { start, end } = preset.range();
    setRangeStart(start);
    setRangeEnd(subDays(end, 1));
    setActivePreset(preset.key);
    onChange({ start: toYMD(start), end: toYMD(end), preset: preset.key });
    setOpen(false);
  }, [onChange]);

  const handleDayClick = useCallback((d: Date) => {
    setActivePreset(undefined);
    setMode("custom");
    if (clickCount === 0 || clickCount === 2) {
      setRangeStart(d);
      setRangeEnd(null);
      setClickCount(1);
    } else {
      setRangeEnd(d);
      setClickCount(2);
    }
  }, [clickCount]);

  const handleApply = useCallback(() => {
    if (rangeStart && rangeEnd) {
      const s = rangeStart < rangeEnd ? rangeStart : rangeEnd;
      const e = rangeStart < rangeEnd ? rangeEnd : rangeStart;
      onChange({ start: toYMD(s), end: toYMD(addDays(e, 1)) });
      setOpen(false);
    }
  }, [rangeStart, rangeEnd, onChange]);

  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
    else setCalMonth(calMonth - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
    else setCalMonth(calMonth + 1);
  };

  const month2 = calMonth === 11 ? 0 : calMonth + 1;
  const year2 = calMonth === 11 ? calYear + 1 : calYear;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button className={cn(
          "border border-border rounded-[8px] px-3 py-1.5 text-sm font-medium bg-card hover:bg-muted/50 flex items-center gap-2 transition-colors",
          className,
        )}>
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{formatTriggerLabel(value, tz)}</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 bg-card border border-border rounded-[10px] shadow-xl"
        >
          <div className="flex">
            {/* Presets sidebar */}
            <div className="w-[160px] border-r border-border py-2 flex flex-col">
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => handlePresetClick(preset)}
                  className={cn(
                    "w-full text-left px-4 py-1.5 text-[13px] transition-colors",
                    activePreset === preset.key
                      ? "bg-primary/8 text-primary font-semibold"
                      : "text-foreground/70 hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {preset.label}
                </button>
              ))}
              <div className="mx-4 my-1.5 border-t border-border" />
              <button
                onClick={() => { setMode("custom"); setActivePreset(undefined); }}
                className={cn(
                  "w-full text-left px-4 py-1.5 text-[13px] transition-colors",
                  mode === "custom" && !activePreset
                    ? "bg-primary/8 text-primary font-semibold"
                    : "text-foreground/70 hover:bg-muted/50 hover:text-foreground",
                )}
              >
                Custom
              </button>
            </div>

            {/* Calendar panel */}
            <div className="p-4 flex flex-col gap-3">
              {/* Date display */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">Start</p>
                  <div className="border border-border rounded-[6px] px-2.5 py-1.5 text-xs font-medium bg-muted/20">
                    {rangeStart ? format(toZonedDate(rangeStart, tz), "MMM d, yyyy") : "—"}
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">End</p>
                  <div className="border border-border rounded-[6px] px-2.5 py-1.5 text-xs font-medium bg-muted/20">
                    {rangeEnd ? format(toZonedDate(rangeEnd, tz), "MMM d, yyyy") : "—"}
                  </div>
                </div>
              </div>

              {/* Two calendars with nav */}
              <div className="flex items-start gap-6">
                <div className="relative">
                  <button onClick={prevMonth} className="absolute -left-1 top-0 w-6 h-6 flex items-center justify-center rounded-md hover:bg-muted/50 text-muted-foreground">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <MiniCalendar year={calYear} month={calMonth} rangeStart={rangeStart} rangeEnd={rangeEnd} onDayClick={handleDayClick} />
                </div>
                <div className="relative">
                  <button onClick={nextMonth} className="absolute -right-1 top-0 w-6 h-6 flex items-center justify-center rounded-md hover:bg-muted/50 text-muted-foreground">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <MiniCalendar year={year2} month={month2} rangeStart={rangeStart} rangeEnd={rangeEnd} onDayClick={handleDayClick} />
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs font-medium border border-border rounded-[6px] hover:bg-muted/50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  disabled={!rangeStart || !rangeEnd}
                  className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-[6px] hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
