"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
  X,
  ClipboardCheck,
  RefreshCw,
  CheckCircle2,
  Check,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  cleanUrl,
  looksLikeUrl,
  parseQualificationNote,
  isQualificationNote,
} from "@/lib/utils/url";

// ─── Constants ────────────────────────────────────────────────────────────────

const ESP_OPTIONS = [
  { label: "Klaviyo", value: "df9acf10" },
  { label: "Omnisend", value: "adc22cfb" },
  { label: "Shopify Email", value: "dfe20c29" },
  { label: "Mailchimp", value: "7cbd447e" },
  { label: "Other", value: "d7d21a8a" },
] as const;

const MANAGEMENT_OPTIONS = [
  { label: "Yes", value: "3b89e8e5" },
  { label: "No", value: "4caa99f9" },
] as const;

const FLOWS_OPTIONS = [
  { label: "Flow Rebuild + New Flows", value: "f8ac314b" },
  { label: "Only New Flows", value: "0e960b1e" },
  { label: "Only Flow Rebuild", value: "215f65c4" },
  { label: "No", value: "8fbbc263" },
] as const;

const HIRO_OPTIONS = [
  { label: "Yes", value: "83ad1fe3" },
  { label: "No", value: "46994a19" },
] as const;
const HIRO_DEFAULT = "46994a19"; // "No"

const TEAM_MEMBERS = [
  { id: 37650582, name: "Aaron Bermingham" },
  { id: 37650548, name: "Gage Flesher" },
  { id: 57251314, name: "Jack Pointer" },
  { id: 55589370, name: "Fenn" },
  { id: 89175872, name: "Sway Romero" },
  { id: 50228472, name: "Jamella Guerrero" },
  { id: 89247904, name: "Tyler Sewell" },
  { id: 89223526, name: "Austyn Kazmierczak" },
  { id: 89189645, name: "Leslie Vasquez" },
  { id: 89268319, name: "Sofia Saroyan" },
  { id: 89275732, name: "Kimverlyn Sayson" },
  { id: 89277688, name: "Hazel" },
  { id: 32270056, name: "Divya Ganatra" },
  { id: 38475233, name: "Jolly Rose Quintal" },
  { id: 95359404, name: "Aaron Magalong" },
  { id: 89355635, name: "Verdi Natad" },
  { id: 89323066, name: "Sydney Wolfington" },
  { id: 89320822, name: "Arham Murtaza" },
  { id: 61211916, name: "Shyam Agarwal" },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function domainToBrandName(website: string): string {
  const domain = website
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(".")[0]
    .replace(/[-_]/g, " ");
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

function memberIdForName(name?: string | null): number | null {
  if (!name) return null;
  const lc = name.trim().toLowerCase();
  const exact = TEAM_MEMBERS.find((m) => m.name.toLowerCase() === lc);
  if (exact) return exact.id;
  // fall back to first-name match (e.g. "Jack" → "Jack Pointer")
  const first = lc.split(/\s+/)[0];
  const partial = TEAM_MEMBERS.find((m) => m.name.toLowerCase().split(/\s+/)[0] === first);
  return partial?.id ?? null;
}

// ─── Field primitives (shared "request modal" language) ──────────────────────

function Field({ label, required, marker, children }: { label: string; required?: boolean; marker?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2 h-4">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          {label}
          {required && <span className="text-destructive">*</span>}
        </label>
        {marker}
      </div>
      {children}
    </div>
  );
}

function AutoMarker() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary/55">
      <Check className="w-3 h-3" /> auto
    </span>
  );
}

const FIELD_BASE =
  "w-full h-[42px] text-sm px-3 rounded-[9px] border bg-background text-foreground placeholder:text-muted-foreground/55 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors";

function TextInput({ value, onChange, placeholder, prefilled, loading, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; prefilled?: boolean; loading?: boolean; type?: string }) {
  return (
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(FIELD_BASE, prefilled ? "border-primary/25 bg-primary/[0.03]" : "border-border")}
      />
      {loading && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />}
    </div>
  );
}

function SelectField<T extends string>({ value, onChange, options, placeholder }: { value: T | ""; onChange: (v: T) => void; options: readonly { label: string; value: T }[]; placeholder?: string }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(FIELD_BASE, "border-border appearance-none cursor-pointer pr-9", !value && "text-muted-foreground/55")}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
    </div>
  );
}

