import { startOfDay, startOfWeek, startOfMonth, subDays } from "date-fns";

export type TimeRange = "today" | "week" | "month" | "30d" | "90d" | "all";

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "30d", label: "Last 30d" },
  { value: "90d", label: "Last 90d" },
  { value: "all", label: "All time" },
];

/** Returns the start Date for the given range, or null for "all time". */
export function getTimeRangeStart(range: TimeRange): Date | null {
  const now = new Date();
  switch (range) {
    case "today":  return startOfDay(now);
    case "week":   return startOfWeek(now, { weekStartsOn: 1 });
    case "month":  return startOfMonth(now);
    case "30d":    return subDays(now, 30);
    case "90d":    return subDays(now, 90);
    case "all":    return null;
  }
}
