"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Search,
  X,
  RefreshCw,
  FileText,
  Volume2,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { relativeTime, formatDate } from "@/lib/utils/date";
import { Avatar } from "@/components/ui/avatar";
import { TranscriptDrawer } from "./transcript-drawer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Call {
  id: string;
  callType: "meet" | "dialer" | "scheduled";
  direction: "inbound" | "outbound" | null;
  contactId: string | null;
  contactName: string | null;
  repEmail: string | null;
  repName: string | null;
  startedAt: string;
  durationSeconds: number | null;
  status: string | null;
  transcriptAvailable: boolean;
  recordingAvailable: boolean;
  meetConferenceId?: string;
  smartNotesUrl?: string;
  fathomRecordingId?: number | null;
  fathomShareUrl?: string | null;
}

interface CallsData {
  calls: Call[];
  total: number;
  metrics: {
    totalCalls: number;
    totalTalkSeconds: number;
    avgDurationSeconds: number;
    meetingsHeld: number;
  };
}

interface UserCalendar {
  email: string;
  name: string;
}

type CallTypeFilter = "all" | "meet" | "dialer" | "scheduled";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTalkTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function formatAvgDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = String(Math.round(seconds % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function defaultSince(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return isoDate(d);
}

function defaultUntil(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return isoDate(d);
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow({ i }: { i: number }) {
  return (
    <tr className="border-b border-border/30" style={{ animationDelay: `${i * 40}ms` }}>
      {[48, 160, 120, 60, 80, 60, 56, 64].map((w, j) => (
        <td key={j} className="px-4 py-3">
          <div
            className="h-2.5 rounded-full bg-muted animate-pulse"
            style={{ width: w }}
          />
        </td>
      ))}
    </tr>
  );
}

// ─── Rep filter dropdown ──────────────────────────────────────────────────────

function RepFilterDropdown({
  reps,
  selected,
  onChange,
}: {
  reps: UserCalendar[];
  selected: string[];
  onChange: (emails: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggle(email: string) {
    if (selected.includes(email)) {
      onChange(selected.filter((e) => e !== email));
    } else {
      onChange([...selected, email]);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-[8px] border transition-colors",
          selected.length > 0
            ? "border-primary/30 bg-primary/5 text-primary"
            : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
        )}
      >
        {selected.length > 0 ? `${selected.length} rep${selected.length > 1 ? "s" : ""}` : "All reps"}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-52 bg-card border border-border rounded-[10px] shadow-lg py-1 overflow-hidden">
          {reps.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No reps found</p>
          ) : (
            <>
              {selected.length > 0 && (
                <button
                  onClick={() => onChange([])}
                  className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-b border-border/50 mb-1"
                >
                  Clear selection
                </button>
              )}
              {reps.map((rep) => {
                const checked = selected.includes(rep.email);
                return (
                  <button
                    key={rep.email}
                    onClick={() => toggle(rep.email)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted transition-colors"
                  >
                    <span
                      className={cn(
                        "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors",
                        checked ? "bg-primary border-primary" : "border-border"
                      )}
                    >
                      {checked && (
                        <svg viewBox="0 0 10 8" className="w-2.5 h-2 text-white fill-current">
                          <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{rep.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{rep.email}</p>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function CallsClient() {
  const [type, setType]                         = useState<CallTypeFilter>("all");
  const [repFilter, setRepFilter]               = useState<string[]>([]);
  const [since, setSince]                       = useState(defaultSince);
  const [until, setUntil]                       = useState(defaultUntil);
  const [search, setSearch]                     = useState("");
  const [debouncedSearch, setDebouncedSearch]   = useState("");
  const [openTranscriptCallId, setOpenTranscriptCallId] = useState<string | null>(null);
  const [syncing, setSyncing]                   = useState(false);

  const queryClient = useQueryClient();

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Build query params
  const params = new URLSearchParams();
  if (type === "meet") params.set("type", "meet,scheduled");
  else if (type !== "all") params.set("type", type);
  if (repFilter.length > 0) params.set("reps", repFilter.join(","));
  if (since) params.set("since", since);
  if (until) params.set("until", until);
  if (debouncedSearch) params.set("search", debouncedSearch);

  const { data, isLoading, isFetching } = useQuery<CallsData>({
    queryKey: ["calls", type, repFilter, since, until, debouncedSearch],
    queryFn: () => fetch(`/api/calls?${params}`).then((r) => r.json()),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: calendarsData } = useQuery<{ calendars: UserCalendar[] }>({
    queryKey: ["user-calendars"],
    queryFn: () => fetch("/api/settings/user-calendars").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });

  const calls    = data?.calls    ?? [];
  const total    = data?.total    ?? 0;
  const metrics  = data?.metrics;
  const reps     = calendarsData?.calendars ?? [];

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/api/calls/sync", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["calls"] });
    } finally {
      setSyncing(false);
    }
  }, [queryClient]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap shrink-0 border-b border-border pb-3">

        {/* Search */}
        <div className={cn("relative flex items-center transition-all duration-200", search ? "w-56" : "w-44 focus-within:w-56")}>
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full pl-8 pr-7 py-2 text-sm border border-border rounded-[8px] bg-card placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/40 transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 p-0.5 rounded text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Type toggle */}
        <div className="flex items-center gap-1 p-1 bg-muted rounded-[9px] border border-border/50">
          {(["all", "meet", "dialer"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors capitalize",
                type === t
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "all" ? "All" : t === "meet" ? "Meet" : t === "dialer" ? "Dialer" : "Meet"}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Rep filter */}
        <RepFilterDropdown reps={reps} selected={repFilter} onChange={setRepFilter} />

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="px-2.5 py-2 text-xs border border-border rounded-[8px] bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/40 transition-all"
          />
          <span className="text-xs text-muted-foreground">—</span>
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="px-2.5 py-2 text-xs border border-border rounded-[8px] bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/40 transition-all"
          />
        </div>

        {/* Sync */}
        <button
          onClick={handleSync}
          disabled={syncing}
          title="Sync calls"
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-[8px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
          Sync
        </button>

        {/* Count + fetching indicator */}
        {isFetching && !isLoading && (
          <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />
        )}
        <span className="text-sm font-medium text-foreground tabular-nums">
          {isLoading ? "—" : total.toLocaleString()}
          <span className="text-muted-foreground font-normal"> calls</span>
        </span>
      </div>

      {/* ── Metrics strip ── */}
      <div className="flex items-center shrink-0 border-b border-border pb-3 gap-0">
        {[
          {
            label: "Total calls",
            value: isLoading ? "—" : (metrics?.totalCalls ?? 0).toLocaleString(),
          },
          {
            label: "Total talk time",
            value: isLoading ? "—" : formatTalkTime(metrics?.totalTalkSeconds ?? 0),
          },
          {
            label: "Avg duration",
            value: isLoading ? "—" : formatAvgDuration(metrics?.avgDurationSeconds ?? 0),
          },
          {
            label: "Meetings held",
            value: isLoading ? "—" : (metrics?.meetingsHeld ?? 0).toLocaleString(),
          },
        ].map((stat, i, arr) => (
          <div
            key={stat.label}
            className={cn(
              "flex flex-col px-5 first:pl-0",
              i < arr.length - 1 && "border-r border-border pr-5 mr-5"
            )}
          >
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {stat.label}
            </span>
            <span className="text-xl font-bold text-foreground tabular-nums leading-snug mt-0.5">
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 min-h-0 overflow-auto rounded-[10px] border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card border-b border-border">
            <tr>
              <th className="px-4 py-3 text-left w-20 align-middle">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Type
                </span>
              </th>
              <th className="px-4 py-3 text-left min-w-[160px] align-middle">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Contact
                </span>
              </th>
              <th className="px-4 py-3 text-left min-w-[120px] align-middle">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Rep
                </span>
              </th>
              <th className="px-4 py-3 text-left w-24 align-middle">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Direction
                </span>
              </th>
              <th className="px-4 py-3 text-left w-32 align-middle">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Date
                </span>
              </th>
              <th className="px-4 py-3 text-left w-24 align-middle">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Duration
                </span>
              </th>
              <th className="px-4 py-3 text-left w-24 align-middle">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Status
                </span>
              </th>
              <th className="px-4 py-3 text-right w-20 align-middle">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Actions
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 12 }, (_, i) => <SkeletonRow key={i} i={i} />)
            ) : calls.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-20 text-center">
                  <p className="text-sm font-medium text-foreground mb-1">No calls found</p>
                  {(search || type !== "all" || repFilter.length > 0) && (
                    <p className="text-xs text-muted-foreground">
                      Try adjusting your filters or date range
                    </p>
                  )}
                </td>
              </tr>
            ) : (
              calls.map((call) => (
                <CallRow
                  key={call.id}
                  call={call}
                  onOpenTranscript={() => setOpenTranscriptCallId(call.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Transcript drawer ── */}
      <TranscriptDrawer
        callId={openTranscriptCallId}
        onClose={() => setOpenTranscriptCallId(null)}
      />
    </div>
  );
}

// ─── Call row ─────────────────────────────────────────────────────────────────

function CallRow({
  call,
  onOpenTranscript,
}: {
  call: Call;
  onOpenTranscript: () => void;
}) {
  const isFuture = new Date(call.startedAt) > new Date();
  return (
    <tr className={cn(
      "border-b border-border/30 transition-colors duration-100 hover:bg-muted/20",
      isFuture && "bg-emerald-50/30"
    )}>
      {/* Type */}
      <td className="px-4 py-3">
        <CallTypeBadge type={call.callType} />
      </td>

      {/* Contact */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={call.contactName ?? "Unknown"} size={30} />
          <span className={cn(
            "text-sm font-medium truncate max-w-[240px]",
            call.contactName ? "text-foreground" : "text-muted-foreground/50"
          )}>
            {call.contactName ?? "Unknown"}
          </span>
        </div>
      </td>

      {/* Rep */}
      <td className="px-4 py-3">
        {call.repName ? (
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground truncate max-w-[120px]">
              {call.repName}
            </p>
            {call.repEmail && (
              <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                {call.repEmail}
              </p>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground/40 text-sm">—</span>
        )}
      </td>

      {/* Direction */}
      <td className="px-4 py-3">
        <DirectionIndicator type={call.callType} direction={call.direction} />
      </td>

      {/* Date */}
      <td className="px-4 py-3">
        <span
          className={cn(
            "text-xs font-medium",
            isFuture ? "text-emerald-600" : "text-muted-foreground"
          )}
          title={formatDate(call.startedAt)}
        >
          {relativeTime(call.startedAt)}
        </span>
      </td>

      {/* Duration */}
      <td className="px-4 py-3">
        <span className="text-xs text-foreground tabular-nums font-medium">
          {formatDuration(call.durationSeconds)}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        {call.status ? (
          <AppointmentStatusBadge status={call.status} />
        ) : (
          <span className="text-muted-foreground/40 text-sm">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {/* Fathom indicator — shows when call has a Fathom transcript */}
          {call.transcriptAvailable && call.fathomRecordingId != null && (
            <span
              title="Fathom transcript available"
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700 mr-1"
            >
              F
            </span>
          )}
          <button
            onClick={call.transcriptAvailable ? onOpenTranscript : undefined}
            disabled={!call.transcriptAvailable}
            title={call.transcriptAvailable ? "View transcript" : "No transcript"}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              call.transcriptAvailable
                ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                : "text-muted-foreground/25 cursor-not-allowed"
            )}
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
          <button
            disabled={!call.recordingAvailable}
            title={call.recordingAvailable ? "Play recording" : "No recording"}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              call.recordingAvailable
                ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                : "text-muted-foreground/25 cursor-not-allowed"
            )}
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function CallTypeBadge({ type }: { type: "meet" | "dialer" | "scheduled" }) {
  if (type === "meet" || type === "scheduled") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        Meet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
      Dialer
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  upcoming:  "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  booked:    "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  confirmed: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  showed:    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  completed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  noshow:    "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  cancelled: "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200",
};

function AppointmentStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().replace(/[-_\s]/g, "");
  const style = STATUS_STYLES[normalized] ?? "bg-muted text-muted-foreground";
  const label = normalized === "noshow" ? "No-show" : status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", style)}>
      {label}
    </span>
  );
}

function DirectionIndicator({
  type,
  direction,
}: {
  type: "meet" | "dialer" | "scheduled";
  direction: "inbound" | "outbound" | null;
}) {
  if (type === "meet" || type === "scheduled" || direction === null) {
    return <span className="text-muted-foreground/40 text-sm">—</span>;
  }
  return direction === "outbound" ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
      <ArrowUp className="w-3 h-3" />
      Outbound
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
      <ArrowDown className="w-3 h-3" />
      Inbound
    </span>
  );
}
