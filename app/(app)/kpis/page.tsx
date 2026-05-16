import { KpisClient } from "@/components/kpis/kpis-client";
import { ScrollToTop } from "@/components/layout/scroll-to-top";

export const metadata = { title: "KPIs — Kracked Sales" };

export default function KpisPage() {
  return (
    <div className="h-full overflow-y-auto">
      <ScrollToTop />
      <KpisClient />
    </div>
  );
}
