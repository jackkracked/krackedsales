"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  ClipboardCheck,
  RefreshCw,
  CheckCircle2,
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
  prefilled,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefilled?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full text-sm px-3 py-2.5 border rounded-[8px] bg-background text-foreground placeholder:text-muted-foreground/60",
          "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors",
          prefilled ? "border-primary/25 bg-primary/3" : "border-border"
        )}
      />
      {loading && (
        <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
      )}
    </div>
  );
}

function FieldSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: T | "";
  onChange: (v: T) => void;
  options: readonly { label: string; value: T }[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        "w-full text-sm px-3 py-2.5 border border-border rounded-[8px] bg-background text-foreground",
        "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors",
        "appearance-none cursor-pointer",
        !value && "text-muted-foreground/60"
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function MemberSelect({
  value,
  onChange,
  placeholder,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={cn(
        "w-full text-sm px-3 py-2.5 border border-border rounded-[8px] bg-background text-foreground",
        "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors",
        "appearance-none cursor-pointer",
        !value && "text-muted-foreground/60"
      )}
    >
      <option value="">{placeholder ?? "Select person…"}</option>
      {TEAM_MEMBERS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

function MultiMemberSelect({
  value,
  onChange,
  placeholder,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(id: number) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  const label =
    value.length === 0
      ? placeholder ?? "Select people…"
      : value
          .map((id) => TEAM_MEMBERS.find((m) => m.id === id)?.name ?? id)
          .join(", ");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full text-sm px-3 py-2.5 border border-border rounded-[8px] bg-background",
          "flex items-center justify-between gap-2",
          "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors",
          value.length === 0 ? "text-muted-foreground/60" : "text-foreground"
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-card border border-border rounded-[8px] shadow-lg max-h-48 overflow-y-auto">
          {TEAM_MEMBERS.map((m) => {
            const checked = value.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors",
                  "hover:bg-muted",
                  checked && "text-foreground",
                  !checked && "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "w-4 h-4 rounded-[4px] border shrink-0 flex items-center justify-center",
                    checked
                      ? "bg-primary border-primary"
                      : "border-border bg-background"
                  )}
                >
                  {checked && <CheckCircle2 className="w-2.5 h-2.5 text-primary-foreground" />}
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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CreateAuditModalProps {
  contactId?: string;
  contactName?: string;
  onClose: () => void;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function CreateAuditModal({ contactId, contactName, onClose }: CreateAuditModalProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1
  const [brandName, setBrandName] = useState("");
  const [website, setWebsite] = useState("");
  const [esp, setEsp] = useState<string>("");
  const [clientContact, setClientContact] = useState<number | null>(null);

  // Step 2
  const [management, setManagement] = useState("");
  const [flows, setFlows] = useState("");
  const [hiroPull, setHiroPull] = useState("");
  const [details, setDetails] = useState("");
  const [strategist, setStrategist] = useState<number | null>(null);
  const [reviewer, setReviewer] = useState<number[]>([]);

  // UI state
  const [loadingWebsite, setLoadingWebsite] = useState(false);
  const [websitePrefilled, setWebsitePrefilled] = useState(false);
  const [step1Error, setStep1Error] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState("");

  // Auto-populate from qualification note
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

  function handleNext() {
    if (!brandName.trim()) {
      setStep1Error("Brand name is required.");
      return;
    }
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
        }),
      });

      if (!res.ok) throw new Error("API error");
      setStatus("success");
      setTimeout(onClose, 1500);
    } catch {
      setStatus("error");
      setSubmitError("Couldn't create audit — please try again.");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  const isDirty = brandName || website || esp || management || flows || hiroPull || details;

  function handleClose() {
    if (isDirty && status === "idle") {
      if (!confirm("Discard this audit?")) return;
    }
    onClose();
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
              <ClipboardCheck className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2
                className="text-sm font-bold text-foreground"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Create Audit
              </h2>
              {contactName && (
                <p className="text-xs text-muted-foreground">for {contactName}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-[7px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-border/60 shrink-0">
          <div
            className={cn(
              "h-full bg-primary transition-all duration-300 ease-out",
              step === 1 ? "w-1/2" : "w-full"
            )}
          />
        </div>

        {/* Step label */}
        <div className="px-6 pt-4 pb-0 shrink-0">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
            {step === 1 ? "Step 1 of 2 — The Client" : "Step 2 of 2 — The Work"}
          </p>
        </div>

        {/* Form body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {step === 1 ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label required>
                  Brand Name
                  {loadingWebsite && (
                    <RefreshCw className="w-3 h-3 animate-spin ml-0.5 text-muted-foreground" />
                  )}
                </Label>
                <Input
                  value={brandName}
                  onChange={(v) => { setBrandName(v); setStep1Error(""); }}
                  placeholder="e.g. Knottytie"
                  prefilled={websitePrefilled}
                />
                {step1Error && (
                  <p className="text-xs text-destructive">{step1Error}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Website</Label>
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>ESP Platform</Label>
                  <FieldSelect
                    value={esp}
                    onChange={setEsp}
                    options={ESP_OPTIONS}
                    placeholder="Select ESP…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Client Contact</Label>
                  <MemberSelect
                    value={clientContact}
                    onChange={setClientContact}
                    placeholder="Select person…"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Management Pitch</Label>
                  <FieldSelect
                    value={management}
                    onChange={setManagement}
                    options={MANAGEMENT_OPTIONS}
                    placeholder="Select…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Flow Buildout Pitch</Label>
                  <FieldSelect
                    value={flows}
                    onChange={setFlows}
                    options={FLOWS_OPTIONS}
                    placeholder="Select…"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Hiro Analytics Pull</Label>
                <div className="flex gap-2">
                  {HIRO_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setHiroPull(hiroPull === o.value ? "" : o.value)}
                      className={cn(
                        "flex-1 py-2 text-sm font-medium rounded-[8px] border transition-all",
                        hiroPull === o.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground bg-background"
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Relevant Details</Label>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Any relevant context, goals, or notes for the audit…"
                  rows={3}
                  className="w-full text-sm px-3 py-2.5 border border-border rounded-[8px] bg-background text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Strategist</Label>
                  <MemberSelect
                    value={strategist}
                    onChange={setStrategist}
                    placeholder="Assign strategist…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Reviewer</Label>
                  <MultiMemberSelect
                    value={reviewer}
                    onChange={setReviewer}
                    placeholder="Assign reviewer(s)…"
                  />
                </div>
              </div>

              {submitError && (
                <p className="text-xs text-destructive">{submitError}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 flex gap-2.5 shrink-0 border-t border-border">
          {step === 1 ? (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 text-sm font-medium text-foreground border border-border rounded-[8px] hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 py-2.5 text-sm font-bold rounded-[8px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2.5 text-sm font-medium text-foreground border border-border rounded-[8px] hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={status === "submitting"}
                className={cn(
                  "flex-1 py-2.5 text-sm font-bold rounded-[8px] transition-all flex items-center justify-center gap-2 shadow-sm",
                  status === "success"
                    ? "bg-green-600 text-white"
                    : status === "submitting"
                    ? "bg-primary/80 text-primary-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {status === "submitting" && <RefreshCw className="w-4 h-4 animate-spin" />}
                {status === "success" && <CheckCircle2 className="w-4 h-4" />}
                {status === "success"
                  ? "Audit Created!"
                  : status === "submitting"
                  ? "Creating…"
                  : "Create Audit"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
