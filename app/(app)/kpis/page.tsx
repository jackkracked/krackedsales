import { KpisClient } from "@/components/kpis/kpis-client";
import { ScrollToTop } from "@/components/layout/scroll-to-top";

export const metadata = { title: "KPIs — Kracked Sales" };

// Render per-request so the default date range reflects the current day,
// not a date frozen into a static build.
export const dynamic = "force-dynamic";

export default function KpisPage() {
  return (
    <div className="h-full overflow-y-auto">
      <ScrollToTop />
      <KpisClient />
    </div>
  );
}
