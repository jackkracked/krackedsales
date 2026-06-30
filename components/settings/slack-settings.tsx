"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle2, Circle, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface SlackSettingsData {
  id: string;
  botToken: string | null;
  signingSecret: string | null;
  channelId: string | null;
  channelName: string | null;
  enabled: boolean;
  demoWebhookUrl: string | null;
  updatedAt: string;
}

interface SlackChannel {
  id: string;
  name: string;
}

async function fetchSettings(): Promise<SlackSettingsData | null> {
  const res = await fetch("/api/slack/settings");
  if (!res.ok) throw new Error("Failed to fetch Slack settings");
  const data = await res.json();
  return data.settings ?? null;
}

async function fetchChannels(): Promise<SlackChannel[]> {
  const res = await fetch("/api/slack/channels");
  if (!res.ok) return []; // No token yet — return empty silently
  const data = await res.json();
  return data.channels ?? [];
}

async function saveSettings(payload: {
  botToken?: string;
  signingSecret?: string;
  channelId?: string;
  channelName?: string;
  enabled: boolean;
  demoWebhookUrl?: string;
}): Promise<void> {
  const res = await fetch("/api/slack/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to save Slack settings");
}

export function SlackSettings() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<SlackSettingsData | null>({
    queryKey: ["slack-settings"],
    queryFn: fetchSettings,
  });

  // Only fetch channels when there's already a token configured
  const { data: channels = [], refetch: refetchChannels, isFetching: isFetchingChannels } =
    useQuery<SlackChannel[]>({
      queryKey: ["slack-channels"],
      queryFn: fetchChannels,
      enabled: !!settings?.botToken,
    });

  // Local form state
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [selectedChannelName, setSelectedChannelName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");
  const [channelDropdownOpen, setChannelDropdownOpen] = useState(false);
  const channelRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (channelRef.current && !channelRef.current.contains(e.target as Node)) {
        setChannelDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Populate form from loaded settings
  useEffect(() => {
    if (!settings) return;
    // Don't pre-fill the masked token/secret — user must re-enter to change
    setSelectedChannelId(settings.channelId ?? "");
    setSelectedChannelName(settings.channelName ?? "");
    setEnabled(settings.enabled);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["slack-settings"] });
      queryClient.invalidateQueries({ queryKey: ["slack-channels"] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  function handleChannelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const channelId = e.target.value;
    const channel = channels.find((c) => c.id === channelId);
    setSelectedChannelId(channelId);
    setSelectedChannelName(channel?.name ?? "");
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();

    const payload: Parameters<typeof saveSettings>[0] = {
      enabled,
      channelId: selectedChannelId || undefined,
      channelName: selectedChannelName || undefined,
    };

    // Only send token/secret if the user typed something new
    if (botToken.trim()) payload.botToken = botToken.trim();
    if (signingSecret.trim()) payload.signingSecret = signingSecret.trim();

    saveMutation.mutate(payload);
  }

  const isConfigured = !!(settings?.botToken && settings?.channelId);

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-[10px] p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Loading Slack settings…
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-[10px] p-5" data-r10n-settings-card>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/slack-icon.svg" alt="Slack" className="w-5 h-5" />
          <h2
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
            data-r10n-settings-cardtitle
          >
            Slack
          </h2>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-1.5">
          {isConfigured && settings?.enabled ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              <span className="text-xs text-green-600 font-medium">Connected</span>
            </>
          ) : (
            <>
              <Circle className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Not configured</span>
            </>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-5">
        Connect a Slack bot so you can ask questions about your pipeline, ad spend,
        and KPIs directly from Slack.
      </p>

      <form onSubmit={handleSave} className="space-y-4">
        {/* Bot Token */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">
            Bot Token
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={
              settings?.botToken
                ? `Current: ${settings.botToken} — enter new value to update`
                : "xoxb-..."
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
            Found in your Slack app under OAuth &amp; Permissions → Bot User OAuth Token
          </p>
        </div>

        {/* Signing Secret */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">
            Signing Secret
          </label>
          <input
            type="password"
            value={signingSecret}
            onChange={(e) => setSigningSecret(e.target.value)}
            placeholder={
              settings?.signingSecret
                ? "Already set — enter new value to update"
                : "Slack app signing secret"
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
            Found in your Slack app under Basic Information → App Credentials
          </p>
        </div>

        {/* Channel selector */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-foreground">
              Channel
            </label>
            {settings?.botToken && (
              <button
                type="button"
                onClick={() => refetchChannels()}
                disabled={isFetchingChannels}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <RefreshCw className={cn("w-3 h-3", isFetchingChannels && "animate-spin")} />
                Refresh channels
              </button>
            )}
          </div>

          {channels.length > 0 ? (
            <div ref={channelRef} className="relative">
              {/* Trigger button */}
              <button
                type="button"
                onClick={() => { setChannelDropdownOpen(v => !v); setChannelSearch(""); }}
                className={cn(
                  "w-full rounded-[6px] border border-border bg-background px-3 py-2 text-left",
                  "text-sm transition-colors",
                  selectedChannelId ? "text-foreground" : "text-muted-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
                  channelDropdownOpen && "ring-2 ring-primary/30 border-primary"
                )}
              >
                {selectedChannelId ? `#${selectedChannelName}` : "Select a channel…"}
              </button>

              {/* Dropdown */}
              {channelDropdownOpen && (
                <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-[8px] shadow-lg overflow-hidden">
                  {/* Search input */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <input
                      autoFocus
                      type="text"
                      value={channelSearch}
                      onChange={e => setChannelSearch(e.target.value)}
                      placeholder="Search channels…"
                      className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  {/* Channel list */}
                  <ul className="max-h-56 overflow-y-auto py-1">
                    {channels
                      .filter(c => c.name.toLowerCase().includes(channelSearch.toLowerCase()))
                      .map(c => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedChannelId(c.id);
                              setSelectedChannelName(c.name);
                              setChannelDropdownOpen(false);
                            }}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors",
                              selectedChannelId === c.id ? "text-primary font-medium" : "text-foreground"
                            )}
                          >
                            #{c.name}
                          </button>
                        </li>
                      ))}
                    {channels.filter(c => c.name.toLowerCase().includes(channelSearch.toLowerCase())).length === 0 && (
                      <li className="px-3 py-2 text-xs text-muted-foreground">No channels match</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-2 px-3 rounded-[6px] border border-dashed border-border">
              {settings?.botToken
                ? "No channels found — check your bot token has channels:read and channels:join scopes"
                : "Save a bot token first, then select a channel"}
              {selectedChannelName && (
                <span className="block mt-1 text-foreground font-medium">
                  Currently: #{selectedChannelName}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Enable toggle */}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-foreground">Enable Slack agent</p>
            <p className="text-xs text-muted-foreground">
              When enabled, messages in the selected channel get AI responses
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            title={enabled ? "Disable" : "Enable"}
            aria-label={enabled ? "Disable Slack agent" : "Enable Slack agent"}
            style={{ WebkitAppearance: "none" }}
            data-r10n-settings-toggle
            data-state={enabled ? "on" : "off"}
            className={cn(
              "relative inline-flex items-center w-10 h-5.5 rounded-full transition-colors shrink-0 cursor-pointer border-0 p-0",
              enabled ? "bg-primary" : "bg-muted-foreground/30"
            )}
          >
            <span
              className={cn(
                "inline-block w-4 h-4 rounded-full bg-white shadow transition-transform duration-200",
                enabled ? "translate-x-[22px]" : "translate-x-[2px]"
              )}
            />
          </button>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
              "bg-primary text-white hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {saveMutation.isPending && (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            )}
            Save settings
          </button>

          {saveSuccess && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
          {saveMutation.isError && (
            <span className="text-xs text-destructive">
              Failed to save. Please try again.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
