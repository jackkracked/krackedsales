"use client";

import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, X, Check, RotateCcw, Trash2, Lock, Send, Loader2 } from "lucide-react";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export type BoardComment = {
  id: string;
  parentId: string | null;
  x: number | null;
  y: number | null;
  body: string;
  authorType: string;
  authorName: string | null;
  visibility?: string; // present in team mode
  resolvedAt: string | null;
  createdAt: string;
};

export type CommentApi = {
  mode: "prospect" | "team";
  create: (input: {
    x: number;
    y: number;
    body: string;
    visibility?: "internal" | "shared";
  }) => Promise<void>;
  reply: (parentId: string, body: string, visibility?: "internal" | "shared") => Promise<void>;
  resolve?: (commentId: string, resolved: boolean) => Promise<void>;
  remove?: (commentId: string) => Promise<void>;
  /** Persist a pin's new position (fractions 0..1). Optional — drag no-ops if absent. */
  move?: (commentId: string, x: number, y: number) => Promise<void>;
};

type Draft = { x: number; y: number };

/* ── Pins — rendered INSIDE the scaled canvas surface ─────────────────────── */

// A real drag (vs a click) starts once the pointer moves past this many screen px.
const DRAG_THRESHOLD = 4;

export function CommentPins({
  comments,
  naturalW,
  naturalH,
  scale,
  addMode,
  draft,
  mode,
  selectedId,
  onAddAt,
  onSelect,
  onMoveDraft,
  onMoveComment,
}: {
  comments: BoardComment[];
  naturalW: number;
  naturalH: number;
  scale: number;
  addMode: boolean;
  draft: Draft | null;
  mode: "prospect" | "team";
  selectedId: string | null;
  onAddAt: (x: number, y: number) => void;
  onSelect: (id: string) => void;
  /** Lift a new draft position (fractions) while/after dragging the draft pin. */
  onMoveDraft?: (x: number, y: number) => void;
  /** Persist a saved comment's new position (fractions). No-op if undefined. */
  onMoveComment?: (commentId: string, x: number, y: number) => void;
}) {
  const pins = comments.filter((c) => !c.parentId && c.x != null && c.y != null);
  const counter = 1 / scale;

  const overlayRef = useRef<HTMLDivElement>(null);
  // During a drag we render the pin at this live fraction instead of its stored one.
  const [livePos, setLivePos] = useState<{ id: string; x: number; y: number } | null>(null);

  /**
   * Wire pointer-drag onto a pin. `id` is the comment id, or "__draft__" for the
   * in-progress pin. Movement under DRAG_THRESHOLD is treated as a click (opens the
   * thread); a real drag repositions and suppresses the click. The overlay's
   * bounding rect already reflects the current zoom, so cursor → fraction is exact.
   */
  const dragHandlers = (id: string) => {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;

    const fracFromEvent = (clientX: number, clientY: number) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return null;
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top) / rect.height;
      return { x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) };
    };

    return {
      onPointerDown: (e: React.PointerEvent) => {
        // Don't start a pan; this pointer belongs to the pin.
        e.stopPropagation();
        if (addMode) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!dragging) return;
        if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        moved = true;
        const frac = fracFromEvent(e.clientX, e.clientY);
        if (!frac) return;
        if (id === "__draft__") onMoveDraft?.(frac.x, frac.y);
        else setLivePos({ id, x: frac.x, y: frac.y });
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
        if (moved) {
          // A real drag: persist (saved pins) and never open the thread.
          if (id !== "__draft__") {
            const frac = fracFromEvent(e.clientX, e.clientY);
            if (frac && onMoveComment) onMoveComment(id, frac.x, frac.y);
            // Always drop the live override. If persistence is wired, the parent's
            // updated `comments` carry the new spot; if not, the pin snaps back to
            // its stored position rather than silently losing data.
            setLivePos(null);
          }
        } else {
          // No meaningful movement: treat as a click → open the thread.
          if (id !== "__draft__") onSelect(id);
        }
      },
      onClick: (e: React.MouseEvent) => {
        // Selection is handled on pointer-up; swallow the click so it can't bubble
        // to the canvas or double-fire.
        e.stopPropagation();
      },
    };
  };

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{
        width: naturalW,
        height: naturalH,
        cursor: addMode ? "crosshair" : undefined,
        pointerEvents: addMode ? "auto" : "none",
      }}
      onClick={
        addMode
          ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const fx = (e.clientX - rect.left) / rect.width;
              const fy = (e.clientY - rect.top) / rect.height;
              onAddAt(Math.min(1, Math.max(0, fx)), Math.min(1, Math.max(0, fy)));
            }
          : undefined
      }
    >
      {pins.map((c, i) => {
        const internal = mode === "team" && c.visibility === "internal";
        const resolved = !!c.resolvedAt;
        const live = livePos?.id === c.id ? livePos : null;
        const x = live ? live.x : (c.x as number);
        const y = live ? live.y : (c.y as number);
        return (
          <button
            key={c.id}
            {...dragHandlers(c.id)}
            className="absolute touch-none"
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              transform: `translate(-50%, -100%) scale(${counter})`,
              transformOrigin: "50% 100%",
              pointerEvents: "auto",
              cursor: live ? "grabbing" : "grab",
            }}
            aria-label="Open or drag comment"
          >
            <Pin
              index={i + 1}
              internal={internal}
              resolved={resolved}
              active={selectedId === c.id}
              dragging={!!live}
            />
          </button>
        );
      })}

      {draft && (
        <button
          {...dragHandlers("__draft__")}
          className="absolute touch-none"
          style={{
            left: `${draft.x * 100}%`,
            top: `${draft.y * 100}%`,
            transform: `translate(-50%, -100%) scale(${counter})`,
            transformOrigin: "50% 100%",
            pointerEvents: "auto",
            cursor: "grab",
          }}
          aria-label="Drag new comment pin"
        >
          <Pin index={pins.length + 1} draft />
        </button>
      )}
    </div>
  );
}

