"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Phone, CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface TelephonyStatus {
  connected: boolean;
  accountSid: string | null;
  callerId: string | null;
}

interface SavePayload {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  callerId: string;
}

async function fetchStatus(): Promise<TelephonyStatus> {
  const res = await fetch("/api/dialer/settings");
  if (!res.ok) throw new Error("Failed to load telephony settings");
  return res.json();
}

async function saveSettings(payload: SavePayload): Promise<TelephonyStatus> {
  const res = await fetch("/api/dialer/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || "Could not save telephony settings");
  }
  return data as TelephonyStatus;
}

const INPUT =
  "w-full rounded-[10px] border border-border bg-input px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors";

const STEPS = [
  "Go to twilio.com, create an account, and add a card so you can buy a number.",
  "Open Account → API keys & tokens → Create API key (type: Standard). Copy the SID and the Secret straight away — Twilio only shows the Secret once.",
  "Copy your Account SID from the Twilio dashboard home page (it starts with AC).",
  "Open Phone Numbers → buy a Voice-capable number, then paste it below as your Caller ID.",
];

export function TelephonySettings() {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<TelephonyStatus>({
    queryKey: ["dialer-settings"],
    queryFn: fetchStatus,
  });

  const [accountSid, setAccountSid] = useState("");
  const [apiKeySid, setApiKeySid] = useState("");
  const [apiKeySecret, setApiKeySecret] = useState("");
  const [callerId, setCallerId] = useState("");
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dialer-settings"] });
      // Never keep the secret in memory after a successful save.
      setApiKeySecret("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    saveMutation.mutate({
      accountSid: accountSid.trim(),
      apiKeySid: apiKeySid.trim(),
      apiKeySecret: apiKeySecret.trim(),
      callerId: callerId.trim(),
    });
  }

  const connected = !!status?.connected;

  return (
    <div className="rounded-[10px] border border-border bg-card p-5">
      {/* Header */}
      <div className="mb-1 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <Phone className="h-4 w-4" />
          </span>
          <h2
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Telephony · Twilio
          </h2>
        </div>

        {/* Connection status pill */}
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1",
            connected ? "bg-green-500/10" : "bg-muted",
          )}
        >
          {connected ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              <span className="text-xs font-medium text-green-600">Connected</span>
            </>
          ) : (
            <>
              <Circle className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Not connected</span>
            </>
          )}
        </div>
      </div>

      <p className="mb-5 text-xs text-muted-foreground">
        Paste your Twilio credentials to turn on the dialer. We test the connection before saving, and
        your API key secret is stored encrypted — it is never shown again.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          {/* Account SID */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Account SID</label>
            <input
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
              placeholder={status?.accountSid ?? "AC…"}
              autoComplete="off"
              className={INPUT}
            />
          </div>

          {/* API Key SID */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">API Key SID</label>
            <input
              value={apiKeySid}
              onChange={(e) => setApiKeySid(e.target.value)}
              placeholder="SK…"
              autoComplete="off"
              className={INPUT}
            />
          </div>

          {/* API Key Secret */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">API Key Secret</label>
            <input
              type="password"
              value={apiKeySecret}
              onChange={(e) => setApiKeySecret(e.target.value)}
              placeholder={connected ? "Already set — enter new value to update" : "Your API key secret"}
              autoComplete="new-password"
              className={INPUT}
            />
          </div>

          {/* Caller ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Caller ID</label>
            <input
              value={callerId}
              onChange={(e) => setCallerId(e.target.value)}
              placeholder={status?.callerId ?? "+14155550123"}
              autoComplete="off"
              className={INPUT}
            />
            <p className="text-xs text-muted-foreground">
              Your Twilio Voice number in E.164 format, e.g. +14155550123
            </p>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className={cn(
                "flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-all",
                "hover:brightness-110 active:scale-[0.99]",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {saveMutation.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              {saveMutation.isPending ? "Testing connection…" : "Save & test connection"}
            </button>

            {saved && (
              <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected and saved
              </span>
            )}
            {saveMutation.isError && (
              <span className="text-xs font-medium text-destructive">
                {(saveMutation.error as Error)?.message || "Could not save"}
              </span>
            )}
          </div>
        </form>
      )}

      {/* How to get these */}
      <div className="mt-6 rounded-[10px] border border-border bg-muted/40 p-4">
        <h3 className="mb-2.5 text-xs font-semibold text-foreground">How to get these</h3>
        <ol className="space-y-2">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-xs leading-relaxed text-muted-foreground">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
