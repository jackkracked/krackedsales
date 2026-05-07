import { CalendarClient } from "@/components/calendar/calendar-client";

export const metadata = { title: "Calendar — Kracked Sales" };

export default function CalendarPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <CalendarClient />
    </div>
  );
}
