import { format } from "date-fns";
import { getHours } from "date-fns";

function getGreeting(): string {
  const h = getHours(new Date());
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-[10px] bg-muted/60 ${className ?? ""}`} />
  );
}

export default function DashboardLoading() {
  const today = format(new Date(), "EEEE, d MMMM yyyy");

  return (
    <div className="flex flex-col h-full p-6 gap-5 overflow-y-auto">
      {/* Page header */}
      <div>
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {getGreeting()}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{today}</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px]" />
        ))}
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px_260px] gap-5">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>

      {/* AI Copilot */}
      <div className="flex-1 min-h-[320px]">
        <Skeleton className="h-full min-h-[320px]" />
      </div>
    </div>
  );
}
