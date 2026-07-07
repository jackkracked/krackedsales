"use client";

import { useState } from "react";
import { Send, Check, Loader2, Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { PreviewScenario } from "@/lib/reminders/variables";

export function PreviewPane({
  subject,
  html,
  loading,
  scenarios,
  scenarioId,
  onScenario,
  onSendTest,
  testState,
}: {
  subject: string;
  html: string;
  loading: boolean;
  scenarios: PreviewScenario[];
  scenarioId: string;
  onScenario: (id: string) => void;
  onSendTest: (to: string) => void;
  testState: "idle" | "sending" | "sent" | "error";
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");

  function submitTest() {
    onSendTest(testEmail.trim());
    setTestOpen(false);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview as</span>
          <select
            value={scenarioId}
            onChange={(e) => onScenario(e.target.value)}
            aria-label="Preview scenario"
            className="rounded-[6px] border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-[6px] border border-border">
            {(["desktop", "mobile"] as const).map((d) => {
              const Icon = d === "desktop" ? Monitor : Smartphone;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDevice(d)}
                  aria-label={`${d} preview`}
                  aria-pressed={device === d}
                  className={cn(
                    "px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                    device === d ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setTestOpen((o) => !o)}
              disabled={testState === "sending"}
              aria-haspopup="dialog"
              aria-expanded={testOpen}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                testState === "sent"
                  ? "border-success/40 text-success"
                  : testState === "error"
                  ? "border-destructive/40 text-destructive"
                  : "border-border text-foreground hover:bg-muted/60",
              )}
            >
              {testState === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : testState === "sent" ? <Check className="h-3.5 w-3.5" />
                : <Send className="h-3.5 w-3.5" />}
              {testState === "sent" ? "Test sent" : testState === "error" ? "Try again" : "Send a test"}
            </button>

            {testOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setTestOpen(false)} aria-hidden />
                <div role="dialog" aria-label="Send a test email"
                  className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-[10px] border border-border bg-card p-3 shadow-lg">
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Send a test to</label>
                  <input
                    type="email"
                    autoFocus
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitTest(); if (e.key === "Escape") setTestOpen(false); }}
                    placeholder="Defaults to your email"
                    className="w-full rounded-[7px] border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <div className="mt-2.5 flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setTestOpen(false)}
                      className="rounded-[6px] px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                      Cancel
                    </button>
                    <button type="button" onClick={submitTest}
                      className="inline-flex items-center gap-1.5 rounded-[6px] bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                      <Send className="h-3 w-3" /> Send test
                    </button>
                  </div>
                  {testState === "error" && <p className="mt-2 text-xs text-destructive">Couldn&apos;t send, check the address and try again.</p>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Inbox-style subject line */}
      <div className="border-b border-border bg-muted/30 px-5 py-2.5" aria-live="polite">
        <p className="truncate text-sm font-semibold text-foreground">
          {subject || <span className="text-muted-foreground">No subject</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">Kracked Retention · proposals@krackedretention.com</p>
      </div>

      {/* The rendered email */}
      <div className="relative flex-1 overflow-auto bg-[#f0ede8] p-4">
        {loading && (
          <div role="status" className="absolute right-6 top-6 z-10 flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
            <Loader2 className="h-3 w-3 animate-spin" /> updating
          </div>
        )}
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={html}
          className={cn(
            "mx-auto block h-full min-h-[520px] rounded-[8px] border border-black/5 bg-white shadow-sm transition-[max-width] duration-300",
            device === "mobile" ? "max-w-[390px]" : "max-w-[680px]",
          )}
          style={{ width: "100%" }}
        />
      </div>
    </div>
  );
}
