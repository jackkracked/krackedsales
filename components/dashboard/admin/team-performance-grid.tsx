"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  ghlUserId: string | null;
  targets: { dealsPerMonth: number; callsPerDay: number; revenueTarget: number } | null;
}

function UserInitials({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
      {initials || "?"}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide",
        role === "admin"
          ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground"
      )}
    >
      {role}
    </span>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full",
        active ? "bg-emerald-500" : "bg-muted-foreground/40"
      )}
      title={active ? "Active" : "Inactive"}
    />
  );
}

export function TeamPerformanceGrid() {
  const { data, isLoading } = useQuery<{ users: TeamUser[] }>({
    queryKey: ["team-settings"],
    queryFn: () => fetch("/api/settings/team").then((r) => r.json()),
    staleTime: 60 * 1000,
  });

  const users = data?.users ?? [];

  return (
    <div className="bg-card border border-border rounded-[10px] overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Team
        </h3>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Rep
            </th>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Role
            </th>
            <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Deal target
            </th>
            <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Calls / day
            </th>
            <th className="text-center px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-3" colSpan={5}>
                    <div className="h-4 bg-muted/60 rounded animate-pulse w-full" />
                  </td>
                </tr>
              ))
            : users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <UserInitials name={u.name} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate leading-tight">
                          {u.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate leading-tight">
                          {u.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm text-foreground/80">
                    {u.targets?.dealsPerMonth ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm text-foreground/80">
                    {u.targets?.callsPerDay ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusDot active={u.isActive} />
                  </td>
                </tr>
              ))}
        </tbody>
      </table>

      {!isLoading && users.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No team members yet — add them in Settings.
        </div>
      )}
    </div>
  );
}
