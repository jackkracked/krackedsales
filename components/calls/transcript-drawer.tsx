"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/date";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TranscriptEntry {
  speaker: string;
  text: string;
}

interface TranscriptData {
  callId: string;
  contactName: string | null;
  repName: string | null;
  startedAt: string;
  smartNotesUrl?: string;
  entries: TranscriptEntry[];
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export function TranscriptDrawer({ callId, onClose }: TranscriptDrawerProps) {
  const isOpen = callId !== null;
  const drawerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<TranscriptData>({
    queryKey: ["call-transcript", callId],
    queryFn: () => fetch(`/api/calls/${callId}/transcript`).then((r) => r.json()),
    enabled: isOpen,
  });

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
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity duration-200",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-[480px] max-w-[90vw] bg-card border-l border-border shadow-xl",
          "flex flex-col transition-transform duration-250 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        aria-label="Call transcript"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {isLoading ? "Loading…" : data?.contactName ?? "Unknown Contact"}
            </p>
            {!isLoading && data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.repName ?? "—"} &middot; {formatDateTime(data.startedAt)}
              </p>
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

        {/* Smart notes link */}
        {!isLoading && data?.smartNotesUrl && (
          <div className="px-5 py-2.5 border-b border-border shrink-0 bg-muted/30">
            <a
              href={data.smartNotesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              View Smart Notes
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-1.5" style={{ animationDelay: `${i * 50}ms` }}>
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
              <p className="text-sm font-medium text-foreground mb-1">No transcript available</p>
              <p className="text-xs text-muted-foreground">
                This call does not have a transcript attached.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {data.entries.map((entry, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn("w-2 h-2 rounded-full shrink-0", speakerColor(entry.speaker))}
                    />
                    <span className="text-sm font-medium text-foreground">{entry.speaker}</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed pl-3.5">
                    {entry.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
