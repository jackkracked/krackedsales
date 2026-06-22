"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowUpDown, Loader2, LayoutGrid, MessageSquare } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

type BoardRow = {
  id: string;
  contactName: string;
  referenceCode: string;
  title: string | null;
  status: string;
  repName: string | null;
  designerName: string | null;
  sentChannel: string | null;
  sentAt: string | null;
  firstOpenedAt: string | null;
  bookedAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  comments: number;
};

const STAGE_META: Record<string, { label: string; cls: string }> = {
  awaiting_design: { label: "Awaiting design", cls: "bg-muted text-muted-foreground" },
  in_review: { label: "In review", cls: "bg-warning-subtle text-warning" },
  sent: { label: "Sent", cls: "bg-info-subtle text-info" },
  opened: { label: "Opened", cls: "bg-info-subtle text-info" },
  engaged: { label: "Engaged", cls: "bg-gold/15 text-gold-foreground" },
  booked: { label: "Booked", cls: "bg-success-subtle text-success" },
  closed: { label: "Closed", cls: "bg-muted text-muted-foreground" },
};

const FILTERS: { key: string; label: string; match: (b: BoardRow) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "active", label: "In flight", match: (b) => ["awaiting_design", "in_review"].includes(b.status) },
  { key: "sent", label: "Out with clients", match: (b) => ["sent", "opened", "engaged"].includes(b.status) },
  { key: "booked", label: "Booked", match: (b) => b.status === "booked" || !!b.bookedAt },
];

type SortKey = "lastActivityAt" | "contactName" | "status" | "sentAt" | "comments";

export function BoardsListClient() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("lastActivityAt");
  const [asc, setAsc] = useState(false);

  const { data, isLoading, isError } = useQuery<{ boards: BoardRow[] }>({
    queryKey: ["boards"],
    queryFn: async () => {
      const res = await fetch("/api/boards");
      if (!res.ok) throw new Error("Failed to load boards");
      return res.json();
    },
  });

  const all = data?.boards ?? [];

  const funnel = useMemo(() => {
    const sent = all.filter((b) => ["sent", "opened", "engaged", "booked", "closed"].includes(b.status)).length;
    const opened = all.filter((b) => !!b.firstOpenedAt).length;
    const booked = all.filter((b) => !!b.bookedAt).length;
    return { total: all.length, sent, opened, booked };
  }, [all]);

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
    const term = q.trim().toLowerCase();
    let list = all.filter(f.match);
    if (term) {
      list = list.filter(
        (b) =>
          b.contactName.toLowerCase().includes(term) ||
          (b.title ?? "").toLowerCase().includes(term) ||
          b.referenceCode.toLowerCase().includes(term) ||
          (b.repName ?? "").toLowerCase().includes(term),
      );
    }
    const dir = asc ? 1 : -1;
    return [...list].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sort === "contactName" || sort === "status") {
        av = a[sort];
        bv = b[sort];
      } else if (sort === "comments") {
        av = a.comments;
        bv = b.comments;
      } else {
        av = a[sort] ? new Date(a[sort] as string).getTime() : 0;
        bv = b[sort] ? new Date(b[sort] as string).getTime() : 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [all, filter, q, sort, asc]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setAsc((v) => !v);
    else {
      setSort(key);
      setAsc(key === "contactName");
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 pb-4 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">Boards</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every demo board, from first design to booked call.
            </p>
          </div>
          <FunnelStrip funnel={funnel} />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search client, rep, or ref…"
              className="w-full rounded-[10px] border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-1 rounded-[10px] bg-muted p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  filter === f.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <p className="py-10 text-center text-sm text-destructive">Couldn’t load boards.</p>
        ) : rows.length === 0 ? (
          <EmptyState hasAny={all.length > 0} />
        ) : (
          <table className="w-full border-separate border-spacing-y-1.5">
            <thead>
              <tr className="text-left text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                <Th onClick={() => toggleSort("contactName")} active={sort === "contactName"}>Client</Th>
                <Th className="hidden md:table-cell">Team</Th>
                <Th onClick={() => toggleSort("status")} active={sort === "status"}>Stage</Th>
                <Th onClick={() => toggleSort("comments")} active={sort === "comments"} className="hidden sm:table-cell">
                  <MessageSquare className="inline h-3.5 w-3.5" />
                </Th>
                <Th onClick={() => toggleSort("sentAt")} active={sort === "sentAt"} className="hidden lg:table-cell">Sent</Th>
                <Th onClick={() => toggleSort("lastActivityAt")} active={sort === "lastActivityAt"}>Last activity</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const stage = STAGE_META[b.status] ?? STAGE_META.awaiting_design;
                return (
                  <tr
                    key={b.id}
                    onClick={() => router.push(`/boards/${b.id}`)}
                    className="cursor-pointer rounded-[12px] [&>td]:border-y [&>td]:border-border [&>td]:bg-card [&>td]:transition-colors hover:[&>td]:bg-muted/50 [&>td:first-child]:rounded-l-[12px] [&>td:first-child]:border-l [&>td:last-child]:rounded-r-[12px] [&>td:last-child]:border-r"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={b.contactName} size={36} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{b.contactName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {b.title || b.referenceCode}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <div className="flex items-center gap-1.5">
                        {b.repName ? (
                          <span className="inline-flex items-center gap-1.5 text-sm text-foreground/80">
                            <Avatar name={b.repName} size={22} variant="rep" /> {b.repName}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${stage.cls}`}>
                        {stage.label}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-sm tabular-nums text-muted-foreground sm:table-cell">
                      {b.comments || ""}
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
                      {b.sentAt ? fmtDate(b.sentAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {b.lastActivityAt ? fmtRelative(b.lastActivityAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <th className={`px-4 pb-1 font-medium ${className}`}>
      {onClick ? (
        <button
          onClick={onClick}
          className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${active ? "text-foreground" : ""}`}
        >
          {children}
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function FunnelStrip({ funnel }: { funnel: { total: number; sent: number; opened: number; booked: number } }) {
  const items = [
    { label: "Total", value: funnel.total },
    { label: "Sent", value: funnel.sent },
    { label: "Opened", value: funnel.opened },
    { label: "Booked", value: funnel.booked, win: true },
  ];
  return (
    <div className="flex items-stretch gap-2">
      {items.map((it) => (
        <div
          key={it.label}
          className={`min-w-[68px] rounded-[12px] border px-3 py-2 ${
            it.win ? "border-success/30 bg-success-subtle" : "border-border bg-card"
          }`}
        >
          <p className={`font-heading text-xl font-semibold tabular-nums ${it.win ? "text-success" : "text-foreground"}`}>
            {it.value}
          </p>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{it.label}</p>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
        <LayoutGrid className="h-6 w-6" />
      </div>
      <p className="font-heading text-lg font-semibold text-foreground">
        {hasAny ? "No boards match" : "No boards yet"}
      </p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {hasAny
          ? "Try a different search or filter."
          : "Boards are created automatically when a demo is requested. They’ll show up here."}
      </p>
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtDate(iso);
}
