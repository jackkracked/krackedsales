import { formatDateTime } from "@/lib/utils/date";
import { Calendar } from "lucide-react";
import type { GHLCalendarEvent } from "@/lib/ghl/types";

interface CalendarWidgetProps {
  events: GHLCalendarEvent[];
}

export function CalendarWidget({ events }: CalendarWidgetProps) {
  return (
    <div className="bg-card border border-border rounded-[10px] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Today&apos;s Calendar
        </h3>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No events today</p>
      ) : (
        <div className="space-y-2">
          {events.slice(0, 5).map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 py-2 border-l-2 border-primary pl-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{event.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(event.startTime)}
                  {event.contactName && ` — ${event.contactName}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
