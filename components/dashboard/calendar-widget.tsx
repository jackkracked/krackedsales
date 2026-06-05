"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Calendar } from "lucide-react";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import { CalendarEventModal } from "./calendar-event-modal";
import type { GHLCalendarEvent } from "@/lib/ghl/types";

interface CalendarWidgetProps {
  events: GHLCalendarEvent[];
}

function formatEventTime(iso: string, tz: string) {
  try { return format(toZonedDate(parseISO(iso), tz), "d MMM 'at' HH:mm"); } catch { return iso; }
}

export function CalendarWidget({ events }: CalendarWidgetProps) {
  const tz = useUserTimezone();
  const [selected, setSelected] = useState<GHLCalendarEvent | null>(null);

  return (
    <>
      <div className="bg-card border border-border rounded-[10px] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <h3
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Today&apos;s Calendar
          </h3>
        </div>

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No events today</p>
        ) : (
          <div className="space-y-1">
            {events.slice(0, 5).map((event) => (
              <button
                key={event.id}
                onClick={() => setSelected(event)}
                className="w-full text-left flex items-start gap-3 py-2 px-2 -mx-2 rounded-[6px] hover:bg-muted/30 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {event.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatEventTime(event.startTime, tz)}
                    {event.contactName && ` · ${event.contactName}`}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <CalendarEventModal
          event={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
