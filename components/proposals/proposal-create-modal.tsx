"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, ChevronRight, ChevronLeft, Search, Plus, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { format } from "date-fns";

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

interface FormState {
  // Step 1
  contact: GHLContact | null;
  type: "management" | "project";
  // Step 2
  serviceDescription: string;
  totalAmount: string;
  currency: string;
  // Step 3
  paymentStructure: "subscription" | "single" | "instalment";
  billingInterval: "day" | "week" | "month" | "year";
  billingIntervalCount: string;
  startDate: string;
  instalments: Instalment[];
  // Step 4 (notes)
  notes: string;
}

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];

const INTERVAL_OPTIONS = [
  { label: "Monthly", value: "month", count: "1" },
  { label: "Quarterly", value: "month", count: "3" },
  { label: "Bi-annually", value: "month", count: "6" },
  { label: "Yearly", value: "year", count: "1" },
  { label: "Custom", value: "month", count: "" },
];

function newInstalment(): Instalment {
  return {
    id: Math.random().toString(36).slice(2),
    amount: 0,
    dueDate: format(new Date(), "yyyy-MM-dd"),
  };
}

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-1 rounded-full transition-all duration-300",
            i === step
              ? "w-6 bg-primary"
              : i < step
              ? "w-3 bg-primary/40"
              : "w-3 bg-muted"
          )}
        />
      ))}
    </div>
  );
}

