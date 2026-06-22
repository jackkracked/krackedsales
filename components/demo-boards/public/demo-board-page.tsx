"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DesignCanvas } from "./design-canvas";
import { BrandPanel } from "./brand-panel";
import { BookingPanel } from "./booking-panel";
import type { CommentApi } from "./comments";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export type BoardData = {
  preview: boolean;
  board: {
    id: string;
    token: string;
    referenceCode: string;
    contactName: string;
    title: string | null;
    builtOn: string | null;
    status: string;
    repId: string | null;
    bookedAt: string | null;
    createdAt: string;
  };
  design: {
    id: string;
    url: string;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    version: number;
  } | null;
  placeholder: { title: string; body: string };
  comments: Array<{
    id: string;
    parentId: string | null;
    x: number | null;
    y: number | null;
    body: string;
    authorType: string;
    authorName: string | null;
    resolvedAt: string | null;
    createdAt: string;
  }>;
};

/** Fire a tracking beacon. keepalive guarantees delivery even if the tab is closing. */
function track(token: string, type: string, metadata?: Record<string, unknown>) {
  try {
    fetch(`/api/boards/public/${token}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, metadata }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* tracking is best-effort; never let it break the view */
  }
}

export function DemoBoardPage({ token, preview }: { token: string; preview: boolean }) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const reduce = useReducedMotion();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<BoardData | { status: string; contactName?: string } | { error: string }>({
    queryKey: ["public-board", token, preview],
    queryFn: async () => {
      const res = await fetch(`/api/boards/public/${token}${preview ? "?preview=1" : ""}`);
      if (res.status === 404) return { error: "not_found" };
      if (!res.ok) throw new Error("Failed to load board");
      return res.json();
    },
    // Light poll so the prospect sees team replies / new shared pins appear live.
    refetchInterval: 25000,
  });

  const isReady = !!data && "board" in data;
  const board = isReady ? (data as BoardData) : null;

  // Tracking: log "opened" exactly once per page load, plus a "viewed" after the
  // prospect has actually had the design on screen for a moment. (Heartbeat +
  // scroll depth are wired in the canvas/panel via the onTrack callback.)
  const openedRef = useRef(false);
  useEffect(() => {
    if (!board || preview || openedRef.current) return;
    openedRef.current = true;
    track(token, "opened");
    const t = setTimeout(() => track(token, "viewed"), 3500);
    return () => clearTimeout(t);
  }, [board, preview, token]);

  const onTrack = useCallback(
    (type: string, metadata?: Record<string, unknown>) => {
      if (preview) return;
      track(token, type, metadata);
    },
    [preview, token],
  );

  // Prospect comment API — posts to the public token route, then refetches.
  const commentApi = useMemo<CommentApi>(() => {
    const refetch = () => qc.invalidateQueries({ queryKey: ["public-board", token, preview] });
    const post = async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/boards/public/${token}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn’t post.");
      await refetch();
    };
    return {
      mode: "prospect",
      create: ({ x, y, body }) => post({ x, y, body }),
      reply: (parentId, body) => post({ parentId, body }),
      move: async (commentId, x, y) => {
        const res = await fetch(`/api/boards/public/${token}/comments`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentId, x, y }),
        });
        if (res.ok) await refetch();
      },
    };
  }, [qc, token, preview]);

  if (isLoading) return <BoardSplash />;

  if (isError || !data || ("error" in data && data.error === "not_found")) {
    return <BoardMissing />;
  }

  // Board exists but hasn't been sent yet (and we're not in admin preview).
  if (!isReady) {
    const status = "status" in data ? data.status : "pending";
    return <BoardPending status={status} />;
  }

  return (
    <div className="h-dvh w-full overflow-hidden bg-background text-foreground">
      {preview && (
        <div className="absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-primary/90 px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow-[0_8px_24px_-12px_rgba(15,58,92,0.6)] backdrop-blur">
          Preview — this is how {board!.board.contactName.split(" ")[0]} sees the board
        </div>
      )}

      <div className="flex h-full w-full flex-col lg:flex-row">
        {/* LEFT — the design, on an infinite canvas */}
        <motion.section
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="relative order-1 h-[50svh] shrink-0 lg:order-1 lg:h-full lg:min-h-0 lg:flex-1"
        >
          <DesignCanvas
            design={board!.design}
            placeholder={board!.placeholder}
            onTrack={onTrack}
            comments={board!.comments}
            commentApi={preview ? undefined : commentApi}
            tagLabel={`${board!.board.title || "Email"} · Email Design`}
          />
        </motion.section>

        {/* RIGHT — the branded Kracked rail */}
        <motion.aside
          initial={reduce ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: reduce ? 0 : 0.08 }}
          className="order-2 flex min-h-0 flex-1 flex-col border-t border-border bg-card lg:order-2 lg:h-full lg:flex-none lg:w-[clamp(360px,32vw,460px)] lg:border-l lg:border-t-0"
        >
          <BrandPanel board={board!.board} onBook={() => setBookingOpen(true)} onTrack={onTrack} />
        </motion.aside>
      </div>

      <AnimatePresence>
        {bookingOpen && (
          <BookingPanel
            board={board!.board}
            onClose={() => setBookingOpen(false)}
            onTrack={onTrack}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Full-screen states ─────────────────────────────────────────────────── */

function BoardSplash() {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-9 w-9 animate-spin rounded-full border-[2.5px] border-border border-t-primary" />
        <p className="text-sm text-muted-foreground">Preparing your board…</p>
      </div>
    </div>
  );
}

function BoardMissing() {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-heading text-2xl font-semibold text-foreground">This board isn’t available</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          The link may have expired or been mistyped. If someone shared this with you, ask them
          for a fresh link.
        </p>
      </div>
    </div>
  );
}

function BoardPending({ status }: { status: string }) {
  const message =
    status === "awaiting_design"
      ? "Your design is being finalized. You’ll get a link the moment it’s ready."
      : "This board is being prepared. Check back shortly.";
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Almost there</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
