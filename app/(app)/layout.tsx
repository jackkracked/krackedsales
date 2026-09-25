import { QueryProvider } from "@/providers/query-provider";
import { PusherProvider } from "@/providers/pusher-provider";
import { DialerProvider } from "@/providers/dialer-provider";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileHeader } from "@/components/layout/mobile-header";
import { CopilotProvider } from "@/lib/copilot/context";
import { CopilotFAB } from "@/components/copilot/copilot-fab";
import { TimezoneDetector } from "@/components/layout/timezone-detector";
import { TimezoneProvider } from "@/providers/timezone-provider";
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import { getSessionUser } from "@/lib/auth/session";
import { getUserPermissions } from "@/lib/auth/permissions";
import { resolveRolePreset } from "@/lib/auth/permission-constants";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser().catch(() => null);
  // Resolve the user's sidebar visibility once (role preset + per-user overrides) so the nav
  // reflects their role. On a lookup error, fail CLOSED to the plain role preset (never leaks
  // admin links to a non-admin).
  const permissions = user
    ? await getUserPermissions(user.id, user.role).catch(() => resolveRolePreset(user.role))
    : null;

  return (
    <QueryProvider>
      <TimezoneProvider>
      <CopilotProvider>
        <div className="flex h-full">
          {/* Desktop sidebar */}
          <Sidebar userRole={user?.role} permissions={permissions ?? undefined} />

          {/* Main content area */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            {/* Mobile top bar */}
            <MobileHeader permissions={permissions ?? undefined} />

            {/* Page content — wrapped in PusherProvider so it has QueryClient access */}
            <PusherProvider>
              {/* DialerProvider holds the live Twilio call at the app root so a call
                  survives navigation (persistent mini call-bar + incoming toast). */}
              <DialerProvider userEmail={user?.email}>
                {/* overflow-hidden: each page manages its own scrolling */}
                <main className="flex-1 min-h-0 overflow-hidden">
                  <ScrollToTop />
                  {children}
                </main>
              </DialerProvider>
            </PusherProvider>
          </div>
        </div>

        {/* The co-pilot FAB is DISABLED (Jack, 2026-08-07): nobody used it, and being fixed to
            the bottom-right corner it sat on top of the Leads pager's Next button — a control
            that rendered, was enabled, and could not be clicked, which read as "there is only
            one page". The provider stays mounted so anything reading copilot context still
            works; only the floating button is gone. Re-enable by restoring <CopilotFAB />. */}
        {/* <CopilotFAB /> */}

        {/* Timezone auto-detection — shows modal if browser TZ differs from stored */}
        <TimezoneDetector />

        {/* Admin-only r10n theme toggle. Rendered for admins only, fixed-position,
            so it never appears for reps and never affects anyone's layout. */}
        {/* r10n theme toggle retired 2026-08-25: r10n is now the only theme, applied
            unconditionally in app/layout.tsx. Component kept for a quick revert. */}
      </CopilotProvider>
      </TimezoneProvider>
    </QueryProvider>
  );
}
