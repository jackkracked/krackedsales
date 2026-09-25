"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, ChevronLeft, ChevronRight, Clock, RotateCcw } from "lucide-react";
import type { TodayResponse } from "@/app/api/today/route";
import type { TodayReason } from "@/lib/today/rules";

/**
 * Today: what this rep should actually do, as a stack rather than a list.
 *
 * WHY A STACK. The first cut rendered every item as a full-width row: eight rows of identical
 * weight, ~600px, burying the Tasks and Calls strips and giving nothing any priority. The
 * researched pattern (HubSpot's prospecting queue, Outreach's Task Flow) is one item at a time
 * with auto-advance. A pure carousel hides how much is left, which reps distrust, so the next
 * few sit physically behind the live card.
 *
 * BUILT FROM A HARDEN REVIEW. Several things here look odd until you know what they fix:
 *   - the card is IN FLOW and sizes to its content. A fixed 132px height overflowed its own
 *     nominal content by 8px and pushed the buttons below the card's border.
 *   - no `mode="popLayout"`. It measures the CONTENT box and reapplies it to a border-box
 *     element, so the card visibly collapsed ~34px before starting its exit.
 *   - focus is moved to the next card deliberately. Keying the article on sourceKey unmounts
 *     the focused button, dropping keyboard users back to <body> on every Done.
 *   - there is NO deck behind the card. The first cut layered the next three cards behind this
 *     one; measured against the page they sat at 1.03–1.11 contrast, so the depth was invisible
 *     and the layers collided with the Decide strip below. Jack, 2026-08-28: "maybe it is just
 *     one container without that effect behind it, and then being able to cycle through them."
 *     So: one clean card, and you flick through the queue.
 */

const REASON_LABEL: Record<TodayReason, string> = {
  meeting: "Meeting",
  waiting: "Waiting on you",
  billing: "Payment failing",
  money: "Proposal",
  task: "Task",
  followup: "Follow up",
};

const VIEW_KEY = "kr-today-view";

