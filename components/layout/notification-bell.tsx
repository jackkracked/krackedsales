"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Pusher from "pusher-js";
import { Bell, X, Check, CheckCheck, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/date";

interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  readAt?: string | null;
  createdAt: string;
}

const TYPE_ICON: Record<string, string> = {
  new_lead:          "🧲",
  call_soon:         "📞",
  deal_cold:         "🥶",
  followup_overdue:  "⏰",
  ab_winner:         "🏆",
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Fetch notifications ─────────────────────────────────────────────────────
  const { data } = useQuery<{ notifications: Notification[]; unreadCount: number }>({
    queryKey: ["notifications"],
    queryFn: () => fetch("/api/notifications").then((r) => r.json()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  // ── Real-time Pusher subscription ──────────────────────────────────────────
  const { data: me } = useQuery<{ id: string; role: string }>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/me").then((r) => r.json()),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!me?.id) return;
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
    if (!pusherKey || !pusherCluster) return;

    const pusher = new Pusher(pusherKey, { cluster: pusherCluster });
    const channel = pusher.subscribe(`notifications-${me.id}`);
    channel.bind("notification", () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });
    return () => {
      pusher.unsubscribe(`notifications-${me.id}`);
      pusher.disconnect();
    };
  }, [me?.id, queryClient]);

  // ── Mark individual as read ─────────────────────────────────────────────────
  const markRead = useMutation({
    mutationFn: (ids: string[]) =>
      fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => fetch("/api/notifications/read-all", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // ── Close on outside click ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = useCallback(() => {
    setOpen((v) => !v);
    const unreadIds = notifications.filter((n) => !n.readAt).map((n) => n.id);
    if (unreadIds.length > 0) markRead.mutate(unreadIds);
  }, [notifications, markRead]);

  return (
    <div className="relative" ref={containerRef}>
      {/* Bell button — icon only */}
      <button
        onClick={handleOpen}
        title="Notifications"
        className={cn(
          "relative flex items-center justify-center w-7 h-7 rounded-md transition-colors",
          open
            ? "bg-border/60 text-foreground"
            : "text-foreground/60 hover:text-foreground hover:bg-border/50"
        )}
      >
        <Bell className="w-3.5 h-3.5" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-[2px] leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Panel — solid background, drops below */}
      {open && (
        <div
          className="absolute z-50 top-full mt-2 left-0 w-80 rounded-[10px] border border-border shadow-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", color: "var(--card-foreground)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border" style={{ backgroundColor: "var(--card)" }}>
            <span className="text-[13px] font-semibold">Notifications</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  title="Mark all read"
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto" style={{ backgroundColor: "var(--card)" }}>
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <Check className="w-5 h-5 text-emerald-500" />
                <p className="text-xs text-muted-foreground">All caught up</p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onClose={() => setOpen(false)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification: n,
  onClose,
}: {
  notification: Notification;
  onClose: () => void;
}) {
  const isUnread = !n.readAt;
  const icon = TYPE_ICON[n.type] ?? "🔔";

  const inner = (
    <div
      className={cn(
        "px-3 py-2.5 flex items-start gap-2.5 border-b border-border/50 last:border-0 transition-colors",
        isUnread ? "bg-primary/[0.04]" : "",
        n.href ? "hover:bg-muted/40 cursor-pointer" : ""
      )}
    >
      <span className="text-base shrink-0 leading-none mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-[13px] leading-snug line-clamp-2", isUnread ? "font-semibold" : "font-medium text-foreground/80")}>
            {n.title}
          </p>
          {n.href && <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground/50 mt-0.5" />}
        </div>
        {n.body && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
        )}
        <p className="text-[11px] text-muted-foreground/60 mt-1">{relativeTime(n.createdAt)}</p>
      </div>
      {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1.5" />}
    </div>
  );

  if (n.href) {
    return <a href={n.href} onClick={onClose} className="block no-underline">{inner}</a>;
  }
  return <div>{inner}</div>;
}
