import { startOfDay, startOfWeek, startOfMonth, subDays } from "date-fns";

export type TimeRange = "today" | "week" | "month" | "custom";

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "today", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

/** Returns the start Date for the given range, or null for custom. */
export function getTimeRangeStart(range: TimeRange): Date | null {
  const now = new Date();
  switch (range) {
    case "today":  return startOfDay(now);
    case "week":   return startOfWeek(now, { weekStartsOn: 1 });
    case "month":  return startOfMonth(now);
    case "custom": return null;
  }
}
