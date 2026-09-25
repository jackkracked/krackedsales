import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  // Gate by the same permission that shows the sidebar link, so a non-admin can't deep-link into
  // the (admin) Team tab. Respects the toggle rather than hardcoding role.
  const user = await getSessionUser().catch(() => null);
  if (!user) redirect("/login");
  if (!(await can(user.id, user.role, "manage_settings"))) redirect("/dashboard");

  return (
    <div className="h-full overflow-y-auto flex flex-col">
      <ScrollToTop />
      <SettingsTabs />
    </div>
  );
}
