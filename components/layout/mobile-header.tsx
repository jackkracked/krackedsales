"use client";

import { usePathname, useRouter } from "next/navigation";
import { useUIStore } from "@/store/ui-store";
import { Menu, X, LogOut } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import {
  LayoutDashboard,
  GitMerge,
  MessageSquare,
  BarChart3,
  Send,
  TrendingUp,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: GitMerge },
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/demo-tracker", label: "Demo Tracker", icon: BarChart3 },
  { href: "/analytics", label: "Analytics", icon: TrendingUp },
  { href: "/follow-ups", label: "Follow-ups", icon: Send },
];

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/pipeline": "Pipeline",
  "/inbox": "Inbox",
  "/demo-tracker": "Demo Tracker",
  "/analytics": "Analytics",
  "/follow-ups": "Follow-ups",
};

export function MobileHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarOpen, setSidebarOpen } = useUIStore();

  const title = Object.entries(PAGE_TITLES).find(([key]) =>
    pathname.startsWith(key)
  )?.[1] ?? "Kracked";

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSidebarOpen(false);
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Top bar */}
      <header
        data-r10n-topbar
        className="lg:hidden flex items-center justify-between h-14 px-4 border-b border-border shrink-0"
        style={{ backgroundColor: "var(--sidebar)" }}
      >
        <button
          onClick={() => setSidebarOpen(true)}
          data-r10n-topbar-btn
          className="p-2 -ml-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span
          data-r10n-topbar-title
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {title}
        </span>
        {/* Spacer to keep title centred */}
        <div className="w-9" />
      </header>

      {/* Mobile drawer overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <nav
            data-r10n-sidebar
            className="relative z-10 flex flex-col w-64 h-full shadow-xl"
            style={{ backgroundColor: "var(--sidebar)" }}
          >
            <div className="flex items-center justify-between h-14 px-4 border-b border-border">
              <span
                data-r10n-wordmark
                className="text-base font-bold text-primary"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Kracked Sales
              </span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setSidebarOpen(false)}
                    data-r10n-navitem
                    data-active={isActive ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-border/60"
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="px-3 py-3 border-t border-border">
              <button
                onClick={handleLogout}
                data-r10n-logout
                className="flex items-center gap-2.5 px-2.5 py-2 w-full rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-border/60 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Log out</span>
              </button>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
