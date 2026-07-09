"use client";

import { useQuery } from "@tanstack/react-query";
import { Eye, MousePointerClick, Mail, Send, PenLine, CreditCard, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface EngagementSummary { views: number; clicks: number; genuineOpens: number; lastAt: string | null }

function rel(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Compact engagement indicator for a proposals-list row. */
export function EngagementCell({ summary }: { summary?: EngagementSummary }) {
  const total = (summary?.views ?? 0) + (summary?.clicks ?? 0) + (summary?.genuineOpens ?? 0);
  if (!summary || total === 0) {
    return <span className="text-xs text-muted-foreground/40">Not opened</span>;
  }
  const label = summary.views > 0
    ? `Viewed${summary.views > 1 ? ` ${summary.views}×` : ""}`
    : summary.clicks > 0 ? "Clicked" : "Opened";
  const title = [
    summary.views ? `Viewed the proposal ${summary.views}×` : null,
    summary.clicks ? `Clicked the email ${summary.clicks}×` : null,
    summary.genuineOpens ? `Opened the email ${summary.genuineOpens}×` : null,
    summary.lastAt ? `Last ${rel(summary.lastAt)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <span title={title} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
      <Eye className="h-3.5 w-3.5" />
      {label}
      {summary.lastAt && <span className="font-normal text-muted-foreground">· {rel(summary.lastAt)}</span>}
    </span>
  );
}

// ── Per-prospect activity timeline (proposal detail) ──────────────────────────

interface RawEvent { type: string; classification: string | null; createdAt: string }
type Item = { key: string; label: string; at: string; kind: "sent" | "engage" | "won" };

const ICON: Record<Item["kind"], React.ElementType> = { sent: Send, engage: Eye, won: PenLine };

export function ActivityTimeline({ proposalId, sentAt, signedAt, paidAt }: {
  proposalId: string; sentAt: string | null; signedAt: string | null; paidAt: string | null;
}) {
  const { data, isLoading } = useQuery<{ events: RawEvent[] }>({
    queryKey: ["proposal-events", proposalId],
    queryFn: async () => { const r = await fetch(`/api/proposals/${proposalId}/events`); if (!r.ok) throw new Error(); return r.json(); },
  });

  const items: (Item & { icon: React.ElementType; tone: string })[] = [];
  const push = (key: string, label: string, at: string | null, kind: Item["kind"], icon: React.ElementType, tone: string) => {
    if (at) items.push({ key, label, at, kind, icon, tone });
  };

  // Email opens are pulled OUT of the ordered timeline: the pixel reports late/proxied, so
  // its timestamp is unreliable and would show "email opened" after the proposal was viewed.
  // We surface it as a separate approximate signal instead (below).
  const emailOpens = (data?.events ?? []).filter((e) => e.type === "email_opened" && e.classification === "genuine");

  push("sent", "Proposal sent", sentAt, "sent", Send, "text-muted-foreground");
  (data?.events ?? []).forEach((e, i) => {
    if (e.type === "viewed") push(`v${i}`, "Opened the proposal", e.createdAt, "engage", Eye, "text-primary");
    else if (e.type === "clicked") push(`c${i}`, "Clicked from the email", e.createdAt, "engage", MousePointerClick, "text-primary");
  });
  push("signed", "Signed", signedAt, "won", PenLine, "text-success");
  push("paid", "Paid", paidAt, "won", CreditCard, "text-success");

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()); // newest first

  // Collapse a burst of the same event (e.g. several page loads from one open) into one row.
  const grouped: (typeof items[number] & { count: number })[] = [];
  for (const it of items) {
    const prev = grouped[grouped.length - 1];
    if (prev && prev.label === it.label && Math.abs(new Date(prev.at).getTime() - new Date(it.at).getTime()) < 10 * 60_000) {
      prev.count += 1;
    } else {
      grouped.push({ ...it, count: 1 });
    }
  }

  const fmt = (iso: string) => {
    try { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
    catch { return iso; }
  };

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prospect activity</h3>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> loading…</div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">Nothing yet. Opens and clicks will show here once the proposal is sent.</p>
      ) : (
        <ol className="relative space-y-0">
          {grouped.map((it, i) => {
            const Icon = it.icon;
            const last = i === grouped.length - 1;
            return (
              <li key={it.key} className="relative flex gap-3 pb-4">
                {!last && <span className="absolute left-[13px] top-7 h-full w-px bg-border" aria-hidden />}
                <span className={cn("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card", it.tone)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 pt-1">
                  <p className="text-sm font-medium text-foreground">
                    {it.label}
                    {it.count > 1 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{it.count}×</span>}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">{fmt(it.at)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {emailOpens.length > 0 && (
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <Mail className="h-3.5 w-3.5 shrink-0" />
          <span>
            Email opened <span className="font-semibold text-foreground">{emailOpens.length}×</span>
            {" "}<span className="text-muted-foreground/70">· timing approximate</span>
          </span>
        </div>
      )}
    </div>
  );
}
