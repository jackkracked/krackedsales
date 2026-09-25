import { KpiHealthClient } from "@/components/kpis/health/kpi-health-client";
import { getSessionUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const metadata = { title: "KPI Health — Kracked Sales" };

export default async function KpiHealthPage() {
  // Money/KPI surface — admins only (matches /kpis and /money).
  const user = await getSessionUser().catch(() => null);
  if (user?.role !== "admin") redirect("/dashboard");
  return <KpiHealthClient />;
}
