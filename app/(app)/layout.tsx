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
import { R10nThemeToggle } from "@/components/system/r10n-theme-toggle";
import { getSessionUser } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser().catch(() => null);

  return (
    <QueryProvider>
      <TimezoneProvider>
      <CopilotProvider>
        <div className="flex h-full">
          {/* Desktop sidebar */}
          <Sidebar userRole={user?.role} />

          {/* Main content area */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            {/* Mobile top bar */}
            <MobileHeader />

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

        {/* Global AI co-pilot — floats on every page */}
        <CopilotFAB />

        {/* Timezone auto-detection — shows modal if browser TZ differs from stored */}
        <TimezoneDetector />

        {/* Admin-only r10n theme toggle. Rendered for admins only, fixed-position,
            so it never appears for reps and never affects anyone's layout. */}
        {user?.role === "admin" && <R10nThemeToggle />}
      </CopilotProvider>
      </TimezoneProvider>
    </QueryProvider>
  );
}
