"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  X,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Target,
  ShieldAlert,
  ListChecks,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/date";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TranscriptEntry {
  speaker: string;
  text: string;
  startTime?: string;
}

interface TranscriptData {
  callId: string;
  contactName: string | null;
  repName: string | null;
  startedAt: string;
  smartNotesUrl?: string | null;
  fathomSummary?: string | null;
  fathomShareUrl?: string | null;
  entries: TranscriptEntry[];
}

interface CallInsight {
  wantsText: string | null;
  objectionsText: string | null;
  nextStepsText: string | null;
  redFlagsText: string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  suggestedOutcome: string | null;
  suggestedNotes: string | null;
}

interface TranscriptDrawerProps {
  callId: string | null;
  onClose: () => void;
}

// ─── Speaker dot colors ───────────────────────────────────────────────────────

const SPEAKER_COLORS = [
  "bg-violet-500",
  "bg-sky-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-emerald-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-indigo-500",
];

function speakerColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return SPEAKER_COLORS[Math.abs(h) % SPEAKER_COLORS.length];
}

// ─── Sentiment badge ──────────────────────────────────────────────────────────

function SentimentBadge({
  label,
  score,
}: {
  label: string;
  score: number | null;
}) {
  const config: Record<string, { bg: string; text: string; ring: string }> = {
    positive: {
      bg: "bg-emerald-500/15",
      text: "text-emerald-600 dark:text-emerald-400",
      ring: "ring-emerald-500/25",
    },
    neutral: {
      bg: "bg-amber-500/15",
      text: "text-amber-600 dark:text-amber-400",
      ring: "ring-amber-500/25",
    },
    negative: {
      bg: "bg-rose-500/15",
      text: "text-rose-600 dark:text-rose-400",
      ring: "ring-rose-500/25",
    },
  };
  const c = config[label] ?? config.neutral;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1",
        c.bg,
        c.text,
        c.ring
      )}
    >
      {label.charAt(0).toUpperCase() + label.slice(1)}
      {score !== null && (
        <span className="opacity-60">{score}/5</span>
      )}
    </span>
  );
}

// ─── Simple markdown renderer ─────────────────────────────────────────────────

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="space-y-1.5 text-sm text-muted-foreground leading-relaxed">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;

        // Heading lines (## or ###)
        if (trimmed.startsWith("### ")) {
          return (
            <p key={i} className="text-xs font-semibold text-foreground mt-2">
              {renderInline(trimmed.slice(4))}
            </p>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <p key={i} className="text-sm font-semibold text-foreground mt-2">
              {renderInline(trimmed.slice(3))}
            </p>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <p key={i} className="text-sm font-bold text-foreground mt-2">
              {renderInline(trimmed.slice(2))}
            </p>
          );
        }

        // Bullet points
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-muted-foreground/50 shrink-0 mt-0.5">
                &bull;
              </span>
              <span>{renderInline(trimmed.slice(2))}</span>
            </div>
          );
        }

        // Numbered list
        const numMatch = trimmed.match(/^(\d+)\.\s/);
        if (numMatch) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-muted-foreground/50 shrink-0 tabular-nums mt-0.5">
                {numMatch[1]}.
              </span>
              <span>{renderInline(trimmed.slice(numMatch[0].length))}</span>
            </div>
          );
        }

        return <p key={i}>{renderInline(trimmed)}</p>;
      })}
    </div>
  );
}