function ContactSearch({
  value,
  onChange,
  onClear,
}: {
  value: GHLContact | null;
  onChange: (c: GHLContact) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<GHLContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value) setQuery(value.name);
  }, [value]);

  function search(q: string) {
    setQuery(q);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/ghl/contacts/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(data.contacts ?? []);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function select(c: GHLContact) {
    onChange(c);
    setQuery(c.name);
    setOpen(false);
    setResults([]);
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
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
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={() => select(c)}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
              >
                <p className="text-sm font-medium text-foreground">{c.name}</p>
                {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
              </button>
            ))
          )}
        </div>
      )}
      {value && (
        <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 bg-primary/5 border border-primary/20 rounded-[6px]">
          <Check className="w-3 h-3 text-primary shrink-0" />
          <span className="text-xs text-primary font-medium">{value.name}</span>
          {value.email && <span className="text-xs text-muted-foreground">{value.email}</span>}
          <button
            type="button"
            onClick={() => { onClear(); setQuery(""); }}
            className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

const STEPS = ["Client & Type", "Service & Price", "Payment", "Review"];

export interface ProposalCreateModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function ProposalCreateModal({ onClose, onCreated }: ProposalCreateModalProps) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<FormState>({
    contact: null,
    type: "management",
    serviceDescription: "",
    totalAmount: "",
    currency: "USD",
    paymentStructure: "subscription",
    billingInterval: "month",
    billingIntervalCount: "1",
    startDate: format(new Date(), "yyyy-MM-dd"),
    instalments: [newInstalment(), newInstalment()],
    notes: "",
  });

  const set = useCallback(<K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  }, []);

  // When type changes, reset payment structure defaults
  function handleTypeChange(type: "management" | "project") {
    set("type", type);
    set("paymentStructure", type === "management" ? "subscription" : "single");
  }

  // Instalment helpers
  function updateInstalment(id: string, field: "amount" | "dueDate", val: string | number) {
    setForm((prev) => ({
      ...prev,
      instalments: prev.instalments.map((i) =>
        i.id === id ? { ...i, [field]: val } : i
      ),
    }));
  }

  function addInstalment() {
    setForm((prev) => ({ ...prev, instalments: [...prev.instalments, newInstalment()] }));
  }

  function removeInstalment(id: string) {
    setForm((prev) => ({
      ...prev,
      instalments: prev.instalments.filter((i) => i.id !== id),
    }));
  }

  // Distribute total evenly across instalments
  function distributeEvenly() {
    const total = parseFloat(form.totalAmount) || 0;
    const count = form.instalments.length;
    if (!count) return;
    const each = Math.round((total / count) * 100) / 100;
    setForm((prev) => ({
      ...prev,
      instalments: prev.instalments.map((i, idx) => ({
        ...i,
        amount: idx === count - 1 ? Math.round((total - each * (count - 1)) * 100) / 100 : each,
      })),
    }));
  }

  // Validation per step
  function canAdvance(): boolean {
    if (step === 0) return !!form.contact;
    if (step === 1) {
      const amt = parseFloat(form.totalAmount);
      return amt > 0;
    }
    if (step === 2) {
      if (form.paymentStructure === "instalment") {
        const total = parseFloat(form.totalAmount) || 0;
        const sum = form.instalments.reduce((acc, i) => acc + (i.amount || 0), 0);
        return Math.abs(sum - total) < 0.01 && form.instalments.length > 0;
      }
      return true;
    }
    return true;
  }

  async function handleSubmit() {
    if (!form.contact) return;
    setSubmitting(true);
    setError("");

    try {
      const payload: Record<string, unknown> = {
        type: form.type,
        ghlContactId: form.contact.id,
        contactName: form.contact.name,
        contactEmail: form.contact.email,
        serviceDescription: form.serviceDescription || null,
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
          number: idx + 1,
          amount: i.amount,
          dueDate: i.dueDate,
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
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {/* Step 0: Client & Type */}
          {step === 0 && (
            <>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Contact <span className="text-red-500">*</span>
                </label>
                <ContactSearch
                  value={form.contact}
                  onChange={(c) => set("contact", c)}
                  onClear={() => set("contact", null)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-2">
                  Proposal Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["management", "project"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTypeChange(t)}
                      className={cn(
                        "px-4 py-3 rounded-[8px] border text-sm font-medium text-left transition-all",
                        form.type === t
                          ? "border-primary bg-primary/8 text-primary"
                          : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground"
                      )}
                    >
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

          {/* Step 1: Service & Price */}
          {step === 1 && (
            <>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Service Description
                </label>
                <textarea
                  value={form.serviceDescription}
                  onChange={(e) => set("serviceDescription", e.target.value)}
                  placeholder="Describe the services included…"
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Total Amount <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                      {form.currency === "USD" ? "$" : form.currency === "EUR" ? "€" : form.currency === "GBP" ? "£" : ""}
                    </span>
                    <input
                      type="number"
                      value={form.totalAmount}
                      onChange={(e) => set("totalAmount", e.target.value)}
                      placeholder="0"
                      min="0"
                      step="0.01"
                      className="w-full pl-7 pr-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Currency
                  </label>
                  <select
                    value={form.currency}
                    onChange={(e) => set("currency", e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                />
              </div>
            </>
          )}

          {/* Step 2: Payment Structure */}
          {step === 2 && (
            <>
              {form.type === "management" ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-2">
                      Billing Frequency
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {INTERVAL_OPTIONS.filter((o) => o.label !== "Custom").map((o) => {
                        const active =
                          form.billingInterval === o.value &&
                          form.billingIntervalCount === o.count;
                        return (
                          <button
                            key={o.label}
                            type="button"
                            onClick={() => {
                              set("billingInterval", o.value as FormState["billingInterval"]);
                              set("billingIntervalCount", o.count);
                            }}
                            className={cn(
                              "px-3 py-2.5 rounded-[8px] border text-sm font-medium transition-all",
                              active
                                ? "border-primary bg-primary/8 text-primary"
                                : "border-border bg-background text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      Custom Interval
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={form.billingIntervalCount}
                        onChange={(e) => set("billingIntervalCount", e.target.value)}
                        placeholder="1"
                        min="1"
                        className="w-20 px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                      />
                      <select
                        value={form.billingInterval}
                        onChange={(e) => set("billingInterval", e.target.value as FormState["billingInterval"])}
                        className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                      >
                        <option value="day">Day(s)</option>
                        <option value="week">Week(s)</option>
                        <option value="month">Month(s)</option>
                        <option value="year">Year(s)</option>
                      </select>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Bills every {form.billingIntervalCount || "1"} {form.billingInterval}(s) — {form.currency} {parseFloat(form.totalAmount || "0").toLocaleString()} per cycle
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-2">
                      Payment Structure
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["single", "instalment"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => set("paymentStructure", s)}
                          className={cn(
                            "px-3 py-3 rounded-[8px] border text-left transition-all",
                            form.paymentStructure === s
                              ? "border-primary bg-primary/8 text-primary"
                              : "border-border bg-background text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <span className="block text-sm font-semibold capitalize">{s === "single" ? "Single Payment" : "Instalments"}</span>
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
                        <label className="text-xs font-medium text-foreground">
                          Instalment Schedule
                        </label>
                        <button
                          type="button"
                          onClick={distributeEvenly}
                          className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
                        >
                          Distribute evenly
                        </button>
                      </div>

                      <div className="space-y-2">
                        {form.instalments.map((inst, idx) => (
                          <div key={inst.id} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-4 shrink-0 text-center">{idx + 1}</span>
                            <div className="relative flex-1">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                                {form.currency === "USD" ? "$" : form.currency === "EUR" ? "€" : form.currency === "GBP" ? "£" : ""}
                              </span>
                              <input
                                type="number"
                                value={inst.amount || ""}
                                onChange={(e) => updateInstalment(inst.id, "amount", parseFloat(e.target.value) || 0)}
                                placeholder="0"
                                min="0"
                                step="0.01"
                                className="w-full pl-6 pr-2 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                              />
                            </div>
                            <input
                              type="date"
                              value={inst.dueDate}
                              onChange={(e) => updateInstalment(inst.id, "dueDate", e.target.value)}
                              className="flex-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                            />
                            {form.instalments.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeInstalment(inst.id)}
                                className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={addInstalment}
                        className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add instalment
                      </button>

                      {totalAmt > 0 && (
                        <div className={cn(
                          "mt-3 px-3 py-2 rounded-[6px] text-xs",
                          instalmentDiff < 0.01
                            ? "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-700"
                        )}>
                          {instalmentDiff < 0.01 ? (
                            <span>Total matches — {form.currency} {instalmentSum.toLocaleString()}</span>
                          ) : (
                            <span>
                              Sum ({form.currency} {instalmentSum.toLocaleString()}) doesn&apos;t match total ({form.currency} {totalAmt.toLocaleString()}) — difference: {form.currency} {instalmentDiff.toFixed(2)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <>
              <div className="bg-muted/40 rounded-[8px] divide-y divide-border/60">
                <ReviewRow label="Client" value={form.contact?.name ?? "—"} />
                {form.contact?.email && <ReviewRow label="Email" value={form.contact.email} />}
                <ReviewRow label="Type" value={form.type === "management" ? "Management" : "Project"} />
                <ReviewRow
                  label="Amount"
                  value={`${form.currency} ${parseFloat(form.totalAmount || "0").toLocaleString()}`}
                />
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
                {form.serviceDescription && (
                  <ReviewRow label="Service" value={form.serviceDescription} />
                )}
                {form.startDate && (
                  <ReviewRow label="Start Date" value={format(new Date(form.startDate + "T00:00:00"), "d MMM yyyy")} />
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Internal Notes <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Any notes for your team…"
                  rows={2}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 resize-none"
                />
              </div>

              {error && (
                <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-[6px]">{error}</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
          <button
            type="button"
            onClick={() => step === 0 ? onClose() : setStep((s) => s - 1)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {step === 0 ? null : <ChevronLeft className="w-4 h-4" />}
            {step === 0 ? "Cancel" : "Back"}
          </button>

          <button
            type="button"
            onClick={isLastStep ? handleSubmit : () => setStep((s) => s + 1)}
            disabled={!canAdvance() || submitting}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-[7px] transition-all",
              canAdvance() && !submitting
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {submitting ? "Creating…" : isLastStep ? "Create Proposal" : (
              <>Next <ChevronRight className="w-4 h-4" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-foreground text-right">{value}</span>
    </div>
  );
}
