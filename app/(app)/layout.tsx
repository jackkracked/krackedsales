import { QueryProvider } from "@/providers/query-provider";
import { PusherProvider } from "@/providers/pusher-provider";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileHeader } from "@/components/layout/mobile-header";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="flex h-full">
        {/* Desktop sidebar */}
        <Sidebar />

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
    </QueryProvider>
  );
}
