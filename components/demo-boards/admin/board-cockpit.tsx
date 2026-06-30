"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import Link from "next/link";
import { upload as blobUpload } from "@vercel/blob/client";
import {
  ArrowLeft,
  UploadCloud,
  Send,
  Eye,
  Clock,
  CheckCircle2,
  Loader2,
  ImageIcon,
  Sparkles,
  ImageUp,
  MailCheck,
  Eye as EyeIcon,
  RotateCcw,
  Timer,
  ArrowDownToLine,
  Forward,
  MessageCircle,
  CalendarClock,
  CalendarCheck,
  PlusCircle,
  XCircle,
  Link2,
  Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DesignCanvas } from "@/components/demo-boards/public/design-canvas";
import type { BoardComment, CommentApi } from "@/components/demo-boards/public/comments";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

type Design = {
  id: string;
  blobUrl: string;
  version: number;
  width: number | null;
  height: number | null;
  createdAt: string;
};
type EventRow = { id: string; type: string; actor: string | null; createdAt: string; metadata: Record<string, unknown> | null };
type BoardResp = {
  board: {
    id: string;
    token: string;
    referenceCode: string;
    contactName: string;
    contactEmail: string | null;
    ghlContactId: string | null;
    title: string | null;
    builtOn: string | null;
    status: string;
    sentChannel: string | null;
    repName: string | null;
    designerName: string | null;
    publicUrl: string;
  };
  designs: Design[];
  comments: BoardComment[];
  events: EventRow[];
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  awaiting_design: { label: "Awaiting design", cls: "bg-muted text-muted-foreground" },
  in_review: { label: "In review", cls: "bg-warning-subtle text-warning" },
  sent: { label: "Sent", cls: "bg-info-subtle text-info" },
  opened: { label: "Opened", cls: "bg-info-subtle text-info" },
  engaged: { label: "Engaged", cls: "bg-gold/15 text-gold-foreground" },
  booked: { label: "Booked", cls: "bg-success-subtle text-success" },
  closed: { label: "Closed", cls: "bg-muted text-muted-foreground" },
};

const CHANNELS = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "ig", label: "Instagram" },
  { value: "fb", label: "Facebook" },
  { value: "whatsapp", label: "WhatsApp" },
];

export function BoardCockpit({ boardId }: { boardId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<BoardResp>({
    queryKey: ["board", boardId],
    queryFn: async () => {
      const res = await fetch(`/api/boards/${boardId}`);
      if (!res.ok) throw new Error("Failed to load board");
      return res.json();
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["board", boardId] });

  // Team comment API — internal or client-visible notes, resolve, delete.
  const teamApi = useMemo<CommentApi>(() => {
    const refetch = () => qc.invalidateQueries({ queryKey: ["board", boardId] });
    const post = async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/boards/${boardId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn’t post.");
      await refetch();
    };
    return {
      mode: "team",
      create: ({ x, y, body, visibility }) => post({ x, y, body, visibility }),
      reply: (parentId, body, visibility) => post({ parentId, body, visibility }),
      resolve: async (commentId, resolved) => {
        await fetch(`/api/boards/${boardId}/comments/${commentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolved }),
        });
        await refetch();
      },
      remove: async (commentId) => {
        await fetch(`/api/boards/${boardId}/comments/${commentId}`, { method: "DELETE" });
        await refetch();
      },
      move: async (commentId, x, y) => {
        await fetch(`/api/boards/${boardId}/comments/${commentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x, y }),
        });
        await refetch();
      },
    };
  }, [qc, boardId]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <p className="font-heading text-lg font-semibold">Couldn’t load this board</p>
          <Link href="/boards" className="mt-2 inline-block text-sm text-primary hover:underline">
            Back to boards
          </Link>
        </div>
      </div>
    );
  }

  const { board, designs, events } = data;
  const current = designs[0] ?? null;
  const status = STATUS_META[board.status] ?? STATUS_META.awaiting_design;

  return (
    <div className="flex h-full flex-col" data-r10n-board-surface>
      {/* Header */}
      <header className="shrink-0 border-b border-border px-6 py-4" data-r10n-board-header>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/boards"
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Back to boards"
            >
              <ArrowLeft className="h-[18px] w-[18px]" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="truncate font-heading text-lg font-semibold text-foreground" data-r10n-board-name>
                  {board.contactName}
                </h1>
                <span
                  data-r10n-status-pill
                  data-status={board.status}
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}
                >
                  {status.label}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {board.referenceCode}
                {board.title ? ` · ${board.title}` : ""}
                {board.repName ? ` · ${board.repName}` : ""}
              </p>
            </div>
          </div>
          <a
            href={`${board.publicUrl}?preview=1`}
            target="_blank"
            rel="noreferrer"
            data-r10n-board-btn
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Eye className="h-4 w-4" /> Preview board
          </a>
        </div>
      </header>

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_380px]">
        {/* Design preview / uploader */}
        <section className="relative flex min-h-0 flex-col overflow-hidden border-b border-border lg:border-b-0 lg:border-r">
          <DesignArea
            boardId={boardId}
            current={current}
            comments={data.comments}
            commentApi={teamApi}
            onUploaded={invalidate}
          />
        </section>

        {/* Lifecycle + composer + timeline */}
        <aside className="flex min-h-0 flex-col bg-sidebar" data-r10n-board-aside>
          <div className="shrink-0 space-y-4 p-5 pb-4">
            <ActionPanel board={board} hasDesign={!!current} onChanged={invalidate} />
            <BoardMeta board={board} />
          </div>
          <Timeline events={events} />
        </aside>
      </div>
    </div>
  );
}