/** Render bold (**text**) and italic (*text*) inline */
function renderInline(text: string): React.ReactNode {
  // Split on **bold** patterns, then handle *italic* inside each segment
  const parts: React.ReactNode[] = [];
  const boldRegex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <strong key={match.index} className="font-semibold text-foreground">
        {match[1]}
      </strong>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

// ─── Fathom summary collapsible ───────────────────────────────────────────────

function FathomSummaryCard({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false);

  // First non-empty line as preview
  const previewLine = useMemo(() => {
    const first = summary
      .split("\n")
      .find((l) => l.trim().length > 0);
    if (!first) return "AI Summary";
    const clean = first.replace(/^#+\s*/, "").trim();
    return clean.length > 120 ? clean.slice(0, 120) + "..." : clean;
  }, [summary]);

  return (
    <div className="mx-5 mb-0 mt-3 rounded-[10px] border border-border bg-muted/20 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-[10.5px] font-bold uppercase tracking-widest text-primary shrink-0">
          AI Summary
        </span>
        <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
          {!expanded && previewLine}
        </span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3.5 pb-3 border-t border-border/50">
          <div className="pt-2.5">
            <SimpleMarkdown text={summary} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Insight cards ────────────────────────────────────────────────────────────

const INSIGHT_CARDS = [
  { key: "wantsText" as const, label: "Wants", Icon: Target, color: "text-emerald-500" },
  { key: "objectionsText" as const, label: "Objections", Icon: ShieldAlert, color: "text-amber-500" },
  { key: "nextStepsText" as const, label: "Next Steps", Icon: ListChecks, color: "text-sky-500" },
  { key: "redFlagsText" as const, label: "Red Flags", Icon: AlertTriangle, color: "text-rose-500" },
] as const;

function InsightCards({ insights }: { insights: CallInsight }) {
  const cards = INSIGHT_CARDS.filter((c) => insights[c.key]);

  if (cards.length === 0) return null;

  return (
    <div className="px-5 py-3 border-b border-border shrink-0">
      <div className="grid grid-cols-2 gap-2">
        {cards.map(({ key, label, Icon, color }) => (
          <div
            key={key}
            className="rounded-[8px] border border-border/70 bg-muted/20 px-3 py-2.5 min-w-0"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
              <span className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">
                {label}
              </span>
            </div>
            <p className="text-xs text-foreground leading-relaxed line-clamp-3">
              {insights[key]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Message grouping for transcript ──────────────────────────────────────────

interface GroupedEntry {
  speaker: string;
  entries: TranscriptEntry[];
  isRep: boolean;
}

function groupTranscriptEntries(
  entries: TranscriptEntry[],
  repName: string | null
): GroupedEntry[] {
  const groups: GroupedEntry[] = [];
  const repLower = (repName ?? "").toLowerCase();

  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.speaker === entry.speaker) {
      last.entries.push(entry);
    } else {
      const isRep =
        repLower.length > 0 &&
        entry.speaker.toLowerCase().includes(repLower.split(" ")[0]);
      groups.push({
        speaker: entry.speaker,
        entries: [entry],
        isRep,
      });
    }
  }

  return groups;
}

function formatStartTime(startTime?: string): string {
  if (!startTime) return "";
  try {
    const d = new Date(startTime);
    if (isNaN(d.getTime())) return startTime;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return startTime;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function TranscriptDrawer({ callId, onClose }: TranscriptDrawerProps) {
  const isOpen = callId !== null;
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<TranscriptData>({
    queryKey: ["call-transcript", callId],
    queryFn: () =>
      fetch(`/api/calls/${callId}/transcript`).then((r) => r.json()),
    enabled: isOpen,
  });

  const { data: insightsData } = useQuery<{ insights: CallInsight | null }>({
    queryKey: ["call-insights", callId],
    queryFn: () =>
      fetch(`/api/calls/${callId}/insights`).then((r) => r.json()),
    enabled: isOpen,
  });

  const insights = insightsData?.insights ?? null;

  // Group transcript entries by consecutive speaker
  const groups = useMemo(() => {
    if (!data?.entries?.length) return [];
    return groupTranscriptEntries(data.entries, data.repName);
  }, [data?.entries, data?.repName]);

  // Auto-scroll to bottom on open / data load
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (isOpen && data && !isLoading) {
      // Small delay so DOM has rendered the entries
      const t = setTimeout(scrollToBottom, 100);
      return () => clearTimeout(t);
    }
  }, [isOpen, data, isLoading, scrollToBottom]);

  // Escape key to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity duration-200",
          isOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        )}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-[520px] max-w-[90vw] bg-card border-l border-border shadow-xl",
          "flex flex-col transition-transform duration-250 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        aria-label="Call transcript"
        role="dialog"
        aria-modal="true"
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-foreground truncate">
                {isLoading
                  ? "Loading..."
                  : data?.contactName ?? "Unknown Contact"}
              </p>
              {/* Sentiment badge */}
              {insights?.sentimentLabel && (
                <SentimentBadge
                  label={insights.sentimentLabel}
                  score={insights.sentimentScore}
                />
              )}
            </div>
            {!isLoading && data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.repName ?? "\u2014"} &middot;{" "}
                {formatDateTime(data.startedAt)}
              </p>
            )}
            {/* Action links */}
            {!isLoading && data && (
              <div className="flex items-center gap-3 mt-2">
                {data.fathomShareUrl && (
                  <a
                    href={data.fathomShareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Open in Fathom
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {data.smartNotesUrl && (
                  <a
                    href={data.smartNotesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
                  >
                    Smart Notes
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            aria-label="Close transcript"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Fathom AI Summary (collapsible) ── */}
        {!isLoading && data?.fathomSummary && (
          <FathomSummaryCard summary={data.fathomSummary} />
        )}

        {/* ── Insight cards ── */}
        {insights && <InsightCards insights={insights} />}

        {/* ── Transcript body ── */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
        >
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="space-y-1.5"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-muted animate-pulse shrink-0" />
                    <div className="h-2.5 w-20 rounded-full bg-muted animate-pulse" />
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted/60 animate-pulse" />
                  <div className="h-2 w-4/5 rounded-full bg-muted/60 animate-pulse" />
                </div>
              ))}
            </div>
          ) : !data || data.entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <p className="text-sm font-medium text-foreground mb-1">
                No transcript available
              </p>
              <p className="text-xs text-muted-foreground">
                This call does not have a transcript attached.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group, gi) => (
                <div
                  key={gi}
                  className={cn(
                    "flex flex-col",
                    group.isRep ? "items-end" : "items-start"
                  )}
                >
                  {/* Speaker label */}
                  <div
                    className={cn(
                      "flex items-center gap-1.5 mb-1",
                      group.isRep ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        speakerColor(group.speaker)
                      )}
                    />
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {group.speaker}
                    </span>
                  </div>

                  {/* Speech bubbles */}
                  {group.entries.map((entry, ei) => {
                    const isLast = ei === group.entries.length - 1;
                    return (
                      <div
                        key={ei}
                        className={cn(
                          "max-w-[85%] px-3 py-2 text-sm leading-relaxed",
                          ei === 0 ? "mt-0" : "mt-0.5",
                          group.isRep
                            ? "bg-primary/10 text-foreground"
                            : "bg-muted/40 border border-border/50 text-foreground",
                          // Bubble rounding — tail on first message
                          group.isRep
                            ? ei === 0
                              ? "rounded-[12px] rounded-tr-[3px]"
                              : isLast
                              ? "rounded-[12px] rounded-br-[3px]"
                              : "rounded-[12px]"
                            : ei === 0
                            ? "rounded-[12px] rounded-tl-[3px]"
                            : isLast
                            ? "rounded-[12px] rounded-bl-[3px]"
                            : "rounded-[12px]"
                        )}
                      >
                        {entry.text}
                      </div>
                    );
                  })}

                  {/* Timestamp on last message in group */}
                  {group.entries[group.entries.length - 1]?.startTime && (
                    <p
                      className={cn(
                        "text-[10px] text-muted-foreground/50 mt-1",
                        group.isRep ? "text-right pr-1" : "pl-1"
                      )}
                    >
                      {formatStartTime(
                        group.entries[group.entries.length - 1].startTime
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
