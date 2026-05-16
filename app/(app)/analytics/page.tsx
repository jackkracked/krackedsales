import { AnalyticsClient } from "@/components/analytics/analytics-client";
import { ScrollToTop } from "@/components/layout/scroll-to-top";

export const metadata = { title: "Analytics — Kracked Sales" };

export default function AnalyticsPage() {
  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <ScrollToTop />
      <div>
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Full breakdown of your demo pipeline performance
        </p>
      </div>
      <AnalyticsClient />
    </div>
  );
}
