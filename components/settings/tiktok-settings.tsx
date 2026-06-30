"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface TikTokSettingsData {
  isConnected: boolean;
  openId: string | null;
  hasBusinessToken: boolean;
  advertiserId: string | null;
  accessTokenPreview: string | null;
  businessTokenPreview: string | null;
}

async function fetchTikTokSettings(): Promise<TikTokSettingsData> {
  const res = await fetch("/api/settings/tiktok");
  if (!res.ok) throw new Error("Failed to fetch TikTok settings");
  return res.json();
}

async function saveTikTokSettings(payload: {
  businessAccessToken?: string;
  advertiserId?: string;
}): Promise<void> {
  const res = await fetch("/api/settings/tiktok", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to save TikTok settings");
}

async function disconnectTikTok(): Promise<void> {
  const res = await fetch("/api/tiktok/auth/disconnect", { method: "POST" });
  if (!res.ok) throw new Error("Failed to disconnect TikTok");
}

// TikTok logo mark — simplified music note / TT shape inline SVG
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.77a4.85 4.85 0 0 1-1.01-.08z" />
    </svg>
  );
}

export function TikTokSettings() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const [businessAccessToken, setBusinessAccessToken] = useState("");
  const [advertiserId, setAdvertiserId] = useState("");
  const [saveBizSuccess, setSaveBizSuccess] = useState(false);
  const [showConnectedBanner, setShowConnectedBanner] = useState(false);

  // Show success banner if returning from OAuth callback
  useEffect(() => {
    if (searchParams.get("tiktok") === "connected") {
      setShowConnectedBanner(true);
    }
  }, [searchParams]);

  const { data: settings, isLoading } = useQuery<TikTokSettingsData>({
    queryKey: ["tiktok-settings"],
    queryFn: fetchTikTokSettings,
  });

  // Pre-fill advertiser ID from saved settings
  useEffect(() => {
    if (settings?.advertiserId) {
      setAdvertiserId(settings.advertiserId);
    }
  }, [settings]);

  const saveBizMutation = useMutation({
    mutationFn: saveTikTokSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tiktok-settings"] });
      setSaveBizSuccess(true);
      setTimeout(() => setSaveBizSuccess(false), 3000);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectTikTok,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tiktok-settings"] });
    },
  });

  function handleSaveBiz(e: React.FormEvent) {
    e.preventDefault();
    const payload: { businessAccessToken?: string; advertiserId?: string } = {};
    if (businessAccessToken.trim()) payload.businessAccessToken = businessAccessToken.trim();
    if (advertiserId.trim()) payload.advertiserId = advertiserId.trim();
    saveBizMutation.mutate(payload);
  }

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-[10px] p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Loading TikTok settings…
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-[10px] p-5 space-y-6" data-r10n-settings-card>

      {/* OAuth success banner */}
      {showConnectedBanner && (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-[6px] bg-green-50 border border-green-200 text-green-800" data-r10n-settings-banner data-tone="success">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            TikTok account connected successfully.
          </div>
          <button
            type="button"
            onClick={() => setShowConnectedBanner(false)}
            className="text-green-600 hover:text-green-800 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Section A: TikTok Account (DMs) ── */}
      <div>
        {/* Header */}
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <TikTokIcon className="w-5 h-5 text-foreground" />
            <h2
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
              data-r10n-settings-cardtitle
            >
              TikTok
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {settings?.isConnected ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                <span className="text-xs text-green-600 font-medium">Connected</span>
              </>
            ) : (
              <>
                <Circle className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Not connected</span>
              </>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          Connect your TikTok account to enable automated DM replies via OAuth.
        </p>

        {settings?.isConnected ? (
          <div className="space-y-3">
            {/* Connected account info */}
            <div className="rounded-[6px] border border-border bg-background px-3 py-2.5 space-y-1">
              <p className="text-xs text-muted-foreground">Open ID</p>
              <p className="text-sm text-foreground font-mono">{settings.openId}</p>
            </div>

            {/* Disconnect button */}
            <button
              type="button"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
                "border border-destructive/50 text-destructive hover:bg-destructive/5",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {disconnectMutation.isPending && (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              )}
              Disconnect
            </button>

            {disconnectMutation.isError && (
              <p className="text-xs text-destructive">Failed to disconnect. Please try again.</p>
            )}
          </div>
        ) : (
          /* OAuth connect — must be a full page redirect, not a fetch */
          <a
            href="/api/tiktok/auth"
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
              "bg-primary text-white hover:bg-primary/90"
            )}
          >
            <TikTokIcon className="w-4 h-4" />
            Connect TikTok Account
          </a>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* ── Section B: Business API (Comments) ── */}
      <div>
        <div className="flex items-start justify-between mb-1">
          <h3
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
            data-r10n-settings-cardtitle
          >
            Business API
          </h3>

          <div className="flex items-center gap-1.5">
            {settings?.hasBusinessToken ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                <span className="text-xs text-green-600 font-medium">Configured</span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Not configured</span>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          Add your TikTok Business Access Token to enable automated comment replies.
        </p>

        <form onSubmit={handleSaveBiz} className="space-y-4">
          {/* Business Access Token */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Business Access Token
            </label>
            <input
              type="password"
              value={businessAccessToken}
              onChange={(e) => setBusinessAccessToken(e.target.value)}
              placeholder={
                settings?.hasBusinessToken
                  ? `Current: ${settings.businessTokenPreview} — enter new value to update`
                  : "Paste your Business Access Token"
              }
              autoComplete="off"
              className={cn(
                "w-full rounded-[6px] border border-border bg-background px-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
                "transition-colors"
              )}
            />
            <p className="text-xs text-muted-foreground">
              Generated in TikTok for Developers → Business API → Access Tokens
            </p>
          </div>

          {/* Advertiser ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Advertiser ID
            </label>
            <input
              type="text"
              value={advertiserId}
              onChange={(e) => setAdvertiserId(e.target.value)}
              placeholder={
                settings?.advertiserId
                  ? `Current: ${settings.advertiserId}`
                  : "e.g. 7123456789012345678"
              }
              autoComplete="off"
              className={cn(
                "w-full rounded-[6px] border border-border bg-background px-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
                "transition-colors"
              )}
            />
            <p className="text-xs text-muted-foreground">
              Found in TikTok Ads Manager → Account info
            </p>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saveBizMutation.isPending}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
                "bg-primary text-white hover:bg-primary/90",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {saveBizMutation.isPending && (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              )}
              Save settings
            </button>

            {saveBizSuccess && (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Saved
              </span>
            )}
            {saveBizMutation.isError && (
              <span className="text-xs text-destructive">
                Failed to save. Please try again.
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