/* ── Design area ─────────────────────────────────────────────────────────── */

function DesignArea({
  boardId,
  current,
  comments,
  commentApi,
  onUploaded,
}: {
  boardId: string;
  current: Design | null;
  comments: BoardComment[];
  commentApi: CommentApi;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  // After the file finishes uploading, the server records the new version a beat
  // later (an async callback). We hold a smooth "finalizing" state and poll until
  // the new version actually appears, then reveal it — no blank gap.
  const [finalizing, setFinalizing] = useState(false);
  const fromVersion = useRef(0);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  // The new design has arrived in the data → stop finalizing (reveals it).
  useEffect(() => {
    if (finalizing && current && current.version > fromVersion.current) {
      setFinalizing(false);
    }
  }, [current, finalizing]);

  // While finalizing, refetch the board every ~1.2s until the new version lands
  // (or give up gracefully after 30s rather than spin forever).
  useEffect(() => {
    if (!finalizing) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started > 30000) {
        setFinalizing(false);
        setError("Taking longer than expected — refresh to see your design.");
        return;
      }
      onUploadedRef.current();
    }, 1200);
    return () => window.clearInterval(id);
  }, [finalizing]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setError(null);
      setProgress(0);
      const dims = await measure(file).catch(() => ({ width: 0, height: 0 }));
      // Client-side direct upload: streams browser → Vercel Blob (no size cap),
      // with live progress. The design row is created server-side by the
      // route's onUploadCompleted callback once the blob lands.
      return blobUpload(file.name, file, {
        access: "public",
        handleUploadUrl: `/api/boards/${boardId}/design`,
        clientPayload: JSON.stringify({ boardId, width: dims.width, height: dims.height }),
        onUploadProgress: (e) => setProgress(e.percentage),
      });
    },
    onSuccess: () => {
      // Hold finalizing until the new version appears (polled by the effect above).
      fromVersion.current = current?.version ?? 0;
      setFinalizing(true);
      onUploaded();
    },
    onError: (e: Error) => setError(e.message || "Upload failed"),
  });

  const onPick = (file?: File | null) => {
    if (file) upload.mutate(file);
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      className="hidden"
      onChange={(e) => onPick(e.target.files?.[0])}
    />
  );

  if (current) {
    return (
      <div className="flex h-full flex-col">
        {input}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-2.5" data-r10n-board-designbar>
          <p className="text-[13px] font-medium text-foreground">
            Design <span className="text-muted-foreground" data-r10n-board-version>· v{current.version}</span>
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">
              Drop a pin to leave a note
            </span>
          </p>
          {upload.isPending ? (
            <div className="flex items-center gap-2.5">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="w-8 text-right text-[12px] font-medium tabular-nums text-muted-foreground">
                {Math.round(progress)}%
              </span>
            </div>
          ) : finalizing ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Finalizing…
            </span>
          ) : (
            <button
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary transition-opacity hover:opacity-80"
            >
              <UploadCloud className="h-4 w-4" />
              Replace
            </button>
          )}
        </div>
        <div className="relative min-h-0 flex-1">
          <DesignCanvas
            key={current.id}
            design={{
              id: current.id,
              url: current.blobUrl,
              mimeType: null,
              width: current.width,
              height: current.height,
              version: current.version,
            }}
            placeholder={{ title: "", body: "" }}
            onTrack={() => {}}
            comments={comments}
            commentApi={commentApi}
          />
          <AnimatePresence>
            {finalizing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 z-10 grid place-items-center bg-background/75 backdrop-blur-sm"
              >
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  <p className="text-sm font-medium text-foreground">Bringing your design in…</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {error && <p className="px-5 py-2 text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  if (finalizing) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-3 text-center"
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="font-heading text-base font-semibold text-foreground">Bringing your design in…</p>
          <p className="text-sm text-muted-foreground">Just a moment — it’ll appear right here.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      {input}
      <div className="w-full max-w-xl">
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onPick(e.dataTransfer.files?.[0]);
          }}
          disabled={upload.isPending}
          className={`flex w-full flex-col items-center justify-center gap-3 rounded-[16px] border-2 border-dashed px-6 py-20 text-center transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/40"
          }`}
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
            {upload.isPending ? (
              <UploadCloud className="h-6 w-6" />
            ) : (
              <ImageIcon className="h-6 w-6" />
            )}
          </span>
          <span className="font-heading text-base font-semibold text-foreground">
            {upload.isPending ? "Uploading…" : "Drop the email design here"}
          </span>
          {upload.isPending ? (
            <span className="flex w-full max-w-[280px] flex-col items-center gap-2">
              <span className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </span>
              <span className="text-sm font-medium tabular-nums text-muted-foreground">
                {Math.round(progress)}%
              </span>
            </span>
          ) : (
            <span className="max-w-[34ch] text-sm text-muted-foreground">
              PNG, JPG, WEBP or GIF — any size. This is exactly what the prospect sees on their board.
            </span>
          )}
        </button>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}