function Pin({
  index,
  internal,
  resolved,
  active,
  draft,
  dragging,
}: {
  index: number;
  internal?: boolean;
  resolved?: boolean;
  active?: boolean;
  draft?: boolean;
  dragging?: boolean;
}) {
  const base = draft
    ? "bg-gold text-gold-foreground"
    : internal
      ? "bg-warning text-warning-foreground"
      : "bg-primary text-primary-foreground";
  return (
    <span
      className={`relative grid h-7 w-7 place-items-center rounded-full rounded-bl-[3px] text-[11px] font-semibold shadow-[0_6px_16px_-6px_rgba(15,23,42,0.5)] ring-2 ring-white transition-transform ${base} ${
        dragging ? "scale-125" : active ? "scale-110" : ""
      } ${resolved ? "opacity-60" : ""}`}
    >
      {resolved ? <Check className="h-3.5 w-3.5" /> : internal ? <Lock className="h-3 w-3" /> : index}
    </span>
  );
}

/* ── Thread panel — anchored beside its pin, Miro-style ────────────────────── */

const CARD_W = 380; // card width in screen px
const GAP = 20; // gap between pin tip and card near edge (room for the connector)
const EDGE = 12; // min padding from the canvas bounds
const MAX_CARD_H = 440; // hard cap on card height

