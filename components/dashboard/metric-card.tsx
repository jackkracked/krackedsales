import { cn } from "@/lib/utils/cn";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: { value: string; direction: "up" | "down" | "flat" };
  accent?: "default" | "gold" | "green";
}

export function MetricCard({ label, value, subtitle, trend, accent = "default" }: MetricCardProps) {
  const TrendIcon = trend?.direction === "up"
    ? TrendingUp
    : trend?.direction === "down"
    ? TrendingDown
    : Minus;

  const trendColor = trend?.direction === "up"
    ? "text-accent-green"
    : trend?.direction === "down"
    ? "text-destructive"
    : "text-muted-foreground";

  const valueColor = accent === "gold"
    ? "text-gold"
    : accent === "green"
    ? "text-accent-green"
    : "text-foreground";

  return (
    <div className="bg-card border border-border rounded-[10px] p-4 flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p
        className={cn("text-2xl font-bold leading-none", valueColor)}
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {value}
      </p>
      <div className="flex items-center gap-2">
        {trend && (
          <span className={cn("flex items-center gap-0.5 text-xs font-medium", trendColor)}>
            <TrendIcon className="w-3 h-3" />
            {trend.value}
          </span>
        )}
        {subtitle && (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>
    </div>
  );
}
