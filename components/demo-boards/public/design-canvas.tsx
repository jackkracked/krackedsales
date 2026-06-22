"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import type { BoardData } from "./demo-board-page";
import {
  CommentPins,
  CommentThreadPanel,
  CommentToggle,
  type BoardComment,
  type CommentApi,
} from "./comments";

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

type View = { scale: number; x: number; y: number };

/**
 * The design canvas: the prospect's email design floating on an infinite,
 * pannable, zoomable surface — the Miro-grade feel, but ours. When no design is
 * uploaded yet, it shows an elegant "design on its way" placeholder instead.
 */
export function DesignCanvas({
  design,
  placeholder,
  onTrack,
  comments = [],
  commentApi,
  tagLabel,
}: {
  design: BoardData["design"];
  placeholder: BoardData["placeholder"];
  onTrack: (type: string, metadata?: Record<string, unknown>) => void;
  comments?: BoardComment[];
  commentApi?: CommentApi;
  /** Short label shown in the top-left canvas pill, e.g. "Welcome Flow · Email Design". */
  tagLabel?: string;
}) {
  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // The "scroll to explore" hint shows briefly once the design loads, then fades.
  const [showHint, setShowHint] = useState(false);

  // Comments state (only meaningful when commentApi is provided).
  const [addMode, setAddMode] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  /**
   * Screen position (within the canvas wrap) of the pin the thread is anchored to —
   * either the selected comment or the in-progress draft. Recomputed every render,
   * so it tracks the pin live while the prospect pans or zooms. The pin tip sits at
   * the design-space fraction; the panel anchors beside it via a connector line.
   */
  const anchorFrac: { x: number; y: number } | null = (() => {
    if (draft) return { x: draft.x, y: draft.y };
    if (selectedId) {
      const c = comments.find((cc) => cc.id === selectedId);
      if (c && c.x != null && c.y != null) return { x: c.x, y: c.y };
    }
    return null;
  })();
  const anchor =
    anchorFrac && natural
      ? {
          x: view.x + anchorFrac.x * natural.w * view.scale,
          y: view.y + anchorFrac.y * natural.h * view.scale,
        }
      : null;

  /**
   * Fit the design to the viewport WIDTH (emails are tall — fitting the full height
   * makes them unreadably small). Never upscale past 100%. Center it if the whole
   * thing fits; otherwise top-align so the prospect starts at the top and pans down.
   */
  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !natural) return;
    // Zoomed-out "on a board" view: the WHOLE design sits centred with comfortable
    // margins all around, so it reads as an email design resting on the canvas — not
    // a fullscreen website. Never upscale past 100%. Tall designs top-align so you
    // start at the top and pan/scroll down to explore.
    const pad = 44;
    const scale = Math.min(
      (wrap.clientWidth - pad * 2) / natural.w,
      (wrap.clientHeight - pad * 2) / natural.h,
      1,
    );
    const scaledH = natural.h * scale;
    const x = (wrap.clientWidth - natural.w * scale) / 2;
    const y = scaledH <= wrap.clientHeight - pad * 2 ? (wrap.clientHeight - scaledH) / 2 : pad;
    setView({ scale, x, y });
  }, [natural]);

  // Fit once the natural size is known, and re-fit on resize.
  useEffect(() => {
    if (!natural) return;
    fit();
    const ro = new ResizeObserver(() => fit());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [natural, fit]);

  // Explore hint: appear once the design has painted, then auto-fade after ~4.5s.
  useEffect(() => {
    if (!design || !loaded) return;
    setShowHint(true);
    const id = setTimeout(() => setShowHint(false), 4500);
    return () => clearTimeout(id);
  }, [design, loaded]);

  // Time-on-design heartbeat — only while this tab is visible.
  useEffect(() => {
    if (!design) return;
    let elapsed = 0;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      elapsed += 15;
      onTrack("time_on_design", { seconds: elapsed });
    }, 15000);
    return () => clearInterval(id);
  }, [design, onTrack]);

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  /** Zoom toward a focal point (cursor) so the design grows under the pointer. */
  const zoomAt = useCallback((factor: number, fx: number, fy: number) => {
    setView((v) => {
      const next = clampScale(v.scale * factor);
      const k = next / v.scale;
      return { scale: next, x: fx - (fx - v.x) * k, y: fy - (fy - v.y) * k };
    });
  }, []);

  // Mac-trackpad navigation. We attach a NATIVE non-passive wheel listener (React's
  // onWheel is passive, so it can't preventDefault the browser's page-zoom). The OS
  // tells us the gesture: pinch-to-zoom comes through as ctrlKey+wheel; a two-finger
  // swipe is a plain wheel with deltaX/deltaY → pan. A mouse wheel (no delta x, no
  // ctrl) scrolls/pans the tall design, which is what you want for an email.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !natural) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const fx = e.clientX - rect.left;
        const fy = e.clientY - rect.top;
        // deltaY from a pinch is small; this curve keeps it smooth and reversible.
        zoomAt(Math.exp(-e.deltaY * 0.01), fx, fy);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [natural, zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!natural || addMode) return; // in add-mode, clicks drop a pin, not a pan
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const endDrag = (e: React.PointerEvent) => {
    dragging.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const zoomButtons = (
    <div className="pointer-events-auto absolute bottom-5 left-5 z-20 flex items-center gap-1 rounded-full border border-border bg-card/90 p-1 shadow-[0_10px_30px_-16px_rgba(15,23,42,0.45)] backdrop-blur">
      <CanvasButton label="Zoom out" onClick={() => zoomAt(1 / 1.25, halfW(), halfH())}>
        <Minus className="h-4 w-4" />
      </CanvasButton>
      <button
        onClick={fit}
        className="min-w-[3.5rem] rounded-full px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Fit to screen"
      >
        {Math.round(view.scale * 100)}%
      </button>
      <CanvasButton label="Zoom in" onClick={() => zoomAt(1.25, halfW(), halfH())}>
        <Plus className="h-4 w-4" />
      </CanvasButton>
      <div className="mx-0.5 h-5 w-px bg-border" />
      <CanvasButton label="Fit to screen" onClick={fit}>
        <Maximize2 className="h-[15px] w-[15px]" />
      </CanvasButton>
    </div>
  );

  function halfW() {
    return (wrapRef.current?.clientWidth ?? 0) / 2;
  }
  function halfH() {
    return (wrapRef.current?.clientHeight ?? 0) / 2;
  }

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onDoubleClick={(e) => {
        const rect = wrapRef.current!.getBoundingClientRect();
        zoomAt(view.scale < 1 ? 2 : 1 / 1.6, e.clientX - rect.left, e.clientY - rect.top);
      }}
      className="dotgrid relative h-full w-full touch-none select-none overflow-hidden"
      style={{ cursor: design ? (dragging.current ? "grabbing" : "grab") : "default" }}
    >
      {tagLabel && (
        <div className="pointer-events-none absolute left-4 top-4 z-20 sm:left-5 sm:top-5">
          <span className="inline-flex items-center rounded-full border border-border bg-card/90 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground shadow-[0_4px_16px_-8px_rgba(15,23,42,0.4)] backdrop-blur">
            {tagLabel}
          </span>
        </div>
      )}
      {design ? (
        <>
          <div
            ref={surfaceRef}
            className="absolute left-0 top-0 origin-top-left will-change-transform"
            style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
          >
            <motion.div
              initial={reduce ? false : { opacity: 0, scale: 0.985 }}
              animate={{ opacity: loaded ? 1 : 0, scale: 1 }}
              transition={{ duration: 0.6, ease: EASE_OUT }}
              className="overflow-hidden rounded-[14px] bg-white shadow-[0_40px_120px_-40px_rgba(15,23,42,0.4),0_8px_24px_-12px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.04]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={design.url}
                alt="Email design"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                  setLoaded(true);
                }}
                className="block max-w-none"
                style={natural ? { width: natural.w, height: natural.h } : undefined}
              />
            </motion.div>
            {commentApi && natural && loaded && (
              <CommentPins
                comments={comments}
                naturalW={natural.w}
                naturalH={natural.h}
                scale={view.scale}
                addMode={addMode}
                draft={draft}
                mode={commentApi.mode}
                selectedId={selectedId}
                onAddAt={(x, y) => {
                  setDraft({ x, y });
                  setSelectedId(null);
                  setAddMode(false);
                }}
                onSelect={(id) => {
                  setSelectedId(id);
                  setDraft(null);
                }}
                onMoveDraft={(x, y) => setDraft({ x, y })}
                onMoveComment={
                  commentApi.move
                    ? (id, x, y) => {
                        // Fire-and-forget; the pin already shows its new spot. Failures
                        // surface in the console — the next board refresh reconciles.
                        commentApi.move?.(id, x, y).catch((e) =>
                          console.error("[pin move]", e),
                        );
                      }
                    : undefined
                }
              />
            )}
          </div>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-border border-t-primary" />
            </div>
          )}
          {zoomButtons}
          <AnimatePresence>
            {showHint && (
              <motion.div
                key="explore-hint"
                initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                transition={{ duration: reduce ? 0 : 0.4, ease: EASE_OUT }}
                className="pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2"
              >
                <span className="inline-flex items-center rounded-full border border-border bg-card/90 px-3.5 py-1.5 text-[12px] font-medium text-muted-foreground shadow-[0_10px_30px_-16px_rgba(15,23,42,0.45)] backdrop-blur">
                  Scroll to explore · pinch to zoom
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          {commentApi && loaded && (
            <div className="pointer-events-none absolute bottom-5 right-5 z-20">
              <CommentToggle
                active={addMode}
                onToggle={() => {
                  setAddMode((v) => !v);
                  setDraft(null);
                  setSelectedId(null);
                }}
                label={commentApi.mode === "team" ? "Add note" : "Comment"}
              />
            </div>
          )}
          {commentApi && natural && (
            <CommentThreadPanel
              comments={comments}
              api={commentApi}
              selectedId={selectedId}
              draft={draft}
              anchor={anchor}
              wrapWidth={wrapRef.current?.clientWidth ?? 0}
              wrapHeight={wrapRef.current?.clientHeight ?? 0}
              onClose={() => {
                setSelectedId(null);
                setDraft(null);
              }}
            />
          )}
        </>
      ) : (
        <Placeholder placeholder={placeholder} reduce={!!reduce} />
      )}
    </div>
  );
}

function CanvasButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-90"
    >
      {children}
    </button>
  );
}

function Placeholder({
  placeholder,
  reduce,
}: {
  placeholder: BoardData["placeholder"];
  reduce: boolean;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
        className="relative w-full max-w-[340px] overflow-hidden rounded-[18px] border border-border bg-card px-8 py-12 text-center shadow-[0_30px_80px_-48px_rgba(15,23,42,0.35)]"
      >
        {!reduce && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-gold/10 to-transparent"
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 2.6, ease: "linear", repeat: Infinity, repeatDelay: 1.2 }}
          />
        )}
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-full bg-gold/15">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-gold" />
        </div>
        <h2 className="font-heading text-lg font-semibold text-foreground">{placeholder.title}</h2>
        <p className="mx-auto mt-2 max-w-[26ch] text-[14px] leading-relaxed text-muted-foreground">
          {placeholder.body}
        </p>
      </motion.div>
    </div>
  );
}
