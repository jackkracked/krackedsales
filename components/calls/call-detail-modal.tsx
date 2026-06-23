"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
  X, Video, Phone, Clock, ArrowUp, ArrowDown, ExternalLink, StickyNote,
  ChevronDown, Target, ShieldAlert, ListChecks, AlertTriangle, PlayCircle, Captions,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/date";
import { Avatar } from "@/components/ui/avatar";
import type { Call } from "./calls-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TranscriptEntry { speaker: string; text: string; startTime?: string }
interface TranscriptData {
  contactName: string | null;
  repName: string | null;
  fathomSummary?: string | null;
  fathomShareUrl?: string | null;
  smartNotesUrl?: string | null;
  entries: TranscriptEntry[];
}
interface CallInsight {
  wantsText: string | null; objectionsText: string | null; nextStepsText: string | null;
  redFlagsText: string | null; sentimentScore: number | null; sentimentLabel: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tsToSec(ts?: string): number {
  if (!ts) return 0;
  const p = ts.split(":").map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return Number(ts) || 0;
}
function fmtClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  upcoming: { label: "Upcoming", cls: "bg-sky-50 text-sky-700 ring-1 ring-sky-200" },
  confirmed: { label: "Confirmed", cls: "bg-sky-50 text-sky-700 ring-1 ring-sky-200" },
  booked: { label: "Booked", cls: "bg-sky-50 text-sky-700 ring-1 ring-sky-200" },
  showed: { label: "Showed", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  completed: { label: "Completed", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  noshow: { label: "No-show", cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
  cancelled: { label: "Cancelled", cls: "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200" },
};

const SPEAKER_COLORS = ["bg-violet-500", "bg-sky-500", "bg-amber-500", "bg-rose-500", "bg-emerald-500", "bg-orange-500", "bg-teal-500", "bg-indigo-500"];
function speakerColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return SPEAKER_COLORS[Math.abs(h) % SPEAKER_COLORS.length];
}

// ─── Markdown (links + bold) ──────────────────────────────────────────────────

function renderInline(input: string): React.ReactNode {
  const text = input.replace(/\\([~*_`#\-.])/g, "$1");
  const parts: React.ReactNode[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*/g;
  let last = 0, key = 0, m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      parts.push(<a key={`l${key++}`} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">{renderInline(m[1])}</a>);
    } else {
      parts.push(<strong key={`b${key++}`} className="font-semibold text-foreground">{m[3]}</strong>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-[13px] text-muted-foreground leading-relaxed">
      {text.split("\n").map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (t.startsWith("### ")) return <p key={i} className="text-xs font-semibold text-foreground mt-2">{renderInline(t.slice(4))}</p>;
        if (t.startsWith("## ")) return <p key={i} className="text-sm font-semibold text-foreground mt-2">{renderInline(t.slice(3))}</p>;
        if (t.startsWith("# ")) return <p key={i} className="text-sm font-bold text-foreground mt-2">{renderInline(t.slice(2))}</p>;
        if (t.startsWith("- ") || t.startsWith("* ")) return <div key={i} className="flex gap-2 pl-1"><span className="text-muted-foreground/50 shrink-0 mt-0.5">&bull;</span><span>{renderInline(t.slice(2))}</span></div>;
        return <p key={i}>{renderInline(t)}</p>;
      })}
    </div>
  );
}

const INSIGHT_CARDS = [
  { key: "wantsText" as const, label: "Wants", Icon: Target, color: "text-emerald-500" },
  { key: "objectionsText" as const, label: "Objections", Icon: ShieldAlert, color: "text-amber-500" },
  { key: "nextStepsText" as const, label: "Next Steps", Icon: ListChecks, color: "text-sky-500" },
  { key: "redFlagsText" as const, label: "Red Flags", Icon: AlertTriangle, color: "text-rose-500" },
] as const;

// ─── HLS video player ─────────────────────────────────────────────────────────

function VideoPlayer({
  callId, videoRef,
}: { callId: string; videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const [error, setError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const src = `/api/calls/${callId}/stream`;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    // Prefer hls.js (Chrome/Firefox/Edge). Only fall back to native HLS on
    // Safari, where hls.js isn't supported but the <video> plays HLS directly.
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (Hls.isSupported()) {
        // enableWorker:false — the app's CSP blocks blob: workers, which makes
        // hls.js fail to demux silently. Main-thread demux is slightly slower
        // but reliable here.
        const instance = new Hls({ maxBufferLength: 30, enableWorker: false });
        instance.on(Hls.Events.ERROR, (_e, data) => {
          console.error("[hls]", data.type, data.details, "fatal=" + data.fatal, (data as { reason?: string }).reason ?? "");
          if (data.fatal) setError(true);
        });
        instance.loadSource(src);
        instance.attachMedia(video);
        hls = instance;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
      } else {
        setError(true);
      }
    }).catch(() => setError(true));
    return () => { cancelled = true; hls?.destroy(); };
  }, [callId, videoRef]);

  if (error) {
    return (
      <div className="aspect-video w-full rounded-[10px] bg-ink/90 flex items-center justify-center text-center px-6">
        <p className="text-sm text-white/70">Couldn&apos;t load the in-app player. Use &ldquo;Watch on Fathom&rdquo; above.</p>
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      controls
      playsInline
      className="aspect-video w-full rounded-[10px] bg-black shadow-lg"
    />
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function CallDetailModal({ call, onClose }: { call: Call | null; onClose: () => void }) {
  const callId = call?.id ?? null;
  const isOpen = call !== null;
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  const { data } = useQuery<TranscriptData>({
    queryKey: ["call-transcript", callId],
    queryFn: () => fetch(`/api/calls/${callId}/transcript`).then((r) => r.json()),
    enabled: isOpen,
  });
  const { data: insightsData } = useQuery<{ insights: CallInsight | null }>({
    queryKey: ["call-insights", callId],
    queryFn: () => fetch(`/api/calls/${callId}/insights`).then((r) => r.json()),
    enabled: isOpen,
  });
  const insights = insightsData?.insights ?? null;

  const hasVideo = !!call?.fathomShareUrl;
  const entries = useMemo(() => (data?.entries ?? []).map((e) => ({ ...e, sec: tsToSec(e.startTime) })), [data?.entries]);
  const repLower = (call?.repName ?? data?.repName ?? "").toLowerCase().split(" ")[0];

  // Active transcript segment = last entry whose timestamp has passed.
  const activeIndex = useMemo(() => {
    if (!entries.length) return -1;
    let lo = 0, hi = entries.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (entries[mid].sec <= currentTime + 0.25) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }, [entries, currentTime]);

  // Auto-scroll the active line into view while the video plays.
  useEffect(() => {
    if (activeIndex < 0 || !activeRef.current || !transcriptScrollRef.current) return;
    activeRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  // Time updates from the video drive the highlight.
  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (v) setCurrentTime(v.currentTime);
  }, []);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.addEventListener("timeupdate", onTimeUpdate);
    return () => v.removeEventListener("timeupdate", onTimeUpdate);
  }, [onTimeUpdate, hasVideo, data]);

  const seekTo = useCallback((sec: number) => {
    const v = videoRef.current;
    if (v) { v.currentTime = sec; v.play().catch(() => {}); }
  }, []);

  // Escape + scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [isOpen, onClose]);

  // Reset playback state when switching calls
  useEffect(() => { setCurrentTime(0); setSummaryOpen(false); }, [callId]);

  if (!isOpen || !mounted) return null;

  const cards = INSIGHT_CARDS.filter((c) => insights?.[c.key]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-ink/55 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative z-10 flex w-full max-w-[1000px] max-h-[92vh] flex-col overflow-hidden rounded-[16px] bg-card shadow-2xl ring-1 ring-border"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border bg-gradient-to-b from-muted/30 to-transparent px-5 py-4 shrink-0">
          <Avatar name={call!.contactName ?? "Unknown"} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[16px] font-semibold text-foreground truncate" style={{ fontFamily: "var(--font-heading)" }}>
                {call!.contactName ?? "Unknown contact"}
              </h2>
              {insights?.sentimentLabel && (
                <span className={cn(
                  "px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize",
                  insights.sentimentLabel === "positive" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                    : insights.sentimentLabel === "negative" ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                    : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                )}>
                  {insights.sentimentLabel}{insights.sentimentScore != null ? ` ${insights.sentimentScore}/5` : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap mt-1 text-[11px] text-muted-foreground">
              <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold", call!.callType === "dialer" ? "bg-slate-100 text-slate-600" : "bg-blue-50 text-blue-700")}>
                {call!.callType === "dialer" ? <Phone className="w-2.5 h-2.5" /> : <Video className="w-2.5 h-2.5" />}
                {call!.callType === "dialer" ? "Dialer" : "Meet"}
              </span>
              {call!.status && STATUS_META[call!.status] && (
                <span className={cn("px-1.5 py-0.5 rounded-full font-semibold", STATUS_META[call!.status].cls)}>{STATUS_META[call!.status].label}</span>
              )}
              {call!.direction && (
                <span className="inline-flex items-center gap-1 font-medium">
                  {call!.direction === "outbound" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                  {call!.direction === "outbound" ? "Outbound" : "Inbound"}
                </span>
              )}
              {call!.repName && <span className="font-medium">{call!.repName}</span>}
              <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDuration(call!.durationSeconds)}</span>
              <span>{formatDateTime(call!.startedAt)}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 -mr-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1.15fr_1fr]">
          {/* Left: video + summary/insights */}
          <div className="min-h-0 overflow-y-auto border-b md:border-b-0 md:border-r border-border p-4 space-y-4">
            {hasVideo ? (
              <VideoPlayer callId={callId!} videoRef={videoRef} />
            ) : (
              <div className="aspect-video w-full rounded-[10px] bg-muted/40 ring-1 ring-border flex flex-col items-center justify-center text-center px-6">
                <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center mb-2">
                  {new Date(call!.startedAt).getTime() > Date.now() ? <Clock className="w-5 h-5 text-muted-foreground/50" /> : <Video className="w-5 h-5 text-muted-foreground/50" />}
                </div>
                <p className="text-sm font-medium text-foreground">{new Date(call!.startedAt).getTime() > Date.now() ? "This call hasn't happened yet" : "No recording for this call"}</p>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-[280px]">Once it's recorded with Fathom, the video, transcript and AI summary appear here automatically.</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              {call!.fathomShareUrl && (
                <a href={call!.fathomShareUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"><PlayCircle className="w-3.5 h-3.5" />Watch on Fathom</a>
              )}
              {new Date(call!.startedAt).getTime() > Date.now() && call!.meetingUrl && (
                <a href={call!.meetingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"><Video className="w-3.5 h-3.5" />Join Google Meet</a>
              )}
              {call!.smartNotesUrl && (
                <a href={call!.smartNotesUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"><StickyNote className="w-3.5 h-3.5" />Smart Notes</a>
              )}
            </div>

            {/* AI summary */}
            {data?.fathomSummary && (
              <div className="rounded-[10px] border border-border bg-muted/20 overflow-hidden">
                <button onClick={() => setSummaryOpen((v) => !v)} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-muted/30 transition-colors">
                  <span className="text-[10.5px] font-bold uppercase tracking-widest text-primary shrink-0">AI Summary</span>
                  <span className="flex-1" />
                  <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", summaryOpen && "rotate-180")} />
                </button>
                {summaryOpen && <div className="px-3.5 pb-3 border-t border-border/50 pt-2.5"><Markdown text={data.fathomSummary} /></div>}
              </div>
            )}

            {/* Insight cards */}
            {cards.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {cards.map(({ key, label, Icon, color }) => (
                  <div key={key} className="rounded-[8px] border border-border/70 bg-muted/20 px-3 py-2.5 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1.5"><Icon className={cn("w-3.5 h-3.5 shrink-0", color)} /><span className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span></div>
                    <p className="text-xs text-foreground leading-relaxed line-clamp-4">{insights?.[key]}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: transcript with live karaoke highlight */}
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <Captions className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Transcript</span>
              {hasVideo && entries.length > 0 && <span className="ml-auto text-[10.5px] text-muted-foreground/70 tabular-nums">{fmtClock(currentTime)}</span>}
            </div>
            <div ref={transcriptScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {entries.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center py-12">
                  <p className="text-sm font-medium text-foreground mb-1">No transcript</p>
                  <p className="text-xs text-muted-foreground max-w-[220px]">This call wasn&apos;t recorded with Fathom.</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {entries.map((e, i) => {
                    const isRep = repLower.length > 0 && e.speaker.toLowerCase().includes(repLower);
                    const isActive = i === activeIndex;
                    const showSpeaker = i === 0 || entries[i - 1].speaker !== e.speaker;
                    return (
                      <div key={i}>
                        {showSpeaker && (
                          <div className="flex items-center gap-1.5 mt-3 mb-1">
                            <span className={cn("w-2 h-2 rounded-full shrink-0", speakerColor(e.speaker))} />
                            <span className="text-[11px] font-semibold text-foreground">{e.speaker}</span>
                            {isRep && <span className="text-[9px] font-bold uppercase tracking-wide text-primary/70">Rep</span>}
                          </div>
                        )}
                        <button
                          ref={isActive ? activeRef : undefined}
                          onClick={() => hasVideo && seekTo(e.sec)}
                          disabled={!hasVideo}
                          className={cn(
                            "block w-full text-left text-[13px] leading-relaxed rounded-[6px] px-2 py-1 transition-colors",
                            hasVideo && "cursor-pointer hover:bg-muted/50",
                            isActive
                              ? "bg-primary/10 text-foreground ring-1 ring-primary/25 font-medium"
                              : "text-muted-foreground",
                          )}
                        >
                          {e.text}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
