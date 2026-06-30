"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  RefreshCw,
  Eye,
  EyeOff,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface FathomStatusData {
  connected: boolean;
}

async function fetchFathomStatus(): Promise<FathomStatusData> {
  const res = await fetch("/api/fathom/status");
  if (!res.ok) throw new Error("Failed to fetch Fathom status");
  return res.json();
}

async function connectFathom(apiKey: string): Promise<void> {
  const res = await fetch("/api/fathom/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Failed to connect Fathom");
  }
}

async function disconnectFathom(): Promise<void> {
  const res = await fetch("/api/fathom/connect", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to disconnect Fathom");
}

interface FathomConnectCardProps {
  onClose: () => void;
}

export function FathomConnectCard({ onClose }: FathomConnectCardProps) {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<FathomStatusData>({
    queryKey: ["fathom-status"],
    queryFn: fetchFathomStatus,
  });

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const connectMutation = useMutation({
    mutationFn: connectFathom,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fathom-status"] });
      setApiKey("");
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectFathom,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fathom-status"] });
      setConfirmDisconnect(false);
    },
  });

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    connectMutation.mutate(apiKey.trim());
  }

  if (isLoading) {
    return (
      <div data-r10n-fathom-card className="bg-card border border-border rounded-[10px] p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Loading Fathom settings...
        </div>
      </div>
    );
  }

  const connected = status?.connected ?? false;

  return (
    <div data-r10n-fathom-card className="bg-card border border-border rounded-[10px] p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fathom-logo.png" alt="Fathom" className="w-5 h-5 rounded-[4px] object-cover shrink-0" />
          <h2
            data-r10n-fathom-title
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Fathom
          </h2>
        </div>

        {/* Status indicator */}
        <div data-r10n-fathom-status data-state={connected ? "connected" : "idle"} className="flex items-center gap-1.5">
          {connected ? (
            <>
              <CheckCircle2 data-r10n-fathom-status-icon className="w-3.5 h-3.5 text-green-500" />
              <span data-r10n-fathom-status-label className="text-xs text-green-600 font-medium">Connected</span>
            </>
          ) : (
            <>
              <Circle className="w-3.5 h-3.5 text-muted-foreground" />
              <span data-r10n-fathom-status-label className="text-xs text-muted-foreground">Not connected</span>
            </>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-5">
        AI meeting transcription — automatically sync call recordings and transcripts.
      </p>

      {connected ? (
        /* ── Connected state ── */
        <div className="space-y-4">
          <div data-r10n-fathom-syncbox className="rounded-[6px] border border-green-200 bg-green-50 px-3 py-2.5">
            <p data-r10n-fathom-synctext className="text-sm text-green-800 font-medium">
              Your calls are being synced automatically every 2 minutes.
            </p>
          </div>

          {/* Disconnect */}
          {confirmDisconnect ? (
            <div className="rounded-[6px] border border-destructive/30 bg-destructive/5 px-3 py-3 space-y-3">
              <p className="text-sm text-foreground">
                Are you sure? This will stop syncing new calls.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
                    "bg-destructive text-white hover:bg-destructive/90",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {disconnectMutation.isPending && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  )}
                  Yes, disconnect
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(false)}
                  className="px-4 py-2 rounded-[6px] text-sm font-medium border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
              {disconnectMutation.isError && (
                <p className="text-xs text-destructive">
                  Failed to disconnect. Please try again.
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDisconnect(true)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
                "border border-destructive/50 text-destructive hover:bg-destructive/5"
              )}
            >
              Disconnect
            </button>
          )}
        </div>
      ) : (
        /* ── Not connected state ── */
        <div className="space-y-5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Generate an API key in Fathom &rarr; User Settings &rarr; API Access, then paste it below.
          </p>

          <form onSubmit={handleConnect} className="space-y-4">
            {/* API key input */}
            <div className="space-y-1.5">
              <label data-r10n-fathom-label className="text-xs font-medium text-foreground">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your Fathom API key"
                  autoComplete="off"
                  className={cn(
                    "w-full rounded-[6px] border border-border bg-background px-3 py-2 pr-10",
                    "text-sm text-foreground placeholder:text-muted-foreground",
                    "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
                    "transition-colors"
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                >
                  {showKey ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Connect button */}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={connectMutation.isPending || !apiKey.trim()}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
                  "bg-primary text-white hover:bg-primary/90",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {connectMutation.isPending && (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                )}
                Connect
              </button>

              {connectMutation.isError && (
                <span className="text-xs text-destructive">
                  {connectMutation.error?.message ?? "Failed to connect. Please try again."}
                </span>
              )}
            </div>
          </form>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Download Fathom CTA */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              Don&apos;t have Fathom yet?
            </p>
            <a
              href="https://fathom.video"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
                "border border-border hover:bg-muted"
              )}
            >
              Download Fathom
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
