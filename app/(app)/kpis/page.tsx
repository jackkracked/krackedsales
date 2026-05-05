import { KpisClient } from "@/components/kpis/kpis-client";

export const metadata = { title: "KPIs — Kracked Sales" };

export default function KpisPage() {
  return (
    <div className="h-full overflow-y-auto">
      <KpisClient />
    </div>
  );
}
