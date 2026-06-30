"use client";

import { useState, useCallback } from "react";
import { Mail, ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Collapsed email card for the dialer cockpit conversation. Shows just the
 * subject line; expands to lazily fetch + render the real HTML email in a
 * sandboxed iframe (no script execution). Mirrors the inbox email card so the
 * cockpit never dumps raw GHL [storage.googleapis…] bodies as plain text.
 */
export function EmailCard({
  subject,
  fetchId,
  dir,
  time,
  fallbackBody,
}: {
  subject: string;
  fetchId?: string;
  dir: "in" | "out";
  time: string;
  fallbackBody?: string;
}) {
  const sentByUs = dir === "out";
  const [expanded, setExpanded] = useState(false);
  const [html, setHtml] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (html !== undefined || loading || !fetchId) {
      if (!fetchId) setHtml(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/ghl/conversations/messages/email/${fetchId}`);
      const data = res.ok ? await res.json() : {};
      const raw = data.html ?? data.htmlBody ?? data.body ?? null;
      // Only render in the iframe if it actually looks like HTML; otherwise fall back
      // to the cleaned plain-text body (strips the [storage.googleapis…] noise).
      const looksHtml = typeof raw === "string" && /<[a-z][\s\S]*>/i.test(raw);
      setHtml(looksHtml ? raw : null);
    } catch {
      setHtml(null);
    } finally {
      setLoading(false);
    }
  }, [fetchId, html, loading]);

  function toggle() {
    setExpanded((e) => {
      const next = !e;
      if (next) void load();
      return next;
    });
  }

  // Strip GHL's [storage.googleapis…] placeholders for the plain-text fallback.
  const cleanedFallback = (fallbackBody ?? "")
    .replace(/\[https?:\/\/storage\.googleapis\.com\/[^\]]+\]/g, "")
    .replace(/https?:\/\/storage\.googleapis\.com\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return (
    <div className={cn("flex w-full", sentByUs ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "w-[92%] overflow-hidden rounded-[12px] border",
          sentByUs ? "border-info/30" : "border-border",
        )}
      >
        {/* Strip */}
        <div
          className={cn(
            "flex items-center gap-1.5 border-b px-3 py-1.5",
            sentByUs ? "border-info/15 bg-info/8" : "border-border bg-muted/60",
          )}
        >
          <Mail className={cn("h-3 w-3 shrink-0", sentByUs ? "text-info" : "text-muted-foreground")} />
          <span
            className={cn(
              "flex-1 text-[9.5px] font-bold uppercase tracking-[0.14em]",
              sentByUs ? "text-info" : "text-muted-foreground",
            )}
          >
            {sentByUs ? "Email sent" : "Email received"}
          </span>
          <span className="text-[9.5px] text-muted-foreground/70">{time}</span>
        </div>

        {/* Subject + toggle */}
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left transition-colors",
            sentByUs ? "bg-info/[0.04] hover:bg-info/[0.08]" : "bg-muted/20 hover:bg-muted/40",
          )}
        >
          <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-snug text-foreground">{subject}</p>
          <ChevronDown
            className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
          />
        </button>

        {/* Expanded body */}
        {expanded && (
          <div className="border-t border-border/50">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-7 text-[12px] text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading email…
              </div>
            ) : html ? (
              <iframe
                srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;line-height:1.5;color:#111;background:#fff;}img{max-width:100%;height:auto;}a{color:#2563EB;}</style></head><body>${html}</body></html>`}
                sandbox="allow-same-origin allow-popups"
                className="w-full border-none bg-white"
                style={{ minHeight: 180 }}
                onLoad={(e) => {
                  const doc = e.currentTarget.contentDocument;
                  if (doc) e.currentTarget.style.height = Math.min(doc.documentElement.scrollHeight, 560) + "px";
                }}
                title={`Email: ${subject}`}
              />
            ) : cleanedFallback ? (
              <div className="whitespace-pre-wrap bg-muted/10 px-3 py-3 text-[11.5px] leading-relaxed text-foreground/80">
                {cleanedFallback}
              </div>
            ) : (
              <div className="bg-muted/10 px-3 py-3 text-[11.5px] italic text-muted-foreground">
                Email body not available (sent via an automation).
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
