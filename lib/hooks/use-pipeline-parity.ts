"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type ParityState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "repairing"; drift: number }
  | { status: "repaired"; removed: number }
  /** A safety guard deliberately declined to act. Nothing was changed. */
  | { status: "refused"; reason: string }
  /** The check broke. Different from refused, and it must not be reported as one. */
  | { status: "failed"; reason: string; rateLimited: boolean }
  /** Already running, or cooling off after a recent failure. Not an error. */
  | { status: "busy"; reason: string }
  | { status: "in-sync" };

/**
 * Keep the board honest the moment someone looks at it.
 *
 * The mirror over-counts because `lib/ghl/sync.ts` can add and update but never remove, so a
 * deal deleted in GHL lingers here forever. Jack, 2026-08-27: "you open it, it checks the
 * values, and it fixes it straight away, almost immediately."
 *
 * Cost model is what makes this viable on every page load:
 *   - the check is ONE GHL request (~350ms). GHL reports its own total, we compare.
 *   - the repair only runs when those totals disagree, which is rare.
 *
 * The repair is ~39 GHL calls, so the server holds a lock and a cooldown and this hook can
 * ask on every mount without the walks stacking. Before that, a failed sweep left drift in
 * place, the next mount started another walk, and the resulting rate limiting kept every
 * attempt failing — for 16 days (2026-09-12).
 *
 * A compensating pair (one wrongly present AND one wrongly missing) makes the totals agree
 * while the board is still wrong, and a pure status change (won/lost) moves no total at all.
 * So the scheduled sweep still runs. This is the fast path, not the only path.
 */
export function usePipelineParity() {
  const qc = useQueryClient();
  const [state, setState] = useState<ParityState>({ status: "idle" });
  // Once per mount. Without this, a re-render mid-repair kicks off a second sweep.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      setState({ status: "checking" });
      try {
        const res = await fetch("/api/cron/reconcile-opportunities");
        const check = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          // This is the call that fails FIRST when GoHighLevel is rate-limiting, so it has to
          // classify properly rather than throw a bare status into the catch below.
          setState({
            status: "failed",
            reason: check?.failureReason ?? `the check could not complete (${res.status})`,
            rateLimited: !!check?.rateLimited,
          });
          return;
        }
        const { inSync, drift, canRepair } = (check ?? {}) as {
          inSync: boolean | null; drift: number; canRepair?: boolean;
        };
        if (inSync) { setState({ status: "in-sync" }); return; }
        // Repairs are an admin action. A rep can do nothing with this and the scheduled sweep
        // will handle it, so do not spend a request collecting a 403 to show a dead end.
        if (canRepair === false) { setState({ status: "idle" }); return; }

        setState({ status: "repairing", drift });
        const fix = await fetch("/api/cron/reconcile-opportunities", { method: "POST" });
        const result = await fix.json().catch(() => null);
        if (cancelled) return;

        // 403: repairs are an admin action. A rep can do nothing with this, and the
        // scheduled sweep will handle it, so say nothing rather than showing a dead end.
        if (fix.status === 403) { setState({ status: "idle" }); return; }

        // 202: someone else is sweeping, or we are cooling off after a failure. Come back
        // when the server says it is worth trying, so "will retry" is actually true.
        if (fix.status === 202) {
          setState({ status: "busy", reason: result?.reason ?? "a check is already running" });
          const wait = Math.min(Number(result?.retryAfterMs) || 60_000, 15 * 60_000);
          retryTimer = setTimeout(() => { if (!cancelled) void run(); }, wait);
          return;
        }
        // ONLY 409 is a refusal. Everything else that is not ok is a failure.
        //
        // Ordering this the other way round is the original bug in a new costume: a 504 from
        // the platform killing the function, a 500 thrown before the handler's try, a 502
        // from the edge, or a 401 from an expired cookie all arrive with no usable body, and
        // a trailing `!fix.ok` branch would label every one of them "stopped on purpose".
        if (fix.status === 409) {
          setState({ status: "refused", reason: result?.abortedReason ?? "a safety guard stopped the repair" });
          return;
        }
        if (!fix.ok) {
          setState({
            status: "failed",
            reason: result?.failureReason ?? `the check could not complete (${fix.status})`,
            rateLimited: !!result?.rateLimited,
          });
          return;
        }
        setState({ status: "repaired", removed: result?.markedDeleted ?? 0 });
        // Pull the corrected board.
        qc.invalidateQueries({ queryKey: ["opportunities"] });
      } catch (e) {
        if (!cancelled) {
          setState({
            status: "failed",
            reason: e instanceof Error ? e.message : "Parity check failed",
            rateLimited: false,
          });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [qc]);

  return state;
}