export function CommentThreadPanel({
  comments,
  api,
  selectedId,
  draft,
  anchor,
  wrapWidth,
  wrapHeight,
  onClose,
  onSubmitting,
}: {
  comments: BoardComment[];
  api: CommentApi;
  selectedId: string | null;
  draft: Draft | null;
  /** Pin tip position in screen px within the canvas wrap, or null if off-anchor. */
  anchor: { x: number; y: number } | null;
  wrapWidth: number;
  wrapHeight: number;
  onClose: () => void;
  onSubmitting?: (busy: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const open = (!!selectedId || !!draft) && !!anchor;
  const root = selectedId ? comments.find((c) => c.id === selectedId) ?? null : null;
  const replies = root ? comments.filter((c) => c.parentId === root.id) : [];

  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "shared">("shared");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Measured card height — lets us vertically centre then clamp accurately.
  const [cardH, setCardH] = useState(0);

  useEffect(() => {
    setText("");
    setErr(null);
  }, [selectedId, draft]);

  useEffect(() => {
    onSubmitting?.(busy);
  }, [busy, onSubmitting]);

  // Measure the card so we can clamp it inside the canvas. Re-measure on content
  // changes (thread grows, reply added) and whenever the anchor target changes.
  useEffect(() => {
    if (!open) return;
    const el = cardRef.current;
    if (!el) return;
    const measure = () => setCardH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, selectedId, draft, replies.length]);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setErr(null);
    try {
      if (draft) {
        await api.create({ x: draft.x, y: draft.y, body, visibility: api.mode === "team" ? visibility : undefined });
      } else if (root) {
        await api.reply(root.id, body, api.mode === "team" ? (root.visibility as "internal" | "shared") : undefined);
      }
      setText("");
      if (draft) onClose();
    } catch (e) {
      setErr((e as Error).message || "Couldn’t post.");
    } finally {
      setBusy(false);
    }
  };

  const internal = api.mode === "team" && root?.visibility === "internal";

  // ── Anchor geometry ──────────────────────────────────────────────────────
  // The pin tip lives at `anchor`. Prefer the card to the RIGHT of the pin; flip
  // LEFT when the right side would overflow. Vertically centre the card on the pin,
  // then clamp so it never clips the canvas edges. The connector runs from the pin
  // tip to the card's near (inner) edge.
  const maxH = Math.min(MAX_CARD_H, Math.max(160, wrapHeight * 0.6));
  const ax = anchor?.x ?? 0;
  const ay = anchor?.y ?? 0;

  // Does the card fit on the right? (pin + gap + card + edge padding)
  const fitsRight = ax + GAP + CARD_W + EDGE <= wrapWidth;
  const side: "right" | "left" = fitsRight ? "right" : "left";

  // Card left edge.
  let cardLeft = side === "right" ? ax + GAP : ax - GAP - CARD_W;
  cardLeft = Math.min(wrapWidth - CARD_W - EDGE, Math.max(EDGE, cardLeft));

  // Card top: centre on the pin using the measured height, then clamp.
  const effH = cardH || Math.min(maxH, 280);
  let cardTop = ay - effH / 2;
  cardTop = Math.min(wrapHeight - effH - EDGE, Math.max(EDGE, cardTop));

  // Connector endpoints (in wrap screen space): pin tip → card near edge,
  // vertically aligned with the pin (clamped into the card's body).
  const nearX = side === "right" ? cardLeft : cardLeft + CARD_W;
  const lineY = Math.min(cardTop + effH - 16, Math.max(cardTop + 16, ay));
  const minX = Math.min(ax, nearX);
  const maxX = Math.max(ax, nearX);
  const minY = Math.min(ay, lineY);
  const maxY = Math.max(ay, lineY);

  // Card animates in from the pin side.
  const originX = side === "right" ? "0%" : "100%";

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Transparent click-catcher — closes on outside click, keeps the board visible. */}
          <div onClick={onClose} className="absolute inset-0 z-30" aria-hidden />

          {/* Connector line — pin tip to card near edge. */}
          <motion.svg
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: EASE_OUT }}
            className="pointer-events-none absolute z-40 overflow-visible"
            style={{ left: minX, top: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }}
            aria-hidden
          >
            <line
              x1={ax - minX}
              y1={ay - minY}
              x2={nearX - minX}
              y2={lineY - minY}
              stroke="var(--primary)"
              strokeWidth={1.75}
              strokeLinecap="round"
              opacity={0.55}
            />
            <circle cx={ax - minX} cy={ay - minY} r={3} fill="var(--primary)" />
          </motion.svg>

          <motion.div
            ref={cardRef}
            initial={reduce ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT }}
            style={{
              left: cardLeft,
              top: cardTop,
              width: CARD_W,
              maxWidth: `calc(100% - ${EDGE * 2}px)`,
              maxHeight: maxH,
              transformOrigin: `${originX} ${effH ? `${((lineY - cardTop) / effH) * 100}%` : "50%"}`,
            }}
            className="absolute z-40 flex flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_30px_80px_-32px_rgba(15,23,42,0.45)]"
            role="dialog"
            aria-label="Comment thread"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-foreground">
                  {draft ? "New comment" : "Comment"}
                </span>
                {internal && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning">
                    <Lock className="h-3 w-3" /> Internal
                  </span>
                )}
                {!draft && root && !internal && api.mode === "team" && (
                  <span className="rounded-full bg-info-subtle px-2 py-0.5 text-[11px] font-medium text-info">
                    Client-visible
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {api.mode === "team" && root && api.resolve && (
                  <button
                    onClick={() => api.resolve!(root.id, !root.resolvedAt)}
                    className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={root.resolvedAt ? "Reopen" : "Resolve"}
                  >
                    {root.resolvedAt ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  </button>
                )}
                {api.mode === "team" && root && api.remove && (
                  <button
                    onClick={() => {
                      api.remove!(root.id);
                      onClose();
                    }}
                    className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {!draft && root && (
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <CommentBubble c={root} />
                {replies.map((r) => (
                  <CommentBubble key={r.id} c={r} />
                ))}
              </div>
            )}

            <div className="border-t border-border p-3">
              {draft && api.mode === "team" && (
                <div className="mb-2 inline-flex rounded-[9px] bg-muted p-0.5 text-[12px]">
                  {(["shared", "internal"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setVisibility(v)}
                      className={`rounded-[7px] px-2.5 py-1 font-medium transition-colors ${
                        visibility === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                      }`}
                    >
                      {v === "shared" ? "Client-visible" : "Internal"}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                  }}
                  rows={2}
                  placeholder={draft ? "Add your comment…" : "Reply…"}
                  className="min-h-0 flex-1 resize-none rounded-[10px] border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none focus:border-primary"
                />
                <button
                  onClick={submit}
                  disabled={busy || !text.trim()}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground transition-transform active:scale-90 disabled:opacity-40"
                  aria-label="Send"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              {err && <p className="mt-1.5 text-[12px] text-destructive">{err}</p>}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function CommentBubble({ c }: { c: BoardComment }) {
  const isProspect = c.authorType === "prospect";
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center gap-2">
        <span
          className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold ${
            isProspect ? "bg-gold/20 text-gold-foreground" : "bg-primary/10 text-primary"
          }`}
        >
          {(c.authorName ?? "?").charAt(0).toUpperCase()}
        </span>
        <span className="text-[12px] font-medium text-foreground">{c.authorName ?? "Someone"}</span>
        <span className="text-[11px] text-muted-foreground">{fmtTime(c.createdAt)}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap pl-7 text-[14px] leading-relaxed text-foreground/85">
        {c.body}
      </p>
    </div>
  );
}

/* ── Add-comment toggle (floating) ────────────────────────────────────────── */

export function CommentToggle({
  active,
  onToggle,
  label = "Comment",
}: {
  active: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`pointer-events-auto inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium shadow-[0_10px_30px_-16px_rgba(15,23,42,0.45)] backdrop-blur transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card/90 text-foreground hover:bg-card"
      }`}
    >
      <MessageSquarePlus className="h-4 w-4" />
      {active ? "Click the design" : label}
    </button>
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
