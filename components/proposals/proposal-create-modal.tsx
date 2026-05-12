"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, ChevronRight, ChevronLeft, Search, Plus, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GHLContact {
  id: string;
  name: string;
  email: string | null;
}

interface Instalment {
  id: string;
  amount: number;
  dueDate: string;
}

interface CustomFlow {
  id: string;
  name: string;
  count: number;
  type: "email" | "sms";
}

interface FormState {
  // Step 0
  contact: GHLContact | null;
  type: "management" | "project";
  // Step 1 — Scope
  selectedFlows: Record<string, number>;    // flowId -> email/sms count
  customFlows: CustomFlow[];
  emailCampaigns: string;  // management
  smsCampaigns: string;    // management
  popUps: string;          // management
  scopeNotes: string;
  // Step 2 — Price
  totalAmount: string;
  currency: string;
  startDate: string;
  // Step 3 — Payment
  paymentStructure: "subscription" | "single" | "instalment";
  billingInterval: "day" | "week" | "month" | "year";
  billingIntervalCount: string;
  instalments: Instalment[];
  // Step 4 — Review
  notes: string;
}

// ─── Flow definitions ─────────────────────────────────────────────────────────

const EMAIL_FLOWS = [
  { id: "welcome", label: "Welcome Series" },
  { id: "browser_abandon", label: "Browser Abandonment" },
  { id: "abandoned_cart", label: "Abandoned Cart" },
  { id: "abandoned_checkout", label: "Abandoned Checkout" },
  { id: "win_back", label: "Win Back" },
  { id: "sunset", label: "Sunset" },
  { id: "post_purchase", label: "Post Purchase" },
  { id: "vip", label: "VIP" },
  { id: "back_in_stock", label: "Back in Stock" },
  { id: "price_drop", label: "Price Drop" },
  { id: "review_request", label: "Review Request" },
  { id: "birthday", label: "Birthday / Anniversary" },
  { id: "replenishment", label: "Replenishment" },
];

const SMS_FLOWS = [
  { id: "sms_welcome", label: "SMS Welcome" },
  { id: "sms_abandoned_cart", label: "SMS Abandoned Cart" },
  { id: "sms_win_back", label: "SMS Win Back" },
  { id: "sms_post_purchase", label: "SMS Post Purchase" },
  { id: "sms_browse_abandon", label: "SMS Browse Abandon" },
];

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];
const INTERVAL_OPTIONS = [
  { label: "Monthly", value: "month", count: "1" },
  { label: "Quarterly", value: "month", count: "3" },
  { label: "Bi-annually", value: "month", count: "6" },
  { label: "Yearly", value: "year", count: "1" },
];
const STEPS = ["Client & Type", "Scope", "Price", "Payment", "Review"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newInstalment(): Instalment {
  return { id: Math.random().toString(36).slice(2), amount: 0, dueDate: format(new Date(), "yyyy-MM-dd") };
}

function newCustomFlow(): CustomFlow {
  return { id: Math.random().toString(36).slice(2), name: "", count: 1, type: "email" };
}

function compileScope(form: FormState): string {
  if (form.type === "management") {
    const lines: string[] = [];
    if (parseInt(form.emailCampaigns) > 0) lines.push(`Email Campaigns: ${form.emailCampaigns}/month`);
    if (parseInt(form.smsCampaigns) > 0) lines.push(`SMS Campaigns: ${form.smsCampaigns}/month`);
    if (parseInt(form.popUps) > 0) lines.push(`Pop-ups: ${form.popUps}/month`);
    if (form.scopeNotes) lines.push(form.scopeNotes);
    return lines.join("\n");
  }

  const emailLines = EMAIL_FLOWS
    .filter(f => (form.selectedFlows[f.id] ?? 0) > 0)
    .map(f => `• ${f.label}: ${form.selectedFlows[f.id]} email${form.selectedFlows[f.id] > 1 ? "s" : ""}`);

  const smsLines = SMS_FLOWS
    .filter(f => (form.selectedFlows[f.id] ?? 0) > 0)
    .map(f => `• ${f.label}: ${form.selectedFlows[f.id]} SMS`);

  const customLines = form.customFlows
    .filter(cf => cf.name.trim() && cf.count > 0)
    .map(cf => `• ${cf.name}: ${cf.count} ${cf.type === "email" ? `email${cf.count > 1 ? "s" : ""}` : "SMS"}`);

  const sections: string[] = [];
  if (emailLines.length) sections.push(`Email Flows:\n${emailLines.join("\n")}`);
  if (smsLines.length) sections.push(`SMS Flows:\n${smsLines.join("\n")}`);
  if (customLines.length) sections.push(`Custom:\n${customLines.join("\n")}`);
  if (form.scopeNotes) sections.push(form.scopeNotes);
  return sections.join("\n\n");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={cn("h-1 rounded-full transition-all duration-300",
          i === step ? "w-6 bg-primary" : i < step ? "w-3 bg-primary/40" : "w-3 bg-muted"
        )} />
      ))}
    </div>
  );
}

