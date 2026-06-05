"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";
import {
  X,
  Download,
  RefreshCw,
  Phone,
  Mail,
  Globe,
  Loader2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import { GenerationScreen } from "./generation-screen";
import { PrepDocument } from "./prep-document";
import type { CallPrepData, GenerationStep } from "@/lib/call-prep/types";
import { GENERATION_STEPS } from "@/lib/call-prep/types";

interface CallPrepModalProps {
  eventId: string;
  contactId: string;
  contactName: string;
  startTime: string;
  onClose: () => void;
}

export function CallPrepModal({
  eventId,
  contactId,
  contactName,
  startTime,
  onClose,
}: CallPrepModalProps) {
  const tz = useUserTimezone();
  const [prep, setPrep] = useState<CallPrepData | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [steps, setSteps] = useState<GenerationStep[]>(
    GENERATION_STEPS.map((s) => ({ ...s, status: "pending" as const }))
  );

  const generate = useCallback(
    async (isRegenerate = false) => {
      if (isRegenerate) {
        setRegenerating(true);
      }

      // Reset steps
      setSteps(GENERATION_STEPS.map((s) => ({ ...s, status: "pending" as const })));

      try {
        // Simulate step progression with SSE-like updates
        // The actual generation happens server-side; we animate steps client-side
        const stepKeys = GENERATION_STEPS.map((s) => s.key);
        let currentStep = 0;

        const advanceSteps = () => {
          if (currentStep < stepKeys.length) {
            setSteps((prev) =>
              prev.map((s, i) => ({
                ...s,
                status:
                  i < currentStep
                    ? "complete"
                    : i === currentStep
                      ? "active"
                      : "pending",
              }))
            );
            currentStep++;
          }
        };

        // Start advancing steps on a timer
        advanceSteps(); // contact - immediate
        const stepInterval = setInterval(() => {
          advanceSteps();
          if (currentStep > stepKeys.length) {
            clearInterval(stepInterval);
          }
        }, 2500);

        const res = await fetch("/api/call-prep/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            calendarEventId: eventId,
            contactId,
            contactName,
          }),
        });

        clearInterval(stepInterval);

        if (!res.ok) throw new Error("Generation failed");

        const data = await res.json();

        // Mark all steps complete
        setSteps((prev) =>
          prev.map((s) => ({ ...s, status: "complete" as const }))
        );

        // Brief pause to show all-complete state before revealing document
        await new Promise((r) => setTimeout(r, 600));

        setPrep(data.prep);
      } catch {
        setSteps((prev) =>
          prev.map((s) =>
            s.status === "active" || s.status === "pending"
              ? { ...s, status: "failed" as const }
              : s
          )
        );
      } finally {
        setLoading(false);
        setRegenerating(false);
      }
    },
    [eventId, contactId, contactName]
  );

  // On mount: check cache first, then generate if needed
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`/api/call-prep/${eventId}`);
        const data = await res.json();

        if (data.prep?.status === "ready" && data.prep?.sections) {
          setPrep(data.prep);
          setLoading(false);
          return;
        }
      } catch {
        // Cache miss — continue to generate
      }

      generate();
    }

    init();
  }, [eventId, generate]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleDownloadPdf() {
    if (!prep?.sections) return;
    setDownloadingPdf(true);

    try {
      const { generateCallPrepPdf } = await import("./pdf-generator");
      await generateCallPrepPdf({
        contactName: prep.contactName ?? contactName,
        callType: prep.callType,
        sections: prep.sections,
        generatedAt: prep.generatedAt,
      });
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setDownloadingPdf(false);
    }
  }

  const isGenerating = loading || regenerating;
  const showDocument = !loading && prep?.status === "ready" && prep.sections;

  // Contact details from prep or fallback
  const contact = prep?.sections
    ? {
        name: prep.contactName ?? contactName,
        callType: prep.callType,
      }
    : null;

  const content = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-foreground/25 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={cn(
          "relative bg-card border border-border rounded-[16px] shadow-2xl z-10",
          "w-full max-w-[640px] max-h-[85vh] flex flex-col",
          "animate-scale-in-flex"
        )}
      >
        {/* ── Header (sticky) ──────────────────────────────────────────── */}
        <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border/60">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {/* Call type + time */}
              <div className="flex items-center gap-2 mb-1.5">
                {(contact?.callType || !loading) && (
                  <span
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full",
                      (contact?.callType ?? prep?.callType) === "intro"
                        ? "bg-gold/15 text-gold-foreground"
                        : "bg-primary/10 text-primary"
                    )}
                  >
                    {(contact?.callType ?? prep?.callType) === "intro"
                      ? "Intro"
                      : "Follow-up"}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {format(toZonedDate(new Date(startTime), tz), "EEE d MMM · h:mm a")}
                </span>
              </div>

              {/* Contact name */}
              <h2
                className="text-lg font-bold text-foreground truncate"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {contact?.name ?? contactName}
              </h2>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Contact chips */}
          <ContactChips contactId={contactId} />
        </div>

        {/* ── Body (scrollable) ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-5">
          {isGenerating && !showDocument ? (
            <GenerationScreen
              steps={steps}
              contactName={contactName}
              callType={prep?.callType ?? "intro"}
            />
          ) : showDocument ? (
            <div className={cn(regenerating && "opacity-50 pointer-events-none transition-opacity duration-200")}>
              <PrepDocument
                sections={prep.sections!}
                failedSections={prep.failedSections}
              />
            </div>
          ) : (
            // Failed state
            <div className="flex flex-col items-center justify-center min-h-[300px] text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Call prep generation failed. Try again.
              </p>
              <button
                onClick={() => generate(true)}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-[8px] hover:bg-primary/90 transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* ── Footer (sticky) ──────────────────────────────────────────── */}
        {showDocument && (
          <div className="shrink-0 px-6 py-3.5 border-t border-border/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {/* Download PDF */}
              <button
                onClick={handleDownloadPdf}
                disabled={downloadingPdf}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-[8px] transition-all",
                  "bg-gold/15 text-gold-foreground hover:bg-gold/25"
                )}
              >
                {downloadingPdf ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Download PDF
              </button>

              {/* Refresh */}
              <button
                onClick={() => generate(true)}
                disabled={regenerating}
                title="Regenerate prep"
                className="p-2 rounded-[8px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={cn(
                    "w-4 h-4",
                    regenerating && "animate-spin"
                  )}
                />
              </button>
            </div>

            {/* Timestamp */}
            {prep.generatedAt && (
              <span className="text-xs text-muted-foreground">
                Generated{" "}
                {formatDistanceToNow(new Date(prep.generatedAt), {
                  addSuffix: true,
                })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Portal to <body> so no ancestor transform (e.g. the call tile's scale) traps
  // this fixed-position modal and pushes it off-screen.
  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}

// ─── Contact chips ───────────────────────────────────────────────────────────

function ContactChips({ contactId }: { contactId: string }) {
  const [info, setInfo] = useState<{
    phone?: string;
    email?: string;
    website?: string;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/ghl/contacts/${contactId}`)
      .then((r) => r.json())
      .then((data) => {
        const c = data.contact;
        if (c) {
          setInfo({
            phone: c.phone ?? undefined,
            email: c.email ?? undefined,
            website: c.website ?? undefined,
          });
        }
      })
      .catch(() => {});
  }, [contactId]);

  if (!info) return null;

  const chips: Array<{
    icon: typeof Phone;
    href: string;
    label: string;
  }> = [];

  if (info.phone) {
    chips.push({ icon: Phone, href: `tel:${info.phone}`, label: info.phone });
  }
  if (info.email) {
    chips.push({ icon: Mail, href: `mailto:${info.email}`, label: info.email });
  }
  if (info.website) {
    const url = info.website.startsWith("http")
      ? info.website
      : `https://${info.website}`;
    const display = info.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    chips.push({ icon: Globe, href: url, label: display });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex items-center gap-2 mt-3 flex-wrap">
      {chips.map((chip, i) => {
        const Icon = chip.icon;
        return (
          <a
            key={i}
            href={chip.href}
            target={chip.href.startsWith("http") ? "_blank" : undefined}
            rel={chip.href.startsWith("http") ? "noopener noreferrer" : undefined}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted px-2.5 py-1 rounded-full transition-colors"
          >
            <Icon className="w-3 h-3" />
            {chip.label}
          </a>
        );
      })}
    </div>
  );
}
