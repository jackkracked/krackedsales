import { getSessionUser } from "@/lib/auth/session";
import { AdminDashboard } from "@/components/dashboard/admin/admin-dashboard";
import { RepDashboard } from "@/components/dashboard/rep/rep-dashboard";

export const metadata = { title: "Dashboard — Kracked Sales" };

/**
 * This page does the minimum server-side work: one fast DB query to read the
 * session user's role. All heavy API calls (GHL, ClickUp, calendar) happen
 * client-side inside the dashboard components via useQuery, so navigation is
 * instant and the loading skeleton shows immediately.
 */
export default async function DashboardPage() {
  const user = await getSessionUser().catch(() => null);

  // Every non-admin role (rep, setter, closer) gets the scoped rep dashboard; only admins
  // see the company-wide admin dashboard. (Was `=== "rep"`, which leaked admin view to new roles.)
  if (user && user.role !== "admin") {
    return (
      <RepDashboard
        userId={user.id}
        userName={user.name}
        email={user.email}
        ghlUserId={user.ghlUserId ?? null}
      />
    );
  }

  return (
    <AdminDashboard
      userId={user?.id ?? ""}
      userName={user?.name ?? ""}
      ghlUserId={user?.ghlUserId ?? null}
    />
  );
}