function ContactSearch({ value, onChange, onClear }: {
  value: GHLContact | null;
  onChange: (c: GHLContact) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<GHLContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (value) setQuery(value.name); }, [value]);

  function search(q: string) {
    setQuery(q);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/ghl/contacts/search?q=${encodeURIComponent(q)}`);
        setResults((await res.json()).contacts ?? []);
      } finally { setLoading(false); }
    }, 300);
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input type="text" value={query} onChange={e => search(e.target.value)}
          onFocus={() => query.length >= 2 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search contacts…"
          className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
        />
      </div>
      {open && (loading || results.length > 0) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-[8px] shadow-lg z-50 overflow-hidden">
          {loading ? (
            <div className="px-3 py-2.5 text-xs text-muted-foreground">Searching…</div>
          ) : results.map(c => (
            <button key={c.id} type="button" onMouseDown={() => { onChange(c); setQuery(c.name); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors">
              <p className="text-sm font-medium text-foreground">{c.name}</p>
              {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
            </button>
          ))}
        </div>
      )}
      {value && (
        <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 bg-primary/5 border border-primary/20 rounded-[6px]">
          <Check className="w-3 h-3 text-primary shrink-0" />
          <span className="text-xs text-primary font-medium">{value.name}</span>
          {value.email && <span className="text-xs text-muted-foreground">{value.email}</span>}
          <button type="button" onClick={() => { onClear(); setQuery(""); }}
            className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// Flow pill — compact unselected, expands with count input when selected
function FlowPill({ label, count, onToggle, onCountChange, unit }: {
  label: string;
  count: number | undefined;
  onToggle: () => void;
  onCountChange: (n: number) => void;
  unit: string;
}) {
  const selected = (count ?? 0) > 0;

  if (!selected) {
    return (
      <button type="button" onClick={onToggle}
        className="px-2.5 py-1.5 rounded-[6px] border border-border bg-background text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all whitespace-nowrap">
        {label}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] border border-primary bg-primary/8 text-primary">
      <span className="text-xs font-medium whitespace-nowrap">{label}</span>
      <input
        type="number"
        value={count ?? 1}
        min={1}
        max={99}
        onChange={e => onCountChange(Math.max(1, parseInt(e.target.value) || 1))}
        onClick={e => e.stopPropagation()}
        className="w-8 text-center text-xs font-semibold bg-primary/10 border-0 rounded-[3px] text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="text-[10px] opacity-60 whitespace-nowrap">{unit}</span>
      <button type="button" onClick={onToggle} className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-foreground text-right whitespace-pre-wrap">{value}</span>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export interface ProposalCreateModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function ProposalCreateModal({ onClose, onCreated }: ProposalCreateModalProps) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [customInterval, setCustomInterval] = useState(false);

  const [form, setForm] = useState<FormState>({
    contact: null,
    type: "management",
    selectedFlows: {},
    customFlows: [],
    emailCampaigns: "",
    smsCampaigns: "",
    popUps: "",
    scopeNotes: "",
    totalAmount: "",
    currency: "USD",
    startDate: format(new Date(), "yyyy-MM-dd"),
    paymentStructure: "subscription",
    billingInterval: "month",
    billingIntervalCount: "1",
    instalments: [newInstalment(), newInstalment()],
    notes: "",
  });

  const set = useCallback(<K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: val }));
  }, []);

  function handleTypeChange(type: "management" | "project") {
    set("type", type);
    set("paymentStructure", type === "management" ? "subscription" : "single");
    setForm(prev => ({ ...prev, type, paymentStructure: type === "management" ? "subscription" : "single" }));
  }

  function toggleFlow(id: string, defaultCount = 1) {
    setForm(prev => {
      const flows = { ...prev.selectedFlows };
      if (flows[id]) { delete flows[id]; } else { flows[id] = defaultCount; }
      return { ...prev, selectedFlows: flows };
    });
  }

  function setFlowCount(id: string, count: number) {
    setForm(prev => ({ ...prev, selectedFlows: { ...prev.selectedFlows, [id]: count } }));
  }

  function updateCustomFlow(id: string, field: keyof Omit<CustomFlow, "id">, val: string | number) {
    setForm(prev => ({
      ...prev,
      customFlows: prev.customFlows.map(cf => cf.id === id ? { ...cf, [field]: val } : cf),
    }));
  }

  function removeCustomFlow(id: string) {
    setForm(prev => ({ ...prev, customFlows: prev.customFlows.filter(cf => cf.id !== id) }));
  }

  function updateInstalment(id: string, field: "amount" | "dueDate", val: string | number) {
    setForm(prev => ({ ...prev, instalments: prev.instalments.map(i => i.id === id ? { ...i, [field]: val } : i) }));
  }

  function addInstalment() {
    setForm(prev => ({ ...prev, instalments: [...prev.instalments, newInstalment()] }));
  }

  function removeInstalment(id: string) {
    setForm(prev => ({ ...prev, instalments: prev.instalments.filter(i => i.id !== id) }));
  }

  function distributeEvenly() {
    const total = parseFloat(form.totalAmount) || 0;
    const count = form.instalments.length;
    if (!count) return;
    const each = Math.round((total / count) * 100) / 100;
    setForm(prev => ({
      ...prev,
      instalments: prev.instalments.map((i, idx) => ({
        ...i,
        amount: idx === count - 1 ? Math.round((total - each * (count - 1)) * 100) / 100 : each,
      })),
    }));
  }

  function canAdvance(): boolean {
    if (step === 0) return !!form.contact;
    if (step === 2) return parseFloat(form.totalAmount) > 0;
    if (step === 3 && form.paymentStructure === "instalment") {
      const total = parseFloat(form.totalAmount) || 0;
      const sum = form.instalments.reduce((acc, i) => acc + (i.amount || 0), 0);
      return Math.abs(sum - total) < 0.01 && form.instalments.length > 0;
    }
    return true;
  }

  async function handleSubmit() {
    if (!form.contact) return;
    setSubmitting(true);
    setError("");

    try {
      const serviceDescription = compileScope(form) || null;
      const payload: Record<string, unknown> = {
        type: form.type,
        ghlContactId: form.contact.id,
        contactName: form.contact.name,
        contactEmail: form.contact.email,
        serviceDescription,
        totalAmount: parseFloat(form.totalAmount),
        currency: form.currency.toLowerCase(),
        paymentStructure: form.paymentStructure,
        startDate: form.startDate || null,
        notes: form.notes || null,
      };

      if (form.paymentStructure === "subscription") {
        payload.billingInterval = form.billingInterval;
        payload.billingIntervalCount = parseInt(form.billingIntervalCount) || 1;
      }

      if (form.paymentStructure === "instalment") {
        payload.instalments = form.instalments.map((i, idx) => ({
          number: idx + 1, amount: i.amount, dueDate: i.dueDate,
        }));
      }

      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create proposal");
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const isLastStep = step === STEPS.length - 1;
  const instalmentSum = form.instalments.reduce((acc, i) => acc + (i.amount || 0), 0);
  const totalAmt = parseFloat(form.totalAmount) || 0;
  const instalmentDiff = Math.abs(instalmentSum - totalAmt);
  const currencySymbol = form.currency === "USD" ? "$" : form.currency === "EUR" ? "€" : form.currency === "GBP" ? "£" : "";
  const scopePreview = compileScope(form);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-foreground/25 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-t-[16px] sm:rounded-[14px] shadow-xl w-full sm:max-w-lg z-10 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              New Proposal
            </h2>
            <div className="flex items-center gap-3">
              <StepIndicator step={step} total={STEPS.length} />
              <span className="text-[11px] text-muted-foreground">{STEPS[step]}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {/* ── Step 0: Client & Type ── */}
          {step === 0 && (
            <>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Contact <span className="text-red-500">*</span>
                </label>
                <ContactSearch value={form.contact} onChange={c => set("contact", c)} onClear={() => set("contact", null)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-2">Proposal Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["management", "project"] as const).map(t => (
                    <button key={t} type="button" onClick={() => handleTypeChange(t)}
                      className={cn("px-4 py-3 rounded-[8px] border text-sm font-medium text-left transition-all",
                        form.type === t ? "border-primary bg-primary/8 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"
                      )}>
                      <span className="block text-sm font-semibold capitalize">{t}</span>
                      <span className="block text-[11px] font-normal mt-0.5 opacity-70">
                        {t === "management" ? "Recurring retainer" : "One-time project"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Step 1: Scope ── */}
          {step === 1 && (
            <>
              {form.type === "management" ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-3">Monthly Deliverables</label>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { key: "emailCampaigns" as const, label: "Email Campaigns" },
                        { key: "smsCampaigns" as const, label: "SMS Campaigns" },
                        { key: "popUps" as const, label: "Pop-ups" },
                      ].map(({ key, label }) => (
                        <div key={key}>
                          <label className="block text-[11px] text-muted-foreground mb-1">
                            {label} <span className="opacity-60">/mo</span>
                          </label>
                          <input
                            type="number"
                            value={form[key]}
                            onChange={e => set(key, e.target.value)}
                            placeholder="0"
                            min="0"
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Email Flows */}
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-2">Email Flows</label>
                    <div className="flex flex-wrap gap-2">
                      {EMAIL_FLOWS.map(flow => (
                        <FlowPill
                          key={flow.id}
                          label={flow.label}
                          count={form.selectedFlows[flow.id]}
                          onToggle={() => toggleFlow(flow.id)}
                          onCountChange={n => setFlowCount(flow.id, n)}
                          unit="emails"
                        />
                      ))}
                    </div>
                  </div>

                  {/* SMS Flows */}
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-2">SMS Flows</label>
                    <div className="flex flex-wrap gap-2">
                      {SMS_FLOWS.map(flow => (
                        <FlowPill
                          key={flow.id}
                          label={flow.label}
                          count={form.selectedFlows[flow.id]}
                          onToggle={() => toggleFlow(flow.id)}
                          onCountChange={n => setFlowCount(flow.id, n)}
                          unit="SMS"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Custom flows */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-foreground">Custom</label>
                      <button type="button" onClick={() => setForm(prev => ({ ...prev, customFlows: [...prev.customFlows, newCustomFlow()] }))}
                        className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors">
                        <Plus className="w-3 h-3" />
                        Add custom flow
                      </button>
                    </div>
                    {form.customFlows.length > 0 && (
                      <div className="space-y-2">
                        {form.customFlows.map(cf => (
                          <div key={cf.id} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={cf.name}
                              onChange={e => updateCustomFlow(cf.id, "name", e.target.value)}
                              placeholder="Flow name…"
                              className="flex-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                            />
                            <input
                              type="number"
                              value={cf.count || ""}
                              onChange={e => updateCustomFlow(cf.id, "count", parseInt(e.target.value) || 1)}
                              placeholder="1"
                              min="1"
                              className="w-14 px-2 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                            />
                            <select
                              value={cf.type}
                              onChange={e => updateCustomFlow(cf.id, "type", e.target.value)}
                              className="px-2 py-1.5 text-xs bg-background border border-border rounded-[6px] text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                            >
                              <option value="email">emails</option>
                              <option value="sms">SMS</option>
                            </select>
                            <button type="button" onClick={() => removeCustomFlow(cf.id)}
                              className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors shrink-0">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Notes — both types */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Notes <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  value={form.scopeNotes}
                  onChange={e => set("scopeNotes", e.target.value)}
                  placeholder="Any additional context for this proposal…"
                  rows={2}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 resize-none"
                />
              </div>
            </>
          )}

          {/* ── Step 2: Price ── */}
          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Total Amount <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                      {currencySymbol}
                    </span>
                    <input type="number" value={form.totalAmount} onChange={e => set("totalAmount", e.target.value)}
                      placeholder="0" min="0" step="0.01"
                      className="w-full pl-7 pr-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Currency</label>
                  <select value={form.currency} onChange={e => set("currency", e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Start Date</label>
                <input type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                />
              </div>
            </>
          )}

          {/* ── Step 3: Payment ── */}
          {step === 3 && (
            <>
              {form.type === "management" ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-2">Billing Frequency</label>
                    <div className="grid grid-cols-2 gap-2">
                      {INTERVAL_OPTIONS.map(o => (
                        <button key={o.label} type="button"
                          onClick={() => { set("billingInterval", o.value as FormState["billingInterval"]); set("billingIntervalCount", o.count); setCustomInterval(false); }}
                          className={cn("px-3 py-2.5 rounded-[8px] border text-sm font-medium transition-all",
                            !customInterval && form.billingInterval === o.value && form.billingIntervalCount === o.count
                              ? "border-primary bg-primary/8 text-primary"
                              : "border-border bg-background text-muted-foreground hover:text-foreground"
                          )}>
                          {o.label}
                        </button>
                      ))}
                      <button type="button" onClick={() => setCustomInterval(true)}
                        className={cn("col-span-2 px-3 py-2.5 rounded-[8px] border text-sm font-medium transition-all",
                          customInterval ? "border-primary bg-primary/8 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"
                        )}>
                        Custom
                      </button>
                    </div>
                  </div>
                  {customInterval && (
                    <div className="flex gap-2">
                      <input type="number" value={form.billingIntervalCount} onChange={e => set("billingIntervalCount", e.target.value)}
                        placeholder="1" min="1"
                        className="w-20 px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                      />
                      <select value={form.billingInterval} onChange={e => set("billingInterval", e.target.value as FormState["billingInterval"])}
                        className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50">
                        <option value="day">Day(s)</option>
                        <option value="week">Week(s)</option>
                        <option value="month">Month(s)</option>
                        <option value="year">Year(s)</option>
                      </select>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Bills every {form.billingIntervalCount || "1"} {form.billingInterval}(s) — {form.currency} {parseFloat(form.totalAmount || "0").toLocaleString()} per cycle
                  </p>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-2">Payment Structure</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["single", "instalment"] as const).map(s => (
                        <button key={s} type="button" onClick={() => set("paymentStructure", s)}
                          className={cn("px-3 py-3 rounded-[8px] border text-left transition-all",
                            form.paymentStructure === s ? "border-primary bg-primary/8 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"
                          )}>
                          <span className="block text-sm font-semibold">{s === "single" ? "Single Payment" : "Instalments"}</span>
                          <span className="block text-[11px] font-normal mt-0.5 opacity-70">
                            {s === "single" ? "Pay in full" : "Split into multiple payments"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {form.paymentStructure === "instalment" && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-foreground">Instalment Schedule</label>
                        <button type="button" onClick={distributeEvenly}
                          className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors">
                          Distribute evenly
                        </button>
                      </div>
                      <div className="space-y-2">
                        {form.instalments.map((inst, idx) => (
                          <div key={inst.id} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-4 shrink-0 text-center">{idx + 1}</span>
                            <div className="relative flex-1">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{currencySymbol}</span>
                              <input type="number" value={inst.amount || ""} onChange={e => updateInstalment(inst.id, "amount", parseFloat(e.target.value) || 0)}
                                placeholder="0" min="0" step="0.01"
                                className="w-full pl-6 pr-2 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                              />
                            </div>
                            <input type="date" value={inst.dueDate} onChange={e => updateInstalment(inst.id, "dueDate", e.target.value)}
                              className="flex-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                            />
                            {form.instalments.length > 1 && (
                              <button type="button" onClick={() => removeInstalment(inst.id)}
                                className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors shrink-0">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={addInstalment}
                        className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                        <Plus className="w-3.5 h-3.5" />
                        Add instalment
                      </button>
                      {totalAmt > 0 && (
                        <div className={cn("mt-3 px-3 py-2 rounded-[6px] text-xs",
                          instalmentDiff < 0.01 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700")}>
                          {instalmentDiff < 0.01
                            ? `Total matches — ${form.currency} ${instalmentSum.toLocaleString()}`
                            : `Sum (${form.currency} ${instalmentSum.toLocaleString()}) doesn't match total (${form.currency} ${totalAmt.toLocaleString()}) — difference: ${form.currency} ${instalmentDiff.toFixed(2)}`
                          }
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── Step 4: Review ── */}
          {step === 4 && (
            <>
              <div className="bg-muted/40 rounded-[8px] divide-y divide-border/60">
                <ReviewRow label="Client" value={form.contact?.name ?? "—"} />
                {form.contact?.email && <ReviewRow label="Email" value={form.contact.email} />}
                <ReviewRow label="Type" value={form.type === "management" ? "Management" : "Project"} />
                <ReviewRow label="Amount" value={`${form.currency} ${parseFloat(form.totalAmount || "0").toLocaleString()}`} />
                <ReviewRow
                  label="Payment"
                  value={
                    form.paymentStructure === "subscription"
                      ? `Subscription — every ${form.billingIntervalCount} ${form.billingInterval}(s)`
                      : form.paymentStructure === "instalment"
                      ? `${form.instalments.length} instalments`
                      : "Single payment"
                  }
                />
                {scopePreview && <ReviewRow label="Scope" value={scopePreview} />}
                {form.startDate && <ReviewRow label="Start Date" value={format(new Date(form.startDate + "T00:00:00"), "d MMM yyyy")} />}
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Internal Notes <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
                  placeholder="Any notes for your team…" rows={2}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 resize-none"
                />
              </div>

              {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-[6px]">{error}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
          <button type="button"
            onClick={() => step === 0 ? onClose() : setStep(s => s - 1)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            {step > 0 && <ChevronLeft className="w-4 h-4" />}
            {step === 0 ? "Cancel" : "Back"}
          </button>

          <button type="button"
            onClick={isLastStep ? handleSubmit : () => setStep(s => s + 1)}
            disabled={!canAdvance() || submitting}
            className={cn("flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-[7px] transition-all",
              canAdvance() && !submitting
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}>
            {submitting ? "Creating…" : isLastStep ? "Create Proposal" : <><span>Next</span><ChevronRight className="w-4 h-4" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
