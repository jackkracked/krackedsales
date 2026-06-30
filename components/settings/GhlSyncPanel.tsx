"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Check, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SyncCounts {
  pipelines: number;
  contacts: number;
  opportunities: number;
  conversations: number;
  messages: number;
}

interface SyncLog {
  entity: string;
  status: string;
  syncedRecords: number | null;
  error: string | null;
  completedAt: string | null;
}

interface SyncStatus {
  counts: SyncCounts;
  recentLogs: SyncLog[];
}

// Sync runs in this order
const ENTITY_ORDER = ["pipelines", "contacts", "opportunities", "conversations"] as const;
type Entity = (typeof ENTITY_ORDER)[number];

const ENTITY_LABELS: Record<Entity, string> = {
  pipelines: "Pipelines",
  contacts: "Contacts",
  opportunities: "Opportunities",
  conversations: "Conversations",
};

const COUNT_KEYS: { key: keyof SyncCounts; label: string }[] = [
  { key: "pipelines",     label: "Pipelines" },
  { key: "contacts",      label: "Contacts" },
  { key: "opportunities", label: "Opportunities" },
  { key: "conversations", label: "Conversations" },
  { key: "messages",      label: "Messages" },
];

// ─── Count-up animation ──────────────────────────────────────────────────────

function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);

  useEffect(() => {
    const from = prev.current;
    if (from === target) return;
    prev.current = target;

    const steps = 30;
    const stepMs = duration / steps;
    let step = 0;
    const id = setInterval(() => {
      step++;
      const eased = 1 - Math.pow(1 - step / steps, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (step >= steps) {
        clearInterval(id);
        setDisplay(target);
      }
    }, stepMs);

    return () => clearInterval(id);
  }, [target, duration]);

  return display;
}

// ─── Count cell ──────────────────────────────────────────────────────────────

function CountCell({ label, value }: { label: string; value: number }) {
  const display = useCountUp(value);
  return (
    <div className="bg-muted/50 border border-border rounded-[8px] px-3 py-3 flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground font-medium leading-none">{label}</span>
      <span className="text-lg font-semibold text-foreground tabular-nums">
        {display.toLocaleString()}
      </span>
    </div>
  );
}

// ─── Entity progress row (shown while syncing) ───────────────────────────────

function EntityProgressRow({
  entity,
  state,
  records,
}: {
  entity: Entity;
  state: "done" | "active" | "pending" | "error";
  records: number | null;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-5 h-5 flex items-center justify-center shrink-0">
        {state === "done" && <Check className="w-4 h-4 text-emerald-500" />}
        {state === "active" && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
        {state === "pending" && <Clock className="w-4 h-4 text-muted-foreground/40" />}
        {state === "error" && <span className="w-2 h-2 rounded-full bg-red-500" />}
      </div>
      <span
        className={cn(
          "text-sm font-medium",
          state === "done" ? "text-foreground" :
          state === "active" ? "text-foreground" :
          "text-muted-foreground"
        )}
      >
        {ENTITY_LABELS[entity]}
      </span>
      {state === "done" && records != null && (
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {records.toLocaleString()} records
        </span>
      )}
      {state === "active" && (
        <span className="ml-auto text-xs text-primary">Syncing…</span>
      )}
      {state === "pending" && (
        <span className="ml-auto text-xs text-muted-foreground/40">Queued</span>
      )}
      {state === "error" && (
        <span className="ml-auto text-xs text-destructive">Failed</span>
      )}
    </div>
  );
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GhlSyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/ghl/sync/status");
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data: SyncStatus = await res.json();
      setStatus(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncStartedAt(Date.now());

    // Run one request per entity sequentially so no single request times out
    for (const entity of ENTITY_ORDER) {
      try {
        const res = await fetch("/api/ghl/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entities: [entity] }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSyncError(`${entity}: ${body?.error ?? `Status ${res.status}`}`);
          // Continue to next entity even on error
        }
      } catch (err) {
        setSyncError(`${entity}: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Refresh counts after each entity completes
      await fetchStatus();
    }

    setSyncing(false);
    setSyncStartedAt(null);
    fetchStatus();
  }

  // Derive per-entity state from recent logs during a sync
  function getEntityState(entity: Entity): { state: "done" | "active" | "pending" | "error"; records: number | null } {
    if (!syncing || !syncStartedAt) return { state: "done", records: null };

    // Find the most recent log for this entity completed after sync started
    const recentLog = status?.recentLogs.find(
      (l) => l.entity === entity && l.completedAt && new Date(l.completedAt).getTime() >= syncStartedAt
    );

    if (recentLog) {
      return {
        state: recentLog.status === "success" ? "done" : "error",
        records: recentLog.syncedRecords,
      };
    }

    // Find the first entity in order that hasn't completed — that's the active one
    const firstPending = ENTITY_ORDER.find((e) => {
      const log = status?.recentLogs.find(
        (l) => l.entity === e && l.completedAt && new Date(l.completedAt).getTime() >= syncStartedAt
      );
      return !log;
    });

    if (firstPending === entity) return { state: "active", records: null };
    return { state: "pending", records: null };
  }

  const recentLogs = status?.recentLogs.slice(0, 5) ?? [];

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-5" data-r10n-settings-card>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }} data-r10n-settings-cardtitle>
            GoHighLevel Data Sync
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Backfill local database tables from your GHL account
          </p>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
            "bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync from GHL"}
        </button>
      </div>

      {loadError && <p className="text-xs text-destructive">Failed to load: {loadError}</p>}
      {syncError && <p className="text-xs text-destructive">Sync error: {syncError}</p>}

      {/* While syncing — show per-entity progress */}
      {syncing && syncStartedAt && (
        <div className="border border-border rounded-[8px] px-4 divide-y divide-border">
          {ENTITY_ORDER.map((entity) => {
            const { state, records } = getEntityState(entity);
            return (
              <EntityProgressRow key={entity} entity={entity} state={state} records={records} />
            );
          })}
        </div>
      )}

      {/* Record counts */}
      {status ? (
        <div className="grid grid-cols-5 gap-3">
          {COUNT_KEYS.map(({ key, label }) => (
            <CountCell key={key} label={label} value={status.counts[key]} />
          ))}
        </div>
      ) : !loadError ? (
        <div className="grid grid-cols-5 gap-3">
          {COUNT_KEYS.map(({ key }) => (
            <div key={key} className="bg-muted/50 border border-border rounded-[8px] px-3 py-3 h-[60px] animate-pulse" />
          ))}
        </div>
      ) : null}

      {/* Recent sync logs (only shown when not actively syncing) */}
      {!syncing && recentLogs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Recent syncs</p>
          <div className="divide-y divide-border border border-border rounded-[8px] overflow-hidden">
            {recentLogs.map((log, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2.5 bg-background text-xs gap-3">
                <span className="font-medium text-foreground capitalize shrink-0">{log.entity}</span>
                <span className="text-muted-foreground flex-1 truncate">
                  {log.syncedRecords != null ? `${log.syncedRecords.toLocaleString()} records` : log.error ?? "—"}
                </span>
                <span className="text-muted-foreground shrink-0">{relativeTime(log.completedAt)}</span>
                <span
                  data-r10n-status-pill
                  data-status={log.status === "success" ? "won" : "failed"}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0",
                    log.status === "success"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  )}
                >
                  <span data-r10n-settings-statusdot className={cn("w-1.5 h-1.5 rounded-full", log.status === "success" ? "bg-emerald-500" : "bg-red-500")} />
                  {log.status === "success" ? "Success" : "Error"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
