"use client";

import { useState, useEffect } from "react";
import { X, Layers, CheckCircle2, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { cleanUrl, looksLikeUrl } from "@/lib/utils/url";
import { deriveWebsite } from "@/lib/ghl/qualification";

// ─── Constants ────────────────────────────────────────────────────────────────

const EMAIL_TYPES = [
  "Welcome",
  "Abandoned Cart",
  "Browse Abandonment",
  "Post-Purchase",
  "Campaign",
  "Product Release",
  "Winback",
] as const;

const LEAD_SOURCES = [
  "INSTAGRAM (MAIN ACCOUNT)",
  "INSTAGRAM (BTS ACCOUNT)",
  "GHL",
  "LinkedIn",
  "Manual",
  "TikTok",
] as const;

const CONTACT_METHODS = ["Social Media", "Email", "Phone", "WhatsApp"] as const;

const WEBHOOK_URL = "/api/webhooks/demo";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function domainToBrandName(website: string): string {
  const domain = website
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(".")[0]
    .replace(/[-_]/g, " ");
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
      {children}
      {required && <span className="text-destructive">*</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  prefilled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  prefilled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full text-sm px-3 py-2.5 border rounded-[8px] bg-background text-foreground placeholder:text-muted-foreground/60",
        "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors",
        prefilled ? "border-primary/25 bg-primary/3" : "border-border"
      )}
    />
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full text-sm px-3 py-2.5 border border-border rounded-[8px] bg-background text-foreground",
        "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors",
        "appearance-none cursor-pointer",
        !value && "text-muted-foreground/60"
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mt-1">
      {children}
    </p>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface CreateDemoModalProps {
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  opportunityId?: string;
  commentLeadId?: string;
  opportunitySource?: string;
  /** Set when opened from a Meta/TikTok conversation — drives "demo creates a real
   *  GHL lead, source-tagged" in the demo webhook. */
  platform?: "instagram" | "facebook" | "tiktok";
  /** Meta participant id for a DM (no comment lead row yet), stored on the mirror. */
  participantId?: string;
  /** Prefill from data we already have on the lead (Task B) — all editable. */
  defaultWebsite?: string;
  defaultSocialHandle?: string;
  onClose: () => void;
}

function inferLeadSource(source?: string): string {
  if (!source) return "GHL";
  const s = source.toLowerCase();
  if (s.includes("tiktok") || s.includes("tik tok")) return "TikTok";
  if (s.includes("instagram")) return "INSTAGRAM (MAIN ACCOUNT)";
  if (s.includes("linkedin")) return "LinkedIn";
  // FB / Facebook / default GHL funnel
  return "GHL";
}

export function CreateDemoModal({
  contactId,
  contactName,
  contactEmail,
  contactPhone,
  opportunityId,
  commentLeadId,
  opportunitySource,
  platform,
  participantId,
  defaultWebsite,
  defaultSocialHandle,
  onClose,
}: CreateDemoModalProps) {
  // Prefill website + brand from data we already have (editable). cleanUrl normalizes raw input.
  const cleanedDefaultWebsite = defaultWebsite
    ? cleanUrl(defaultWebsite).toLowerCase().replace(/\/$/, "")
    : "";
  const [brandName, setBrandName] = useState(
    cleanedDefaultWebsite ? domainToBrandName(cleanedDefaultWebsite) : ""
  );
  const [website, setWebsite] = useState(cleanedDefaultWebsite);
  const [emailType, setEmailType] = useState("");
  const [designNotes, setDesignNotes] = useState("");
  const [leadSource, setLeadSource] = useState(() => inferLeadSource(opportunitySource));
  const [contactMethod, setContactMethod] = useState("");
  const [email, setEmail] = useState(contactEmail ?? "");
  const [phone, setPhone] = useState(contactPhone ?? "");
  const [socialHandle, setSocialHandle] = useState(defaultSocialHandle ?? "");

  const [loadingWebsite, setLoadingWebsite] = useState(false);
  const [websitePrefilled, setWebsitePrefilled] = useState(!!cleanedDefaultWebsite);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  // Prefill website from the contact (form-agnostic: standard field → custom field
  // → note), skipping when we already prefilled from known data.
  useEffect(() => {
    if (!contactId || cleanedDefaultWebsite) return;
    setLoadingWebsite(true);
    (async () => {
      try {
        const contactRes = await fetch(`/api/ghl/contacts/${contactId}`);
        const contactData = contactRes.ok ? await contactRes.json() : null;
        const contact = contactData?.contact ?? null;
        let raw = deriveWebsite(contact);
        if (!raw) {
          const notesRes = await fetch(`/api/ghl/contacts/${contactId}/notes`);
          if (notesRes.ok) {
            const notesData = await notesRes.json();
            raw = deriveWebsite(contact, notesData.notes ?? []);
          }
        }
        if (raw && looksLikeUrl(raw)) {
          const cleaned = cleanUrl(raw).toLowerCase().replace(/\/$/, "");
          setWebsite(cleaned);
          setBrandName(domainToBrandName(cleaned));
          setWebsitePrefilled(true);
        }
      } catch {
        /* prefill is best-effort */
      } finally {
        setLoadingWebsite(false);
      }
    })();
  }, [contactId]);

  const canSubmit =
    brandName.trim() &&
    website.trim() &&
    emailType &&
    leadSource &&
    status === "idle";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("sending");
    setError("");

    try {
      const payload = {
        "Brand Name": brandName.trim(),
        "Website": website.trim(),
        "Email Type": emailType,
        "Email Design Notes": designNotes.trim(),
        "Lead Source": leadSource,
        "Preferred Contact Method": contactMethod,
        "Email": email.trim(),
        "Phone": phone.trim(),
        "Social Media Handle": socialHandle.trim(),
        "Contact Name": contactName ?? "",
        "Opportunity ID": opportunityId ?? "",
        "Comment Lead ID": commentLeadId ?? "",
        // When set (Meta/TikTok conversation), the demo webhook creates a real GHL lead
        // tagged with this platform. Empty for normal GHL email leads.
        "Lead Platform": platform ?? "",
        "Participant ID": participantId ?? "",
      };

      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Webhook failed");
      }
      setStatus("sent");
      setTimeout(onClose, 1500);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to send. Please try again.");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
    >
      <div className="bg-card border border-border rounded-[14px] w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[8px] bg-primary/10 flex items-center justify-center">
              <Layers className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                Create Demo
              </h2>
              {contactName && (
                <p className="text-xs text-muted-foreground">for {contactName}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[7px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="px-6 py-5 space-y-5">

            {/* Brand section */}
            <div>
              <SectionHeader>Brand</SectionHeader>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="space-y-1.5">
                  <Label required>Brand Name</Label>
                  <Input
                    value={brandName}
                    onChange={setBrandName}
                    placeholder="e.g. Knottytie"
                    prefilled={websitePrefilled}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label required>
                    Website
                    {loadingWebsite && (
                      <RefreshCw className="w-3 h-3 animate-spin ml-1 text-muted-foreground" />
                    )}
                  </Label>
                  <Input
                    value={website}
                    onChange={(v) => {
                      setWebsite(v);
                      if (!brandName || websitePrefilled) setBrandName(domainToBrandName(v));
                    }}
                    placeholder="https://brand.com"
                    prefilled={websitePrefilled}
                  />
                </div>
              </div>
            </div>

            {/* Email section */}
            <div>
              <SectionHeader>Email Demo</SectionHeader>
              <div className="space-y-3 mt-3">
                <div className="space-y-1.5">
                  <Label required>Email Type</Label>
                  <div className="flex flex-wrap gap-2">
                    {EMAIL_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setEmailType(t)}
                        className={cn(
                          "px-3 py-1.5 text-xs font-medium rounded-full border transition-all",
                          emailType === t
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground bg-background"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Design Notes</Label>
                  <textarea
                    value={designNotes}
                    onChange={(e) => setDesignNotes(e.target.value)}
                    placeholder="Any specific design direction, references, or notes…"
                    rows={2}
                    className="w-full text-sm px-3 py-2.5 border border-border rounded-[8px] bg-background text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Contact section */}
            <div>
              <SectionHeader>Contact</SectionHeader>
              <div className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label required>Lead Source</Label>
                    <Select
                      value={leadSource}
                      onChange={setLeadSource}
                      options={LEAD_SOURCES}
                      placeholder="Select source…"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Preferred Contact</Label>
                    <Select
                      value={contactMethod}
                      onChange={setContactMethod}
                      options={CONTACT_METHODS}
                      placeholder="Select method…"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      value={email}
                      onChange={setEmail}
                      placeholder="hello@brand.com"
                      type="email"
                      prefilled={!!contactEmail}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input
                      value={phone}
                      onChange={setPhone}
                      placeholder="+1 234 567 8900"
                      prefilled={!!contactPhone}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Social Media Handle</Label>
                  <Input
                    value={socialHandle}
                    onChange={setSocialHandle}
                    placeholder="@handle"
                  />
                </div>
              </div>
            </div>

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 pb-5 pt-1 flex gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-none px-4 py-2.5 text-sm font-medium text-foreground border border-border rounded-[8px] hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "flex-1 py-2.5 text-sm font-bold rounded-[8px] transition-all duration-300 flex items-center justify-center gap-2",
                status === "sent"
                  ? "bg-green-600 text-white"
                  : canSubmit
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {status === "sending" && <RefreshCw className="w-4 h-4 animate-spin" />}
              {status === "sent" && <CheckCircle2 className="w-4 h-4" />}
              {status === "sent"
                ? "Demo Started!"
                : status === "sending"
                ? "Starting…"
                : "Start Demo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
