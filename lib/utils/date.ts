import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";

/** Format a timestamp for inbox message display */
export function formatMessageTime(date: Date | string): string {
  const d = new Date(date);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "dd MMM");
}

/** Format a Unix millisecond timestamp from ClickUp */
export function fromClickUpTimestamp(ms: string | number): Date {
  return new Date(typeof ms === "string" ? parseInt(ms, 10) : ms);
}

/** How many days ago from now */
export function daysAgo(date: Date | string): number {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/** Friendly relative time string: "3 days ago", "2 hours ago" */
export function relativeTime(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

/** Format for display: "7 Apr 2026" */
export function formatDate(date: Date | string): string {
  return format(new Date(date), "d MMM yyyy");
}

/** Format full datetime: "7 Apr 2026 at 14:30" */
export function formatDateTime(date: Date | string): string {
  return format(new Date(date), "d MMM yyyy 'at' HH:mm");
}