function MemberSelect({ value, onChange, placeholder }: { value: number | null; onChange: (id: number | null) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className={cn(FIELD_BASE, "appearance-none cursor-pointer pr-9", value ? "border-primary/25 bg-primary/[0.03]" : "border-border text-muted-foreground/55")}
      >
        <option value="">{placeholder ?? "Select person…"}</option>
        {TEAM_MEMBERS.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
    </div>
  );
}

function MultiMemberSelect({ value, onChange, placeholder }: { value: number[]; onChange: (ids: number[]) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  const label = value.length === 0
    ? placeholder ?? "Select people…"
    : value.map((id) => TEAM_MEMBERS.find((m) => m.id === id)?.name ?? id).join(", ");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(FIELD_BASE, "flex items-center justify-between gap-2 text-left", value.length ? "border-primary/25 bg-primary/[0.03]" : "border-border text-muted-foreground/55")}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-card border border-border rounded-[9px] shadow-lg max-h-48 overflow-y-auto py-1">
          {TEAM_MEMBERS.map((m) => {
            const checked = value.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                className={cn("w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors hover:bg-muted", checked ? "text-foreground" : "text-muted-foreground")}
              >
                <span className={cn("w-4 h-4 rounded-[4px] border shrink-0 flex items-center justify-center", checked ? "bg-primary border-primary" : "border-border bg-background")}>
                  {checked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                </span>
                {m.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SegmentedYesNo({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly { label: string; value: string }[] }) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(value === o.value ? "" : o.value)}
          className={cn(
            "flex-1 h-[42px] text-sm font-medium rounded-[9px] border transition-all",
            value === o.value
              ? "bg-primary text-primary-foreground border-primary shadow-[0_2px_8px_-2px_rgba(15,58,92,0.5)]"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground bg-background"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CreateAuditModalProps {
  contactId?: string;
  contactName?: string;
  onClose: () => void;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function CreateAuditModal({ contactId, contactName, onClose }: CreateAuditModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — the client
  const [brandName, setBrandName] = useState("");
  const [website, setWebsite] = useState("");
  const [esp, setEsp] = useState<string>("");
  const [clientContact, setClientContact] = useState<number | null>(null);

  // Step 2 — the work
  const [management, setManagement] = useState("");
  const [flows, setFlows] = useState("");
  const [hiroPull, setHiroPull] = useState(HIRO_DEFAULT);
  const [details, setDetails] = useState("");
  const [strategist, setStrategist] = useState<number | null>(null);
  const [reviewer, setReviewer] = useState<number[]>([]);

  // UI state
  const [loadingWebsite, setLoadingWebsite] = useState(false);
  const [websitePrefilled, setWebsitePrefilled] = useState(false);
  const [step1Error, setStep1Error] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState("");
  const [defaulted, setDefaulted] = useState(false);

  // Default the three person fields to the creator (logged-in user → ClickUp member)
  const { data: me } = useQuery<{ name?: string }>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/me").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (defaulted || !me?.name) return;
    const id = memberIdForName(me.name);
    if (id) {
      setStrategist((s) => s ?? id);
      setReviewer((r) => (r.length ? r : [id]));
      setClientContact((c) => c ?? id);
    }
    setDefaulted(true);
  }, [me, defaulted]);

  // Auto-fill brand + website from the GHL qualification note (hard data)
  useEffect(() => {
    if (!contactId) return;
    setLoadingWebsite(true);
    fetch(`/api/ghl/contacts/${contactId}/notes`)
      .then((r) => r.json())
      .then((data) => {
        const notes: Array<{ body: string }> = data.notes ?? [];
        const qualNote = notes.find((n) => isQualificationNote(n.body));
        if (!qualNote) return;
        const qaPairs = parseQualificationNote(qualNote.body);
        const urlPair = qaPairs.find((qa) => qa.isUrl);
        const raw = urlPair?.cleanedUrl ?? null;
        if (raw && looksLikeUrl(raw)) {
          const cleaned = cleanUrl(raw).toLowerCase().replace(/\/$/, "");
          setWebsite(cleaned);
          setBrandName(domainToBrandName(cleaned));
          setWebsitePrefilled(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingWebsite(false));
  }, [contactId]);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleNext() {
    if (!brandName.trim()) { setStep1Error("Brand name is required."); return; }
    setStep1Error("");
    setStep(2);
  }

  async function handleSubmit() {
    if (status === "submitting") return;
    setStatus("submitting");
    setSubmitError("");
    try {
      const res = await fetch("/api/clickup/create-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName,
          website,
          esp: esp || undefined,
          management: management || undefined,
          flows: flows || undefined,
          hiroPull: hiroPull || undefined,
          details: details || undefined,
          strategist: strategist ?? undefined,
          reviewer: reviewer.length ? reviewer : undefined,
          clientContact: clientContact ? [clientContact] : undefined,
          ghlContactId: contactId,
        }),
      });
      if (!res.ok) throw new Error("API error");
      setStatus("success");
      setTimeout(onClose, 1400);
    } catch {
      setStatus("error");
      setSubmitError("Couldn't create audit — please try again.");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  const isDirty = brandName || website || esp || management || flows || details;
  function handleClose() {
    if (isDirty && status === "idle") {
      if (!confirm("Discard this audit?")) return;
    }
    onClose();
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay backdrop-blur-[2px] animate-fade-in" onClick={handleClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create audit"
        className="relative bg-card border border-border rounded-[16px] w-full max-w-[540px] shadow-[0_28px_70px_-24px_rgba(28,35,51,0.4)] ring-1 ring-black/[0.03] flex flex-col max-h-[90vh] animate-scale-in-flex"
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center">
                <ClipboardCheck className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground leading-tight" style={{ fontFamily: "var(--font-heading)" }}>Create Audit</h2>
                {contactName && <p className="text-[11px] text-muted-foreground">for {contactName}</p>}
              </div>
            </div>
            <button onClick={handleClose} aria-label="Close" className="p-1.5 rounded-[8px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Step rail */}
          <div className="mt-4 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-primary transition-all" />
            <div className={cn("h-1 flex-1 rounded-full transition-all", step === 2 ? "bg-primary" : "bg-border")} />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest ml-1.5 whitespace-nowrap">
              Step {step} · {step === 1 ? "Client" : "Work"}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {step === 1 ? (
            <div className="space-y-4">
              <Field label="Brand Name" required marker={websitePrefilled ? <AutoMarker /> : undefined}>
                <TextInput value={brandName} onChange={(v) => { setBrandName(v); setStep1Error(""); }} placeholder="e.g. Knottytie" prefilled={websitePrefilled} loading={loadingWebsite} />
                {step1Error && <p className="text-xs text-destructive mt-1">{step1Error}</p>}
              </Field>

              <Field label="Website" marker={websitePrefilled ? <AutoMarker /> : undefined}>
                <TextInput
                  value={website}
                  onChange={(v) => { setWebsite(v); if (!brandName || websitePrefilled) setBrandName(domainToBrandName(v)); }}
                  placeholder="https://brand.com"
                  prefilled={websitePrefilled}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="ESP">
                  <SelectField value={esp} onChange={setEsp} options={ESP_OPTIONS} placeholder="Select ESP…" />
                </Field>
                <Field label="Client Contact">
                  <MemberSelect value={clientContact} onChange={setClientContact} placeholder="Select person…" />
                </Field>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Pitch management?">
                  <SelectField value={management} onChange={setManagement} options={MANAGEMENT_OPTIONS} placeholder="Select…" />
                </Field>
                <Field label="Pitch flow buildout?">
                  <SelectField value={flows} onChange={setFlows} options={FLOWS_OPTIONS} placeholder="Select…" />
                </Field>
              </div>

              <Field label="Pull Hiro analytics?">
                <SegmentedYesNo value={hiroPull} onChange={setHiroPull} options={HIRO_OPTIONS} />
              </Field>

              <Field label="Relevant Details">
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Context from the call, goals, or notes for the audit…"
                  rows={3}
                  className="w-full text-sm px-3 py-2.5 border border-border rounded-[9px] bg-background text-foreground placeholder:text-muted-foreground/55 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Strategist">
                  <MemberSelect value={strategist} onChange={setStrategist} placeholder="Assign strategist…" />
                </Field>
                <Field label="Reviewer">
                  <MultiMemberSelect value={reviewer} onChange={setReviewer} placeholder="Assign reviewer(s)…" />
                </Field>
              </div>

              {submitError && <p className="text-xs text-destructive">{submitError}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-4 flex gap-2.5 shrink-0 border-t border-border">
          {step === 1 ? (
            <>
              <button type="button" onClick={handleClose} className="px-4 h-[42px] text-sm font-medium text-foreground border border-border rounded-[9px] hover:bg-muted transition-colors">Cancel</button>
              <button type="button" onClick={handleNext} className="flex-1 h-[42px] text-sm font-bold rounded-[9px] bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.99] transition-all flex items-center justify-center gap-1.5 shadow-sm">
                Next <ArrowRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep(1)} className="px-4 h-[42px] text-sm font-medium text-foreground border border-border rounded-[9px] hover:bg-muted transition-colors flex items-center gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={status === "submitting"}
                className={cn(
                  "flex-1 h-[42px] text-sm font-bold rounded-[9px] transition-all flex items-center justify-center gap-2 shadow-sm active:scale-[0.99]",
                  status === "success" ? "bg-accent-green text-white"
                    : status === "submitting" ? "bg-primary/70 text-primary-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {status === "submitting" && <RefreshCw className="w-4 h-4 animate-spin" />}
                {status === "success" && <CheckCircle2 className="w-4 h-4" />}
                {status === "success" ? "Audit Created" : status === "submitting" ? "Creating…" : "Create Audit"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
