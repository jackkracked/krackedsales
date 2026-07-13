import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { KpisClient } from "@/components/kpis/kpis-client";
import { ScrollToTop } from "@/components/layout/scroll-to-top";

export const metadata = { title: "KPIs — Kracked Sales" };

// Render per-request so the default date range reflects the current day,
// not a date frozen into a static build.
export const dynamic = "force-dynamic";

export default async function KpisPage() {
  // KPIs are admin-only. Reps get rep-level KPIs on their own dashboard and never see
  // this page — bounce them home rather than render a locked shell.
  const user = await getSessionUser().catch(() => null);
  if (user?.role !== "admin") redirect("/dashboard");

  return (
    <div className="h-full overflow-y-auto">
      <ScrollToTop />
      <KpisClient />
    </div>
  );
}
