"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface SlackSettingsData {
  demoWebhookUrl: string | null;
}

async function fetchSettings(): Promise<SlackSettingsData | null> {
  const res = await fetch("/api/slack/settings");
  if (!res.ok) throw new Error("Failed to fetch settings");
  const data = await res.json();
  return data.settings ?? null;
}

async function saveWebhookUrl(demoWebhookUrl: string) {
  const res = await fetch("/api/slack/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demoWebhookUrl }),
  });
  if (!res.ok) throw new Error("Failed to save");
}

export function N8nSettings() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState(false);

  const { data: settings } = useQuery<SlackSettingsData | null>({
    queryKey: ["slack-settings"],
    queryFn: fetchSettings,
  });

  useEffect(() => {
    if (settings?.demoWebhookUrl) setUrl(settings.demoWebhookUrl);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: saveWebhookUrl,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["slack-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate(url.trim());
  }

  const isConfigured = !!(settings?.demoWebhookUrl);

  return (
    <div className="bg-card border border-border rounded-[10px] p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/n8n-icon.svg" alt="n8n" className="w-5 h-5 rounded-[4px]" />
          <h2
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            n8n
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          {isConfigured ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              <span className="text-xs text-green-600 font-medium">Configured</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Not configured</span>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-5">
        The n8n webhook URL used to create email demos. The app POSTs to this URL when a demo is triggered.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Demo Webhook URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-instance.app.n8n.cloud/webhook/..."
            autoComplete="off"
            className={cn(
              "w-full rounded-[6px] border border-border bg-background px-3 py-2",
              "text-sm text-foreground placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            )}
          />
          <p className="text-xs text-muted-foreground">
            Use{" "}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">/webhook-test/…</code>{" "}
            for testing or{" "}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">/webhook/…</code>{" "}
            for production (workflow must be Active).
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saveMutation.isPending || !url.trim()}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
              "bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {saveMutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Save
          </button>

          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          {saveMutation.isError && (
            <span className="text-xs text-destructive">Failed to save. Try again.</span>
          )}
        </div>
      </form>
    </div>
  );
}
