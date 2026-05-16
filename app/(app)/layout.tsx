import { QueryProvider } from "@/providers/query-provider";
import { PusherProvider } from "@/providers/pusher-provider";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileHeader } from "@/components/layout/mobile-header";
import { CopilotProvider } from "@/lib/copilot/context";
import { CopilotFAB } from "@/components/copilot/copilot-fab";
import { getSessionUser } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser().catch(() => null);

  return (
    <QueryProvider>
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
              {/* overflow-hidden: each page manages its own scrolling */}
              <main className="flex-1 min-h-0 overflow-hidden">
                {children}
              </main>
            </PusherProvider>
          </div>
        </div>

        {/* Global AI co-pilot — floats on every page */}
        <CopilotFAB />
      </CopilotProvider>
    </QueryProvider>
  );
}