/* ── Action panel ────────────────────────────────────────────────────────── */

function ActionPanel({
  board,
  hasDesign,
  onChanged,
}: {
  board: BoardResp["board"];
  hasDesign: boolean;
  onChanged: () => void;
}) {
  const [composing, setComposing] = useState(false);

  const review = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/boards/${board.id}/review`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      return res.json();
    },
    onSuccess: onChanged,
  });

  const alreadySent = ["sent", "opened", "engaged", "booked", "closed"].includes(board.status);
  const status = STATUS_META[board.status] ?? STATUS_META.awaiting_design;

  return (
    <div className="rounded-[14px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(28,35,51,0.04)]" data-r10n-board-card>
      <div className="flex items-center justify-between gap-3">
        <p className="font-heading text-[13px] font-semibold tracking-tight text-foreground" data-r10n-board-cardlabel>
          Lifecycle
        </p>
        <span
          data-r10n-status-pill
          data-status={board.status}
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.cls}`}
        >
          {status.label}
        </span>
      </div>

      {!composing ? (
        <div className="mt-3.5 space-y-2">
          <button
            onClick={() => setComposing(true)}
            disabled={!hasDesign}
            data-r10n-board-primary
            className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_10px_28px_-14px_rgba(15,58,92,0.7)] transition-[transform,opacity] hover:opacity-95 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            <Send className="h-4 w-4" />
            {alreadySent ? "Send again" : "Send to client"}
          </button>
          <button
            onClick={() => review.mutate()}
            disabled={!hasDesign || review.isPending}
            data-r10n-board-btn
            className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {review.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Send for review
          </button>
          {review.isError && (
            <p className="text-xs text-destructive">{(review.error as Error).message}</p>
          )}
          {!hasDesign && (
            <p className="pt-0.5 text-xs text-muted-foreground">
              Upload a design to unlock these.
            </p>
          )}
        </div>
      ) : (
        <SendComposer board={board} onDone={onChanged} onCancel={() => setComposing(false)} />
      )}
    </div>
  );
}