export function TodayList() {
  const qc = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [showAll, setShowAll] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Which card is showing. Cycling never reorders the queue, it just moves the viewport over it.
  const [index, setIndex] = useState(0);
  // +1 came from the right, -1 from the left. Drives the direction of the slide.
  const [dir, setDir] = useState(1);
  const doneRef = useRef<HTMLButtonElement>(null);
  const advancedRef = useRef(false);

  useEffect(() => {
    try { setShowAll(localStorage.getItem(VIEW_KEY) === "all"); } catch { /* default */ }
  }, []);
  const setView = (all: boolean) => {
    setShowAll(all);
    try { localStorage.setItem(VIEW_KEY, all ? "all" : "stack"); } catch { /* non-fatal */ }
  };

  const { data, isLoading, isError, refetch } = useQuery<TodayResponse>({
    queryKey: ["today"],
    queryFn: () => fetch("/api/today").then((r) => {
      if (!r.ok) throw new Error(`Today failed (${r.status})`);
      return r.json();
    }),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const act = useMutation({
    mutationFn: ({ key, action, days }: { key: string; action: string; days?: number }) =>
      fetch(`/api/today/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, days }),
      }).then((r) => { if (!r.ok) throw new Error("Could not save"); return r.json(); }),

    // Optimistic: waiting ~300ms before the card moves turns "dealing a card" into "click and
    // wait", which is the whole feel this design exists to create.
    onMutate: async ({ key, action }) => {
      setFailed(null);
      advancedRef.current = true;
      await qc.cancelQueries({ queryKey: ["today"] });
      const previous = qc.getQueryData<TodayResponse>(["today"]);
      if (previous && key !== "__all__") {
        qc.setQueryData<TodayResponse>(["today"], {
          ...previous,
          items: previous.items.filter((i) => i.sourceKey !== key),
          decide: previous.decide?.sourceKey === key ? null : previous.decide,
          snoozedCount: action === "snooze" ? previous.snoozedCount + 1 : previous.snoozedCount,
        });
      }
      return { previous };
    },
    // A rollback that looks identical to a success is worse than no rollback: the rep believes
    // the item is recorded and moves on. Say so.
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["today"], ctx.previous);
      setFailed("That didn't save. Nothing has been recorded.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["today"] }),
  });

  const items = data?.items ?? [];
  // Clamp rather than reset: finishing a card should leave you on the one that took its place,
  // not throw you back to the front of the queue.
  const cursor = Math.min(index, Math.max(items.length - 1, 0));
  const top = items[cursor];

  // Keyboard users lost focus to <body> on every Done, which made this slower than the flat list
  // it replaced. Move focus onto the new card's primary action, but only after an action — never
  // steal focus on first paint or a background refetch.
  useEffect(() => {
    if (advancedRef.current && top && !showAll) {
      advancedRef.current = false;
      doneRef.current?.focus();
    }
  }, [top?.sourceKey, showAll, top]);

  if (isLoading) {
    return (
      <div role="status" aria-label="Loading your list" className="h-[150px] rounded-[14px] bg-muted/40 animate-pulse" />
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-[14px] border border-border px-4 py-3">
        <p className="text-sm text-destructive">Couldn&apos;t load your list</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Nothing has been ruled out. This is a problem on our side.
        </p>
        <button onClick={() => refetch()} className="mt-2 text-xs text-primary hover:underline">
          Try again
        </button>
      </div>
    );
  }

  const { decide, snoozedCount, errors, generatedAt } = data;
  const stale = Date.now() - new Date(generatedAt).getTime() > 30 * 60_000;
  const busy = act.isPending;
  const go = (delta: number) => {
    if (items.length < 2) return;
    setDir(delta);
    setIndex((i) => (Math.min(i, items.length - 1) + delta + items.length) % items.length);
  };

  const timeOf = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;
  const actionOf = (a: string, iso?: string | null) => {
    const t = timeOf(iso);
    return t ? `${a} at ${t}` : a;
  };

  return (
    <section data-r10n-today>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Today</h2>
          {items.length > 0 && (
            <span className="text-[11px] text-muted-foreground">{items.length} to go</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* When it goes stale the timestamp becomes a REFRESH, not just a colour. The review's
              point stands: flagging a problem the rep cannot act on is worse than saying nothing. */}
          {stale ? (
            <button
              type="button"
              onClick={() => refetch()}
              className="text-[11px] font-medium text-foreground underline underline-offset-2"
            >
              Refresh
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {new Date(generatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {items.length > 1 && (
            <button
              type="button"
              onClick={() => setView(!showAll)}
              aria-pressed={showAll}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {showAll ? "Focus" : "Show all"}
            </button>
          )}
        </div>
      </header>

      {errors.map((e) => (
        <div key={e.source} className="mb-2 flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Couldn&apos;t load {e.source}
          <button onClick={() => refetch()} className="underline underline-offset-2">retry</button>
        </div>
      ))}

      {failed && (
        <div role="alert" className="mb-2 flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {failed}
        </div>
      )}

      {/* Announce the advance. Without this, a screen-reader user pressing Done gets silence. */}
      <p aria-live="polite" className="sr-only">
        {top ? `${top.personName}. ${actionOf(top.action, top.atISO)}. ${top.because}.` : "Your list is clear."}
      </p>

      {items.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 rounded-[14px] border border-border px-4 py-3">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <p className="text-sm text-foreground">You&apos;re clear.</p>
          <p className="text-sm text-muted-foreground">Anything new appears here.</p>
        </div>
      ) : showAll ? (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.sourceKey} className="flex items-center gap-3 rounded-[10px] border border-border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{it.personName}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {REASON_LABEL[it.reason]}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {actionOf(it.action, it.atISO)} · {it.because}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => act.mutate({ key: it.sourceKey, action: "done" })}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:border-primary/40 hover:bg-primary/[0.03] disabled:opacity-60"
              >
                Done
              </button>
            </li>
          ))}
        </ul>
      ) : (
        top && (
          // One card, in flow so it sizes to its own content. No layers behind it: they were
          // invisible against the page and collided with the Decide strip below.
          <div
            className="relative"
            // Arrow keys move through the queue when focus is anywhere on the card.
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
              if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
            }}
          >
            <div className="overflow-hidden rounded-[14px]">
              <AnimatePresence initial={false} custom={dir} mode="wait">
                <motion.article
                  key={top.sourceKey}
                  custom={dir}
                  aria-labelledby="today-card-name"
                  initial={reduceMotion ? false : { opacity: 0, x: dir * 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: dir * -28 }}
                  transition={{ type: "spring", stiffness: 480, damping: 38, mass: 0.6 }}
                  className="rounded-[14px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_-14px_rgba(0,0,0,0.16)]"
                >
                  <p className="text-[10px] uppercase leading-[1.4] tracking-[0.08em] text-muted-foreground">
                    {REASON_LABEL[top.reason]}
                  </p>

                  <h3 id="today-card-name" className="mt-1.5 truncate text-[17px] font-semibold leading-tight text-foreground">
                    {top.personName}
                  </h3>
                  <p className="mt-0.5 truncate text-sm text-foreground/80">{actionOf(top.action, top.atISO)}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{top.because}</p>

                  <div className="mt-3.5 flex items-center gap-1.5">
                    <button
                      ref={doneRef}
                      type="button"
                      disabled={busy}
                      onClick={() => act.mutate({ key: top.sourceKey, action: "done" })}
                      className="rounded-[8px] bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act.mutate({ key: top.sourceKey, action: "snooze", days: 1 })}
                      className="inline-flex items-center gap-1 rounded-[8px] border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                    >
                      <Clock className="h-3 w-3" />
                      Not today
                    </button>

                    {/* Cycling lives with the actions, on the card, so the eye never leaves it. */}
                    {items.length > 1 && (
                      <div className="ml-auto flex items-center gap-0.5">
                        <button
                          type="button"
                          aria-label="Previous"
                          onClick={() => go(-1)}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="min-w-[42px] text-center text-[11px] tabular-nums text-muted-foreground">
                          {cursor + 1} of {items.length}
                        </span>
                        <button
                          type="button"
                          aria-label="Next"
                          onClick={() => go(1)}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    {top.href && (
                      <Link
                        href={top.href}
                        className={`inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground ${items.length > 1 ? "" : "ml-auto"}`}
                      >
                        Open <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </motion.article>
              </AnimatePresence>
            </div>
          </div>
        )
      )}

      {/* Decide sits apart from the card: judging whether a dead lead is still alive is different
          thinking from working a queue, and mixing the two is what made the first list feel heavy. */}
      {decide && (
        <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-dashed border-border px-3 py-2">
          <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Decide</span>
          <span className="min-w-0 max-w-[40%] truncate text-xs font-medium text-foreground">{decide.personName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">no answer in {decide.sentDaysAgo} days</span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => act.mutate({ key: decide.sourceKey, action: "snooze", days: 14 })}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:border-primary/40 disabled:opacity-60"
            >
              Still alive
            </button>
            <Link
              href={`/proposals?id=${decide.proposalId}&action=lost`}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Mark lost
            </Link>
          </div>
        </div>
      )}

      {/* Kept OUTSIDE the empty branch on purpose: it used to be destroyed the moment the last
          card was cleared, stranding anything the rep had snoozed with no way to bring it back. */}
      {snoozedCount > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act.mutate({ key: "__all__", action: "undo" })}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          <RotateCcw className="h-3 w-3" />
          {snoozedCount} snoozed, bring back
        </button>
      )}
    </section>
  );
}
