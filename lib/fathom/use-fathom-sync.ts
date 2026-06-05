"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

const COOLDOWN_KEY = "fathom-last-sync";
const COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Client-side hook that triggers a Fathom sync on mount
 * if the user is connected and the last sync was >2 minutes ago.
 * This replaces a paid cron — the sync fires whenever
 * the dashboard or calls page loads.
 */
export function useFathomAutoSync() {
  const triggered = useRef(false);

  const { data } = useQuery<{ connected: boolean }>({
    queryKey: ["fathom-status"],
    queryFn: () => fetch("/api/fathom/status").then((r) => r.json()),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!data?.connected || triggered.current) return;

    const lastSync = localStorage.getItem(COOLDOWN_KEY);
    const now = Date.now();

    if (lastSync && now - parseInt(lastSync, 10) < COOLDOWN_MS) return;

    triggered.current = true;
    localStorage.setItem(COOLDOWN_KEY, String(now));

    // Fire and forget — don't block the UI
    fetch("/api/fathom/sync", { method: "POST" }).catch(() => {});
  }, [data?.connected]);
}