/* ── Board meta ──────────────────────────────────────────────────────────── */

const CHANNEL_LABEL: Record<string, string> = {
  sms: "SMS",
  email: "Email",
  ig: "Instagram",
  fb: "Facebook",
  whatsapp: "WhatsApp",
};

function BoardMeta({ board }: { board: BoardResp["board"] }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(board.publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked (insecure context / permissions) — fail quietly.
    }
  };

  const rows: { label: string; value: string }[] = [
    { label: "Reference", value: board.referenceCode },
    ...(board.repName ? [{ label: "Rep", value: board.repName }] : []),
    ...(board.designerName ? [{ label: "Designer", value: board.designerName }] : []),
    ...(board.sentChannel
      ? [{ label: "Sent on", value: CHANNEL_LABEL[board.sentChannel] ?? board.sentChannel }]
      : []),
  ];

  return (
    <div className="rounded-[14px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(28,35,51,0.04)]" data-r10n-board-card>
      <p className="font-heading text-[13px] font-semibold tracking-tight text-foreground" data-r10n-board-cardlabel>
        Board details
      </p>
      <dl className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-xs text-muted-foreground" data-r10n-board-metalabel>{r.label}</dt>
            <dd className="truncate text-right text-[13px] font-medium text-foreground" data-r10n-board-metavalue>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      <button
        onClick={copyLink}
        data-r10n-board-btn
        className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
      >
        {copied ? (
          <>
            <Check className="h-4 w-4 text-success" /> Link copied
          </>
        ) : (
          <>
            <Link2 className="h-4 w-4" /> Copy board link
          </>
        )}
      </button>
    </div>
  );
}

function SendComposer({
  board,
  onDone,
  onCancel,
}: {
  board: BoardResp["board"];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [channel, setChannel] = useState(board.sentChannel || "email");
  const [subject, setSubject] = useState(`Your custom email design from Kracked`);
  const firstName = board.contactName.split(" ")[0] || board.contactName;
  const [message, setMessage] = useState(
    `Hi ${firstName}, here’s the custom email design our team built for you. Take a look and let’s find a time to walk through it:`,
  );

  const send = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/boards/${board.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, message, subject: channel === "email" ? subject : undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Send failed");
      return res.json();
    },
    onSuccess: () => {
      onDone();
      onCancel();
    },
  });

  return (
    <div className="mt-3 space-y-3" data-r10n-board-composer>
      <div>
        <label className="text-xs font-medium text-muted-foreground" data-r10n-board-fieldlabel>Channel</label>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          data-r10n-board-input
          className="mt-1 w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        >
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {channel === "email" && (
        <div>
          <label className="text-xs font-medium text-muted-foreground" data-r10n-board-fieldlabel>Subject</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            data-r10n-board-input
            className="mt-1 w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
      )}
      <div>
        <label className="text-xs font-medium text-muted-foreground" data-r10n-board-fieldlabel>Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          data-r10n-board-input
          className="mt-1 w-full resize-none rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <p className="mt-1 text-xs text-muted-foreground">The board link is added automatically.</p>
      </div>
      {send.isError && <p className="text-xs text-destructive">{(send.error as Error).message}</p>}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          data-r10n-board-btn
          className="flex-1 rounded-[10px] border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Cancel
        </button>
        <button
          onClick={() => send.mutate()}
          disabled={send.isPending || !message.trim()}
          data-r10n-board-primary
          className="flex flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:opacity-95 active:scale-[0.98] disabled:opacity-50"
        >
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send to {firstName}
        </button>
      </div>
    </div>
  );
}

/* ── Timeline ────────────────────────────────────────────────────────────── */

const EVENT_LABEL: Record<string, string> = {
  created: "Board created",
  design_uploaded: "Design uploaded",
  sent_for_review: "Sent for review",
  sent: "Sent to client",
  opened: "Opened by prospect",
  reopened: "Reopened",
  viewed: "Viewed the design",
  time_on_design: "Spent time on the design",
  scrolled_bottom: "Read the full board",
  forwarded: "Forwarded the board",
  commented: "Left a comment",
  booking_opened: "Started to book",
  booked: "Booked a call",
  closed: "Closed",
};

