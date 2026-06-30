"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Video, Phone, ArrowUp, ArrowDown, PlayCircle, Captions, ChevronRight, PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/date";
import { outcomeMeta, OUTCOME_TONES } from "@/lib/activity/outcomes";
import { CallDetailModal } from "@/components/calls/call-detail-modal";
import type { Call } from "@/components/calls/calls-client";

type CallRow = Call & { outcome: string | null; notes: string | null };

function fmtDuration(s: number | null): string | null {
  if (!s || s <= 0) return null;
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m` : `${s}s`;
}

function CallRowCard({ call, onOpen }: { call: CallRow; onOpen: () => void }) {
  const isMeet = call.callType === "meet";
  const hasRecording = !!(call.recordingAvailable || call.fathomRecordingId || call.fathomShareUrl);
  const tone = call.outcome ? OUTCOME_TONES[outcomeMeta(call.outcome).tone] : null;
  const duration = fmtDuration(call.durationSeconds);

  return (
    <button
      onClick={onOpen}
      className="group w-full text-left rounded-[12px] border border-border/70 bg-card hover:border-primary/30 hover:shadow-[0_2px_12px_rgba(28,35,51,0.06)] transition-all px-3.5 py-3 flex items-start gap-3"
    >
      {/* icon */}
      <span className={cn(
        "mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0",
        isMeet ? "bg-emerald-50 text-emerald-600" : call.direction === "inbound" ? "bg-blue-50 text-blue-600" : "bg-primary/10 text-primary"
      )}>
        {isMeet ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[13px] font-semibold text-foreground">
            {isMeet ? "Meet call" : "Dialer call"}
          </p>
          {!isMeet && call.direction && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground">
              {call.direction === "inbound" ? <ArrowDown className="w-2.5 h-2.5" /> : <ArrowUp className="w-2.5 h-2.5" />}
              {call.direction}
            </span>
          )}
          {tone && (
            <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold", tone.pill)}>
              {outcomeMeta(call.outcome!).label}
            </span>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground mt-0.5">
          {call.repName ? `${call.repName} · ` : ""}{relativeTime(call.startedAt)}{duration ? ` · ${duration}` : ""}
        </p>

        {call.notes && (
          <p className="text-[12px] text-foreground/75 mt-1.5 leading-snug line-clamp-2 whitespace-pre-wrap">{call.notes}</p>
        )}

        {(hasRecording || call.transcriptAvailable) && (
          <div className="flex items-center gap-1.5 mt-2">
            {hasRecording && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/[0.07] px-1.5 py-0.5 rounded-full">
                <PlayCircle className="w-3 h-3" /> Recording
              </span>
            )}
            {call.transcriptAvailable && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                <Captions className="w-3 h-3" /> Transcript
              </span>
            )}
          </div>
        )}
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary/60 shrink-0 mt-1 transition-colors" />
    </button>
  );
}

export function CallsTab({ contactUid }: { contactUid: string }) {
  const [selected, setSelected] = useState<Call | null>(null);

  const { data, isLoading } = useQuery<{ calls: CallRow[] }>({
    queryKey: ["contact-calls", contactUid],
    queryFn: () => fetch(`/api/contacts/${contactUid}/calls`).then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });
  const calls = data?.calls ?? [];

  if (isLoading) {
    return (
      <div className="p-4 space-y-2.5">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-16 rounded-[12px] bg-muted/60 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    );
  }

  if (!calls.length) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
        <PhoneCall className="w-8 h-8 text-border" />
        <p className="text-sm font-medium text-foreground/70">No calls logged yet</p>
        <p className="text-xs text-center max-w-52 leading-relaxed">When this lead is called, the notes and recording will show up here.</p>
      </div>
    );
  }

  return (
    <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
      {calls.map((c) => (
        <CallRowCard key={c.id} call={c} onOpen={() => setSelected(c)} />
      ))}
      <CallDetailModal call={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
