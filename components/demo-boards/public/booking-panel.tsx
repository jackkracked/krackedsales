"use client";

import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { X, CalendarClock, Check, Loader2, ArrowRight } from "lucide-react";
import type { BoardData } from "./demo-board-page";

const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

type SlotsResp = {
  days: { date: string; slots: string[] }[];
  rep?: string | null;
  color?: string;
  configured?: boolean;
  unavailable?: boolean;
};

/**
 * Booking slide-over with an intelligent, rep-routed scheduler. Free slots come
 * from the board's owning rep's calendar; booking creates a GHL appointment and
 * attributes it to the board. Degrades to a graceful "we'll reach out" when no
 * calendar is wired.
 */
export function BookingPanel({
  board,
  onClose,
  onTrack,
}: {
  board: BoardData["board"];
  onClose: () => void;
  onTrack: (type: string, metadata?: Record<string, unknown>) => void;
}) {
  const reduce = useReducedMotion();
  const firstName = board.contactName.split(" ")[0] || board.contactName;
  const tz = useMemo(
    () => (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Chicago"),
    [],
  );

  const [selectedDay, setSelectedDay] = useState(0);
  const [slot, setSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ time: string; rep?: string | null } | null>(null);

  useEffect(() => {
    onTrack("booking_opened");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onTrack]);

  const { data, isLoading } = useQuery<SlotsResp>({
    queryKey: ["board-slots", board.token],
    queryFn: async () => {
      const res = await fetch(`/api/boards/public/${board.token}/slots?tz=${encodeURIComponent(tz)}`);
      if (!res.ok) throw new Error("slots failed");
      return res.json();
    },
    enabled: !board.bookedAt,
  });

  const book = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/boards/public/${board.token}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: slot, timezone: tz }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Booking failed");
      return body as { rep?: string };
    },
    onSuccess: (b) => setBooked({ time: slot!, rep: b.rep ?? data?.rep }),
  });

  const days = data?.days ?? [];
  const activeDay = days[selectedDay];

  return (
    <div className="fixed inset-0 z-[60]">
      <motion.div
        initial={reduce ? { opacity: 1 } : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        onClick={onClose}
        className="absolute inset-0 bg-foreground/35 backdrop-blur-[2px]"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Book a call"
        initial={reduce ? { x: 0 } : { x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.42, ease: EASE_DRAWER }}
        className="absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col bg-card shadow-[-24px_0_64px_-32px_rgba(15,23,42,0.4)]"
      >
        <div className="flex items-center justify-between border-b border-border px-7 py-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-primary/10 text-primary">
              <CalendarClock className="h-[18px] w-[18px]" />
            </span>
            <h2 className="font-heading text-[17px] font-semibold text-foreground">Book your call</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-90"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <AnimatePresence mode="wait">
            {booked || board.bookedAt ? (
              <BookedState
                key="booked"
                time={booked?.time}
                rep={booked?.rep ?? data?.rep}
                tz={tz}
                firstName={firstName}
                reduce={!!reduce}
              />
            ) : isLoading ? (
              <div key="loading" className="grid place-items-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !data?.configured || days.length === 0 ? (
              <Unavailable key="empty" firstName={firstName} />
            ) : (
              <motion.div
                key="picker"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <p className="text-[15px] leading-relaxed text-muted-foreground">
                  Pick a time that works, {firstName}.
                  {data?.rep ? ` You’ll meet with ${data.rep}.` : ""}
                </p>

                {/* Day selector */}
                <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
                  {days.map((d, i) => (
                    <button
                      key={d.date}
                      onClick={() => {
                        setSelectedDay(i);
                        setSlot(null);
                      }}
                      className={`flex shrink-0 flex-col items-center rounded-[12px] border px-3.5 py-2 transition-colors ${
                        i === selectedDay
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:bg-muted"
                      }`}
                    >
                      <span className="text-[11px] font-medium uppercase tracking-wide opacity-80">
                        {weekday(d.date)}
                      </span>
                      <span className="font-heading text-lg font-semibold leading-tight">{dayNum(d.date)}</span>
                    </button>
                  ))}
                </div>

                {/* Slots */}
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {activeDay?.slots.map((s) => {
                    const active = slot === s;
                    return (
                      <button
                        key={s}
                        onClick={() => setSlot(s)}
                        className={`rounded-[10px] border py-2.5 text-[13px] font-medium tabular-nums transition-all active:scale-95 ${
                          active
                            ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                            : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted"
                        }`}
                      >
                        {fmtTime(s, tz)}
                      </button>
                    );
                  })}
                </div>

                {book.isError && (
                  <p className="mt-3 text-[13px] text-destructive">{(book.error as Error).message}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Confirm bar */}
        {!booked && !board.bookedAt && data?.configured && days.length > 0 && (
          <div className="shrink-0 border-t border-border px-7 py-4">
            <button
              onClick={() => book.mutate()}
              disabled={!slot || book.isPending}
              className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-[12px] bg-primary px-5 py-3.5 text-[15px] font-semibold text-primary-foreground shadow-[0_14px_34px_-16px_rgba(15,58,92,0.7)] transition-transform duration-150 active:scale-[0.985] disabled:opacity-50"
            >
              {!reduce && slot && (
                <motion.span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-18deg] bg-white/18 blur-md"
                  animate={{ x: ["0%", "420%"] }}
                  transition={{ duration: 2.2, ease: "easeInOut", repeat: Infinity, repeatDelay: 2.4 }}
                />
              )}
              {book.isPending ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <>
                  {slot ? `Confirm ${fmtTime(slot, tz)}` : "Select a time"}
                  {slot && <ArrowRight className="h-[18px] w-[18px] transition-transform group-hover:translate-x-0.5" />}
                </>
              )}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function BookedState({
  time,
  rep,
  tz,
  firstName,
  reduce,
}: {
  time?: string;
  rep?: string | null;
  tz: string;
  firstName: string;
  reduce: boolean;
}) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="flex flex-col items-center pt-10 text-center"
    >
      <motion.span
        initial={reduce ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.6, bounce: 0.4 }}
        className="grid h-16 w-16 place-items-center rounded-full bg-success-subtle text-success"
      >
        <Check className="h-8 w-8" />
      </motion.span>
      <h3 className="mt-5 font-heading text-xl font-semibold text-foreground">You’re booked in</h3>
      <p className="mt-2 max-w-[34ch] text-[15px] leading-relaxed text-muted-foreground">
        {time ? (
          <>
            See you {fmtFull(time, tz)}
            {rep ? ` with ${rep}` : ""}. We’ve sent a calendar invite.
          </>
        ) : (
          <>Your call is confirmed{rep ? ` with ${rep}` : ""}. We’ve sent a calendar invite.</>
        )}
      </p>
    </motion.div>
  );
}

function Unavailable({ firstName }: { firstName: string }) {
  return (
    <div className="flex flex-col items-center pt-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
        <CalendarClock className="h-6 w-6" />
      </span>
      <h3 className="mt-4 font-heading text-lg font-semibold text-foreground">Let’s find a time</h3>
      <p className="mt-2 max-w-[32ch] text-[14px] leading-relaxed text-muted-foreground">
        Reply to the message we sent and we’ll get a call on the calendar with you, {firstName}.
      </p>
    </div>
  );
}

/* ── time helpers ─────────────────────────────────────────────────────────── */

function weekday(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
}
function dayNum(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric" });
}
function fmtTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });
}
function fmtFull(iso: string, tz: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}