// Per-event icon + tone. Tone drives the dot's subtle background and ink colour,
// all from the design system tokens (info / success / gold / warning / neutral).
type EventTone = "neutral" | "info" | "success" | "gold" | "warning";
const EVENT_META: Record<string, { icon: LucideIcon; tone: EventTone }> = {
  created: { icon: Sparkles, tone: "neutral" },
  design_uploaded: { icon: ImageUp, tone: "info" },
  sent_for_review: { icon: CheckCircle2, tone: "warning" },
  sent: { icon: MailCheck, tone: "info" },
  opened: { icon: EyeIcon, tone: "info" },
  reopened: { icon: RotateCcw, tone: "info" },
  viewed: { icon: EyeIcon, tone: "info" },
  time_on_design: { icon: Timer, tone: "neutral" },
  scrolled_bottom: { icon: ArrowDownToLine, tone: "neutral" },
  forwarded: { icon: Forward, tone: "gold" },
  commented: { icon: MessageCircle, tone: "gold" },
  booking_opened: { icon: CalendarClock, tone: "gold" },
  booked: { icon: CalendarCheck, tone: "success" },
  closed: { icon: XCircle, tone: "neutral" },
};

const TONE_CLS: Record<EventTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-subtle text-info",
  success: "bg-success-subtle text-success",
  gold: "bg-gold/15 text-gold-foreground",
  warning: "bg-warning-subtle text-warning",
};

function Timeline({ events }: { events: EventRow[] }) {
  const reduce = useReducedMotion();
  // Collapse noisy repeated heartbeats so the timeline stays readable.
  const filtered = events
    .filter((e, i) => !(e.type === "time_on_design" && events[i - 1]?.type === "time_on_design"))
    .slice(0, 60);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-border" data-r10n-board-timeline>
      <div className="flex shrink-0 items-center gap-2 px-5 pb-2.5 pt-4">
        <Clock className="h-[15px] w-[15px] text-muted-foreground" data-r10n-board-timelineicon />
        <h2 className="font-heading text-[13px] font-semibold tracking-tight text-foreground" data-r10n-board-timelinetitle>
          Activity
        </h2>
        {filtered.length > 0 && (
          <span className="ml-auto text-[11px] font-medium tabular-nums text-muted-foreground" data-r10n-board-timelinecount>
            {filtered.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {filtered.length === 0 ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-center">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground">
              <Clock className="h-4 w-4" />
            </span>
            <p className="text-[13px] font-medium text-foreground">No activity yet</p>
            <p className="max-w-[28ch] text-xs text-muted-foreground">
              Events appear here as the board moves through review and the client engages.
            </p>
          </div>
        ) : (
          <ol className="relative">
            {/* Connector line running down the left, behind the dots. */}
            <span
              aria-hidden
              className="absolute bottom-3 left-[11px] top-3 w-px bg-border"
            />
            {filtered.map((e, i) => {
              const meta = EVENT_META[e.type] ?? { icon: Clock, tone: "neutral" as EventTone };
              const Icon = meta.icon;
              return (
                <motion.li
                  key={e.id}
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT, delay: reduce ? 0 : Math.min(i, 8) * 0.015 }}
                  className="relative flex gap-3 pb-4 last:pb-0"
                >
                  <span
                    data-r10n-board-eventdot
                    data-tone={meta.tone}
                    className={`relative z-10 mt-0.5 grid h-[23px] w-[23px] shrink-0 place-items-center rounded-full ring-4 ring-sidebar ${TONE_CLS[meta.tone]}`}
                  >
                    <Icon className="h-[13px] w-[13px]" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[13px] font-medium leading-snug text-foreground" data-r10n-board-eventtitle>
                      {EVENT_LABEL[e.type] ?? e.type}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground" data-r10n-board-eventmeta>
                      {e.actor ? `${e.actor} · ` : ""}
                      {fmtWhen(e.createdAt)}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function measure(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
