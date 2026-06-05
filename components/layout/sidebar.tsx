"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { useUIStore } from "@/store/ui-store";
import {
  LayoutDashboard,
  GitMerge,
  MessageSquare,
  BarChart3,
  Send,
  TrendingUp,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Layers,
  Settings2,
  Target,
  Users,
  Phone,
  CalendarDays,
  ListTodo,
  FileText,
  Activity,
  Workflow,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { NotificationBell } from "@/components/layout/notification-bell";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard",  label: "Dashboard", icon: LayoutDashboard },
      { href: "/pipeline",   label: "Pipeline",  icon: GitMerge },
      { href: "/contacts",   label: "Contacts",  icon: Users },
      { href: "/proposals",  label: "Proposals", icon: FileText },
      { href: "/calls",      label: "Calls",     icon: Phone },
      { href: "/calendar",   label: "Calendar",  icon: CalendarDays },
      { href: "/tasks",      label: "Tasks",     icon: ListTodo },
      { href: "/inbox",      label: "Inbox",     icon: MessageSquare },
    ],
  },
  {
    label: "Measure",
    items: [
      { href: "/kpis",         label: "KPIs",          icon: Target },
      { href: "/demo-tracker", label: "Demo Tracker",   icon: BarChart3 },
      { href: "/analytics",    label: "Analytics",      icon: TrendingUp },
      { href: "/activity",     label: "Activity",       icon: Activity, adminOnly: true },
    ],
  },
  {
    label: "Automate",
    items: [
      { href: "/workflows",  label: "Workflows",  icon: Workflow },
      { href: "/follow-ups", label: "Follow-ups", icon: Send },
      { href: "/templates",  label: "Templates",  icon: Layers },
    ],
  },
];

interface SidebarProps {
  userRole?: string;
}

export function Sidebar({ userRole }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebarCollapsed } = useUIStore();
  const isAdmin = userRole === "admin";

  const { data: fathomStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["fathom-status"],
    queryFn: () => fetch("/api/fathom/status").then((r) => r.json()),
    staleTime: 60_000,
  });
  const showFathomDot = fathomStatus?.connected === false;

  // Unread inbox count for badge
  const { data: awaitingData } = useQuery<{ contactIds: string[] }>({
    queryKey: ["pipeline-awaiting-reply"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/conversations/awaiting-reply");
      if (!res.ok) return { contactIds: [] };
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
  const inboxUnreadCount = awaitingData?.contactIds?.length ?? 0;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col h-full shrink-0 transition-all duration-200 ease-in-out border-r border-border",
        sidebarCollapsed ? "w-12" : "w-52"
      )}
      style={{ backgroundColor: "var(--sidebar)" }}
    >
      {/* Logo + collapse toggle */}
      <div className={cn("flex items-center h-12 border-b border-border shrink-0", sidebarCollapsed ? "justify-center px-0" : "px-3 gap-2")}>
        {sidebarCollapsed ? (
          /* Collapsed: K mark doubles as expand button */
          <button
            onClick={toggleSidebarCollapsed}
            aria-label="Expand sidebar"
            className="group flex items-center justify-center rounded-[7px] bg-primary text-primary-foreground select-none transition-colors hover:bg-primary/80"
            style={{ width: 26, height: 26 }}
          >
            <span
              className="group-hover:hidden font-black"
              style={{ fontFamily: "var(--font-heading)", fontSize: 15, letterSpacing: "-0.04em" }}
            >
              K
            </span>
            <PanelLeftOpen className="hidden group-hover:block w-3.5 h-3.5" />
          </button>
        ) : (
          <>
            {/* Expanded: K is a dashboard link */}
            <Link href="/dashboard" className="shrink-0" aria-label="Kracked Sales">
              <span
                className="flex items-center justify-center rounded-[7px] bg-primary text-primary-foreground font-black tracking-tighter select-none"
                style={{ width: 26, height: 26, fontFamily: "var(--font-heading)", fontSize: 15, letterSpacing: "-0.04em" }}
              >
                K
              </span>
            </Link>
            <span
              className="text-sm font-bold text-primary tracking-tight whitespace-nowrap overflow-hidden max-w-[140px] opacity-100 transition-all duration-200 ease-in-out"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Kracked Sales
            </span>
            <div className="flex items-center gap-0.5 ml-auto">
              <NotificationBell />
              <button
                onClick={toggleSidebarCollapsed}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-1.5 py-2 overflow-y-auto">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} className={si > 0 ? "mt-4" : ""}>
            {/* Section label — hidden when collapsed */}
            {section.label && (
              <span
                className={cn(
                  "block px-2 mb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50 whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out",
                  sidebarCollapsed ? "max-w-0 opacity-0" : "max-w-[160px] opacity-100"
                )}
              >
                {section.label}
              </span>
            )}
            <div className="space-y-px">
              {section.items.filter((item) => !item.adminOnly || isAdmin).map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    title={sidebarCollapsed ? label : undefined}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center px-2 py-1.5 rounded-md text-[13px] font-medium transition-colors duration-100",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground/70 hover:text-foreground hover:bg-border/50",
                    )}
                  >
                    <span className="relative shrink-0">
                      <Icon className="w-3.5 h-3.5" />
                      {label === "Inbox" && inboxUnreadCount > 0 && sidebarCollapsed && (
                        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-red-500 text-white text-[8px] font-bold px-0.5">
                          {inboxUnreadCount}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out flex-1",
                        sidebarCollapsed
                          ? "max-w-0 opacity-0 ml-0"
                          : "max-w-[160px] opacity-100 ml-2.5"
                      )}
                    >
                      {label}
                    </span>
                    {label === "Inbox" && inboxUnreadCount > 0 && !sidebarCollapsed && (
                      <span className={cn(
                        "min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1 ml-auto shrink-0",
                        isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-red-500 text-white"
                      )}>
                        {inboxUnreadCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Settings + Log out */}
      <div className="px-1.5 py-2 border-t border-border shrink-0">
        <Link
          href="/settings"
          title={sidebarCollapsed ? "Settings" : undefined}
          className={cn(
            "flex items-center px-2 py-1.5 rounded-md text-[13px] font-medium transition-colors duration-100 mb-px",
            pathname === "/settings" || pathname.startsWith("/settings/")
              ? "bg-primary text-primary-foreground"
              : "text-foreground/70 hover:text-foreground hover:bg-border/50"
          )}
        >
          <span className="relative shrink-0">
            <Settings2 className="w-3.5 h-3.5" />
            {showFathomDot && sidebarCollapsed && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-destructive rounded-full" />
            )}
          </span>
          <span className={cn("whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out", sidebarCollapsed ? "max-w-0 opacity-0 ml-0" : "max-w-[160px] opacity-100 ml-2.5")}>
            Settings
            {showFathomDot && !sidebarCollapsed && (
              <span className="inline-block w-2 h-2 bg-destructive rounded-full ml-1.5 align-middle" />
            )}
          </span>
        </Link>
        <button
          onClick={handleLogout}
          title={sidebarCollapsed ? "Log out" : undefined}
          className="flex items-center px-2 py-1.5 w-full rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-border/50 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          <span
            className={cn(
              "whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out",
              sidebarCollapsed
                ? "max-w-0 opacity-0 ml-0"
                : "max-w-[160px] opacity-100 ml-2.5"
            )}
          >
            Log out
          </span>
        </button>
      </div>
    </aside>
  );
}
