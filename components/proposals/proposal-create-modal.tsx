"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  X, ChevronRight, ChevronLeft, Search, Plus, Trash2, Check,
  Repeat, CalendarClock, Layers, Wallet, ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate, useReducedMotion } from "motion/react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";
import { format } from "date-fns";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";

// Strong custom easings (Emil's framework) — the built-in CSS curves lack punch.
const EASE_OUT = [0.23, 1, 0.32, 1] as const;        // entrances + feedback
const SPRING_SELECT = { type: "spring" as const, duration: 0.4, bounce: 0.16 };
const SPRING_PILL = { type: "spring" as const, duration: 0.38, bounce: 0.14 };
import {
  fmtMoney, clientSentence, billingModel, periodPhrase, fmtDay, type BillingTerms,
} from "@/lib/proposals/billing";

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

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

interface DepositInstalment {
  id: string;
  amount: number;
  dueDate: string;
}

interface FormState {
  contact: GHLContact | null;
  type: "management" | "project";
  // Scope
  selectedFlows: Record<string, number>;
  customFlows: CustomFlow[];
  emailCampaigns: string;
  smsCampaigns: string;
  popUps: string;
  scopeNotes: string;
  // Price
  totalAmount: string;       // the FULL price the user enters (pre-discount)
  currency: string;
  discountType: "percent" | "fixed";
  discountValue: string;
  startDate: string;
  subscriptionStartDate: string; // when recurring billing first charges (blank = default)
  // Deal / billing
  paymentStructure: "subscription" | "single" | "instalment";
  autoRenew: boolean;
  billingInterval: "day" | "week" | "month" | "year";
  billingIntervalCount: string;
  instalments: Instalment[];
  hasDeposit: boolean;
  depositInstalments: DepositInstalment[];
  // Review
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

/** The amount actually charged = entered price minus any discount (clamped to >= 0). */
function billedTotalOf(form: FormState): number {
  const price = parseFloat(form.totalAmount) || 0;
  const dv = parseFloat(form.discountValue) || 0;
  const disc = form.discountType === "percent" ? price * (dv / 100) : dv;
  const clamped = Math.min(Math.max(disc, 0), price);
  return Math.round((price - clamped) * 100) / 100;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newInstalment(): Instalment {
  return { id: Math.random().toString(36).slice(2), amount: 0, dueDate: format(new Date(), "yyyy-MM-dd") };
}

function newDepositInstalment(): DepositInstalment {
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

/** A short, plain summary line of what's included, for the reveal. */
function scopeSummary(form: FormState): string {
  if (form.type === "management") {
    const parts: string[] = [];
    const e = parseInt(form.emailCampaigns) || 0;
    const s = parseInt(form.smsCampaigns) || 0;
    const p = parseInt(form.popUps) || 0;
    if (e) parts.push(`${e} email campaign${e > 1 ? "s" : ""}`);
    if (s) parts.push(`${s} SMS`);
    if (p) parts.push(`${p} pop-up${p > 1 ? "s" : ""}`);
    return parts.length ? `${parts.join(" · ")} / month` : "Retention management";
  }
  const flowCount =
    Object.values(form.selectedFlows).filter(n => n > 0).length +
    form.customFlows.filter(cf => cf.name.trim() && cf.count > 0).length;
  return flowCount ? `${flowCount} flow${flowCount > 1 ? "s" : ""}` : "Project build";
}

/** Currency symbol for the few we show; falls back to the code elsewhere. */
function symbolFor(currency: string): string {
  return currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
}

/** The price-field label, adapted to the chosen deal shape so the number is never ambiguous. */
function amountLabel(form: FormState): string {
  if (form.type === "project") return "Project price";
  const n = parseInt(form.billingIntervalCount) || 1;
  if (!form.autoRenew) return `Total for the ${n > 1 ? `${n} months` : "month"}`;
  if (form.billingInterval === "year") return "Amount per year";
  return n > 1 ? `Amount per billing (every ${n} months)` : "Amount per month";
}

// ─── Step model ────────────────────────────────────────────────────────────────

type StepKey = "client" | "work" | "scope" | "deal" | "price" | "schedule" | "reveal";

const STEP_LABEL: Record<StepKey, string> = {
  client: "Client", work: "Work", scope: "Scope", deal: "Payment", price: "Price", schedule: "Schedule", reveal: "Review",
};

function activeSteps(form: FormState): StepKey[] {
  const steps: StepKey[] = ["client", "work", "scope", "deal", "price"];
  const needsSchedule =
    (form.type === "project" && form.paymentStructure === "instalment") ||
    (form.type === "management" && form.autoRenew && form.hasDeposit);
  if (needsSchedule) steps.push("schedule");
  steps.push("reveal");
  return steps;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
  const inputRef = useRef<HTMLInputElement>(null);
  // The results menu is portaled out of the modal so the scroll container can't clip it.
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  function updateRect() {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 6, left: r.left, width: r.width });
  }
  useEffect(() => {
    if (!open) return;
    const handler = () => updateRect();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => { window.removeEventListener("scroll", handler, true); window.removeEventListener("resize", handler); };
  }, [open]);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFirstName, setNewFirstName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => { if (value) setQuery(value.name); }, [value]);

  function search(q: string) {
    setQuery(q);
    setOpen(true);
    updateRect();
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

  function resetCreateForm() {
    setShowCreateForm(false);
    setNewFirstName("");
    setNewEmail("");
    setNewPhone("");
    setCreateError("");
  }

  async function handleCreateContact() {
    if (!newFirstName.trim()) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/ghl/contacts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: newFirstName.trim(),
          email: newEmail.trim() || undefined,
          phone: newPhone.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create contact");
      }
      const data = await res.json();
      const contact: GHLContact = {
        id: data.contact?.id ?? data.id,
        name: newFirstName.trim(),
        email: newEmail.trim() || null,
      };
      onChange(contact);
      setQuery(toTitleCase(contact.name));
      resetCreateForm();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input ref={inputRef} type="text" value={query} onChange={e => search(e.target.value)}
          onFocus={() => { updateRect(); if (query.length >= 2) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          autoFocus
          placeholder="Search contacts…"
          className="w-full pl-11 pr-3 py-3 text-sm bg-background border border-border rounded-[9px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/60 transition-shadow"
        />
      </div>
      {/* Results — portaled out of the scroll container so it never gets clipped */}
      {typeof document !== "undefined" && open && !showCreateForm && rect && createPortal(
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: EASE_OUT }}
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, transformOrigin: "top" }}
          className="z-[120] bg-card border border-border rounded-[10px] shadow-[0_12px_32px_-18px_rgba(15,23,42,0.22)] ring-1 ring-foreground/[0.03] overflow-hidden max-h-64 overflow-y-auto"
        >
          {loading ? (
            <div className="px-3.5 py-3 text-xs text-muted-foreground">Searching…</div>
          ) : (
            <>
              {results.map(c => (
                <button key={c.id} type="button" onMouseDown={() => { onChange({ ...c, name: toTitleCase(c.name) }); setQuery(toTitleCase(c.name)); setOpen(false); }}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-primary/[0.05] transition-colors border-b border-border/40 last:border-0">
                  <p className="text-sm font-medium text-foreground">{toTitleCase(c.name)}</p>
                  {c.email && <p className="text-xs text-muted-foreground mt-0.5">{c.email}</p>}
                </button>
              ))}
              {results.length === 0 && query.length >= 2 && (
                <div className="px-3.5 py-2.5 text-xs text-muted-foreground">No contacts found</div>
              )}
              <button
                type="button"
                onMouseDown={() => { setShowCreateForm(true); setNewFirstName(query.length >= 2 ? query : ""); setOpen(false); }}
                className="w-full text-left px-3.5 py-2.5 text-sm text-primary font-medium flex items-center gap-1.5 hover:bg-primary/5 transition-colors border-t border-border"
              >
                <Plus className="w-3.5 h-3.5" />
                Create new contact{query.length >= 2 ? ` "${query}"` : ""}
              </button>
            </>
          )}
        </motion.div>,
        document.body,
      )}

      {showCreateForm && !value && (
        <div className="mt-3 border border-border rounded-[8px] p-3 space-y-3 bg-background">
          <div>
            <label className="block text-[11px] font-medium text-foreground mb-1">Name <span className="text-red-500">*</span></label>
            <input type="text" value={newFirstName} onChange={e => setNewFirstName(e.target.value)} placeholder="Contact name…"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-foreground mb-1">Email</label>
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@example.com"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-foreground mb-1">Phone</label>
            <input type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="+1 (555) 000-0000"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
          </div>
          {createError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-[6px]">{createError}</p>}
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCreateContact} disabled={!newFirstName.trim() || creating}
              className={cn("flex-1 px-3 py-2 text-sm font-medium rounded-[7px] transition-all",
                newFirstName.trim() && !creating ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed")}>
              {creating ? "Creating…" : "Create & Select"}
            </button>
            <button type="button" onClick={resetCreateForm} className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {value && (
        <div data-r10n-proposal-contact-chip className="mt-3 flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-[8px]">
          <Check data-r10n-proposal-contact-check className="w-3.5 h-3.5 text-primary shrink-0" />
          <span data-r10n-proposal-contact-name className="text-sm text-primary font-medium">{toTitleCase(value.name)}</span>
          {value.email && <span className="text-xs text-muted-foreground">{value.email}</span>}
          <button type="button" onClick={() => { onClear(); setQuery(""); resetCreateForm(); }}
            className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function FlowPill({ label, count, onToggle, onCountChange, unit }: {
  label: string; count: number | undefined; onToggle: () => void; onCountChange: (n: number) => void; unit: string;
}) {
  const selected = (count ?? 0) > 0;
  const [raw, setRaw] = useState(String(count ?? 1));
  useEffect(() => {
    if (selected) setRaw(String(count ?? 1));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (!selected) {
    return (
      <button type="button" onClick={onToggle}
        data-r10n-proposal-flowpill data-selected="false"
        className="px-3 py-1.5 rounded-[7px] border border-border bg-background text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all whitespace-nowrap">
        {label}
      </button>
    );
  }
  return (
    <div data-r10n-proposal-flowpill data-selected="true" className="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] border border-primary bg-primary/8 text-primary">
      <span className="text-xs font-medium whitespace-nowrap">{label}</span>
      <input type="number" value={raw} min={1} max={99}
        onChange={e => { setRaw(e.target.value); const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1) onCountChange(n); }}
        onBlur={() => { const n = parseInt(raw); if (isNaN(n) || n < 1) { setRaw("1"); onCountChange(1); } }}
        onClick={e => e.stopPropagation()}
        className="w-8 text-center text-xs font-semibold bg-primary/10 border-0 rounded-[3px] text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
      <span className="text-[10px] opacity-60 whitespace-nowrap">{unit}</span>
      <button type="button" onClick={onToggle} className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"><X className="w-3 h-3" /></button>
    </div>
  );
}

/** A selectable choice card. Cards with no sub-options fill fully navy when selected (bold);
 *  cards with sub-options use a rich navy tint so the controls inside stay legible. */
function ChoiceCard({ active, icon: Icon, title, desc, onClick, children }: {
  active: boolean; icon: React.ElementType; title: string; desc: string; onClick: () => void; children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const filled = active && !children;
  return (
    <motion.div
      onClick={onClick}
      whileHover={reduce ? undefined : { y: -2 }}
      whileTap={reduce ? undefined : { scale: 0.99 }}
      transition={SPRING_SELECT}
      data-r10n-proposal-choice
      data-active={active}
      data-filled={filled}
      className={cn(
        "rounded-[12px] border p-4 cursor-pointer transition-colors duration-200",
        filled
          ? "bg-primary border-primary shadow-[0_8px_24px_-16px_rgba(15,58,92,0.28)]"
          : active
            ? "bg-primary/[0.05] border-primary/60 ring-1 ring-primary/10"
            : "bg-background border-border hover:border-primary/40 hover:shadow-[0_4px_14px_-12px_rgba(28,35,51,0.18)]",
      )}
    >
      <div className="flex items-start gap-3.5">
        <span className={cn("mt-0.5 w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 transition-colors duration-200",
          filled ? "bg-primary-foreground/15 text-primary-foreground" : active ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground")}>
          <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={cn("text-[15px] font-semibold tracking-[-0.01em]", filled ? "text-primary-foreground" : active ? "text-primary" : "text-foreground")} style={{ fontFamily: "var(--font-heading)" }}>{title}</p>
            <span className={cn("w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-colors duration-200",
              filled ? "border-primary-foreground bg-primary-foreground" : active ? "border-primary bg-primary" : "border-border")}>
              {active && <motion.span initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={SPRING_SELECT} className={cn("w-2 h-2 rounded-full", filled ? "bg-primary" : "bg-primary-foreground")} />}
            </span>
          </div>
          <p className={cn("text-xs mt-1 leading-relaxed", filled ? "text-primary-foreground/70" : "text-muted-foreground")}>{desc}</p>
          <AnimatePresence initial={false}>
            {active && children && (
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, height: "auto" }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.24, ease: EASE_OUT }}
                className="overflow-hidden"
              >
                <div className="mt-3.5 pt-3.5 border-t border-primary/15" onClick={e => e.stopPropagation()}>{children}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

/** Segmented control with a "magic" sliding navy pill that glides between options. */
function Segmented({ id, options, value, onChange }: {
  id: string; options: { key: string; label: string }[]; value: string; onChange: (key: string) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="inline-flex flex-wrap gap-1 p-1 rounded-[9px] bg-muted/60 border border-border/60">
      {options.map(o => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)}
            className={cn("relative px-3 py-1.5 rounded-[6px] text-xs font-medium transition-colors duration-200", on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {on && <motion.span layoutId={id} transition={reduce ? { duration: 0 } : SPRING_PILL}
              className="absolute inset-0 rounded-[6px] bg-primary shadow-sm" style={{ zIndex: 0 }} />}
            <span className="relative z-[1] whitespace-nowrap">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Animated count-up for the reveal price. */
function CountUp({ value, prefix, animateOn }: { value: number; prefix: string; animateOn: boolean }) {
  const mv = useMotionValue(animateOn ? 0 : value);
  const text = useTransform(mv, (v) => `${prefix}${Math.round(v).toLocaleString("en-US")}`);
  useEffect(() => {
    if (!animateOn) { mv.set(value); return; }
    const controls = animate(mv, value, { duration: 0.85, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, animateOn]);
  return <motion.span>{text}</motion.span>;
}

/** Reusable schedule editor for instalments / deposit payments. */
function ScheduleEditor({ rows, currencySymbol, onUpdate, onAdd, onRemove, onDistribute, total, addLabel }: {
  rows: { id: string; amount: number; dueDate: string }[];
  currencySymbol: string;
  onUpdate: (id: string, field: "amount" | "dueDate", val: string | number) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onDistribute: () => void;
  total: number;
  addLabel: string;
}) {
  const sum = rows.reduce((acc, i) => acc + (i.amount || 0), 0);
  const diff = Math.abs(sum - total);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">Payment schedule</span>
        <button type="button" onClick={onDistribute} className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors">Split evenly</button>
      </div>
      <div className="space-y-2">
        {rows.map((inst, idx) => (
          <div key={inst.id} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-4 shrink-0 text-center tabular-nums">{idx + 1}</span>
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{currencySymbol}</span>
              <input type="number" value={inst.amount || ""} onChange={e => onUpdate(inst.id, "amount", parseFloat(e.target.value) || 0)} placeholder="0" min="0" step="0.01"
                className="w-full pl-6 pr-2 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
            </div>
            <input type="date" value={inst.dueDate} onChange={e => onUpdate(inst.id, "dueDate", e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
            {rows.length > 1 && (
              <button type="button" onClick={() => onRemove(inst.id)} className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={onAdd} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
        <Plus className="w-3.5 h-3.5" /> {addLabel}
      </button>
      {total > 0 && (
        <div {...(diff < 0.01 ? { "data-r10n-proposal-schedule-ok": "" } : { "data-r10n-proposal-schedule-pending": "" })} className={cn("mt-3 px-3 py-2 rounded-[7px] text-xs", diff < 0.01 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700")}>
          {diff < 0.01
            ? `Adds up to ${currencySymbol}${sum.toLocaleString()} ✓`
            : `So far ${currencySymbol}${sum.toLocaleString()} of ${currencySymbol}${total.toLocaleString()} — ${currencySymbol}${diff.toFixed(2)} ${sum < total ? "left" : "over"}`}
        </div>
      )}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export interface ProposalCreateModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function ProposalCreateModal({ onClose, onCreated }: ProposalCreateModalProps) {
  const tz = useUserTimezone();
  const reduce = useReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);
  const [dir, setDir] = useState(1); // 1 forward, -1 back (for transition direction)
  const [submitting, setSubmitting] = useState(false);
  const [submitAction, setSubmitAction] = useState<"draft" | "send" | null>(null);
  const [error, setError] = useState("");
  const [customCadence, setCustomCadence] = useState(false);
  const [customTerm, setCustomTerm] = useState(false);

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
    discountType: "percent",
    discountValue: "",
    startDate: format(toZonedDate(new Date(), tz), "yyyy-MM-dd"),
    subscriptionStartDate: "",
    paymentStructure: "subscription",
    autoRenew: true,
    billingInterval: "month",
    billingIntervalCount: "1",
    instalments: [newInstalment(), newInstalment()],
    hasDeposit: false,
    depositInstalments: [newDepositInstalment()],
    notes: "",
  });

  const set = useCallback(<K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: val }));
  }, []);

  function handleTypeChange(type: "management" | "project") {
    setForm(prev => ({ ...prev, type, paymentStructure: type === "management" ? "subscription" : "single" }));
  }

  function setAutoRenew(on: boolean) {
    setForm(prev => ({ ...prev, autoRenew: on, hasDeposit: on ? prev.hasDeposit : false }));
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
    setForm(prev => ({ ...prev, customFlows: prev.customFlows.map(cf => cf.id === id ? { ...cf, [field]: val } : cf) }));
  }
  function removeCustomFlow(id: string) {
    setForm(prev => ({ ...prev, customFlows: prev.customFlows.filter(cf => cf.id !== id) }));
  }

  function updateInstalment(id: string, field: "amount" | "dueDate", val: string | number) {
    setForm(prev => ({ ...prev, instalments: prev.instalments.map(i => i.id === id ? { ...i, [field]: val } : i) }));
  }
  function addInstalment() { setForm(prev => ({ ...prev, instalments: [...prev.instalments, newInstalment()] })); }
  function removeInstalment(id: string) { setForm(prev => ({ ...prev, instalments: prev.instalments.filter(i => i.id !== id) })); }
  function distributeEvenly() {
    const total = billedTotalOf(form);
    const count = form.instalments.length;
    if (!count) return;
    const each = Math.round((total / count) * 100) / 100;
    setForm(prev => ({ ...prev, instalments: prev.instalments.map((i, idx) => ({ ...i, amount: idx === count - 1 ? Math.round((total - each * (count - 1)) * 100) / 100 : each })) }));
  }

  function updateDepositInstalment(id: string, field: "amount" | "dueDate", val: string | number) {
    setForm(prev => ({ ...prev, depositInstalments: prev.depositInstalments.map(i => i.id === id ? { ...i, [field]: val } : i) }));
  }
  function addDepositInstalment() { setForm(prev => ({ ...prev, depositInstalments: [...prev.depositInstalments, newDepositInstalment()] })); }
  function removeDepositInstalment(id: string) { setForm(prev => ({ ...prev, depositInstalments: prev.depositInstalments.filter(i => i.id !== id) })); }
  function distributeDepositEvenly() {
    // Split the CURRENT deposit total evenly across the payments (deposit is any amount now,
    // no longer forced to one billing cycle).
    const total = form.depositInstalments.reduce((a, i) => a + (i.amount || 0), 0);
    const count = form.depositInstalments.length;
    if (!count || total <= 0) return;
    const each = Math.round((total / count) * 100) / 100;
    setForm(prev => ({ ...prev, depositInstalments: prev.depositInstalments.map((i, idx) => ({ ...i, amount: idx === count - 1 ? Math.round((total - each * (count - 1)) * 100) / 100 : each })) }));
  }

  // ── derived ──
  const steps = activeSteps(form);
  const safeIndex = Math.min(stepIndex, steps.length - 1);
  const currentKey = steps[safeIndex];
  const isLast = currentKey === "reveal";

  const enteredPrice = parseFloat(form.totalAmount) || 0;
  const billedTotal = billedTotalOf(form);
  const discountAmount = Math.round((enteredPrice - billedTotal) * 100) / 100;
  const hasDiscount = (parseFloat(form.discountValue) || 0) > 0 && billedTotal < enteredPrice;
  const discountPct = enteredPrice > 0 ? Math.round((discountAmount / enteredPrice) * 100) : 0;
  const currencySymbol = symbolFor(form.currency);

  const previewTerms: BillingTerms = {
    type: form.type,
    paymentStructure: form.paymentStructure,
    totalAmount: billedTotal,
    currency: form.currency.toLowerCase(),
    billingInterval: form.billingInterval,
    billingIntervalCount: parseInt(form.billingIntervalCount) || 1,
    autoRenew: form.autoRenew,
    listAmount: hasDiscount ? enteredPrice : null,
    startDate: form.startDate || null,
  };

  function canAdvance(): boolean {
    switch (currentKey) {
      case "client": return !!form.contact;
      case "price": return billedTotal > 0;
      case "schedule": {
        if (form.type === "project" && form.paymentStructure === "instalment") {
          const sum = form.instalments.reduce((acc, i) => acc + (i.amount || 0), 0);
          return Math.abs(sum - billedTotal) < 0.01 && form.instalments.length > 0;
        }
        if (form.hasDeposit) {
          // Deposit can be ANY amount now (independent of the retainer): just require it to be positive.
          const sum = form.depositInstalments.reduce((acc, i) => acc + (i.amount || 0), 0);
          return sum > 0 && form.depositInstalments.length > 0;
        }
        return true;
      }
      default: return true;
    }
  }

  function goNext() {
    if (isLast) return; // the reveal step uses explicit Save-as-draft / Send buttons
    setDir(1);
    setStepIndex(i => Math.min(i + 1, steps.length - 1));
  }
  function goBack() {
    if (safeIndex === 0) { onClose(); return; }
    setDir(-1);
    setStepIndex(i => Math.max(i - 1, 0));
  }

  async function handleSubmit(send: boolean) {
    if (!form.contact) return;
    setSubmitting(true);
    setSubmitAction(send ? "send" : "draft");
    setError("");
    try {
      const serviceDescription = compileScope(form) || null;
      const enteredP = parseFloat(form.totalAmount) || 0;
      const billed = billedTotalOf(form);
      const discountNum = parseFloat(form.discountValue) || 0;
      const hasDisc = discountNum > 0 && billed < enteredP;

      const payload: Record<string, unknown> = {
        type: form.type,
        ghlContactId: form.contact.id,
        contactName: toTitleCase(form.contact.name),
        contactEmail: form.contact.email,
        serviceDescription,
        totalAmount: billed,
        currency: form.currency.toLowerCase(),
        paymentStructure: form.paymentStructure,
        autoRenew: form.type === "management" ? form.autoRenew : false,
        startDate: form.startDate || null,
        notes: form.notes || null,
      };
      if (hasDisc) {
        payload.listAmount = enteredP;
        payload.discountType = form.discountType;
        payload.discountValue = discountNum;
      }
      if (form.type === "management") {
        payload.billingInterval = form.billingInterval;
        payload.billingIntervalCount = parseInt(form.billingIntervalCount) || 1;
        // Rep-chosen first-charge date (blank = default: one cycle after start, or immediate if no deposit).
        if (form.autoRenew && form.subscriptionStartDate) {
          payload.subscriptionStartDate = form.subscriptionStartDate;
        }
        if (form.paymentStructure === "subscription" && form.hasDeposit) {
          payload.hasDeposit = true;
          payload.depositTotal = form.depositInstalments.reduce((a, i) => a + (i.amount || 0), 0);
          payload.depositInstalments = form.depositInstalments.map((i, idx) => ({ number: idx + 1, amount: i.amount, dueDate: i.dueDate }));
        }
      }
      if (form.paymentStructure === "instalment") {
        payload.instalments = form.instalments.map((i, idx) => ({ number: idx + 1, amount: i.amount, dueDate: i.dueDate }));
      }

      const res = await fetch("/api/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to create proposal");
      }

      // "Send" = create the draft, then dispatch it to the client. If the send fails,
      // the proposal is already safely saved as a draft — surface that, don't lose it.
      if (send && data.proposal?.id) {
        const sendRes = await fetch(`/api/proposals/${data.proposal.id}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!sendRes.ok) {
          const sd = await sendRes.json().catch(() => ({}));
          throw new Error(`Saved as a draft, but sending failed: ${sd.error ?? "send it from the Proposals list instead."}`);
        }
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
      setSubmitAction(null);
    }
  }

  const showDealLine = currentKey === "deal" || currentKey === "price" || currentKey === "schedule";
  const advanceable = canAdvance();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
        data-r10n-proposal-wizard-overlay
        className="absolute inset-0 bg-[#171d2b]/45 backdrop-blur-md" onClick={onClose} />

      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.965, y: 10 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
        data-r10n-proposal-wizard
        className="relative bg-[#FBFBF9] border border-border/60 rounded-t-[20px] sm:rounded-[18px] shadow-[0_24px_64px_-32px_rgba(15,23,42,0.22)] ring-1 ring-foreground/[0.03] w-full sm:max-w-[452px] z-10 flex flex-col max-h-[92vh] overflow-hidden"
      >
        {/* Header — step counter + filling progress rail */}
        <div className="px-7 pt-6 pb-4 shrink-0">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2.5">
              <span data-r10n-proposal-stepcount className="text-[11px] font-bold tabular-nums text-primary tracking-widest" style={{ fontFamily: "var(--font-heading)" }}>
                {String(Math.min(safeIndex + 1, steps.length)).padStart(2, "0")}<span className="text-muted-foreground/45"> / {String(steps.length).padStart(2, "0")}</span>
              </span>
              <span className="w-px h-3 bg-border" />
              <span data-r10n-proposal-steplabel className="text-[11px] font-semibold text-muted-foreground tracking-[0.14em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>
                {isLast ? "Ready to send" : STEP_LABEL[currentKey]}
              </span>
            </div>
            <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-[7px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <div key={s} className="h-[3px] rounded-full flex-1 bg-muted overflow-hidden">
                <motion.div initial={false} animate={{ width: i <= safeIndex ? "100%" : "0%" }} transition={{ duration: 0.42, ease: EASE_OUT }}
                  data-r10n-proposal-railfill
                  className="h-full rounded-full bg-primary" style={{ opacity: i < safeIndex ? 0.45 : 1 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 pb-2 min-h-[316px]">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={currentKey}
              custom={dir}
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 24 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -24 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* ── CLIENT ── */}
              {currentKey === "client" && (
                <div>
                  <h3 data-r10n-proposal-q className="text-[1.6rem] leading-[1.15] font-bold text-foreground mb-1.5 tracking-[-0.02em] text-balance" style={{ fontFamily: "var(--font-heading)" }}>Who is this for?</h3>
                  <p className="text-sm text-muted-foreground mb-5">Search your contacts, or add a new one.</p>
                  <ContactSearch value={form.contact} onChange={c => set("contact", c)} onClear={() => set("contact", null)} />
                </div>
              )}

              {/* ── WORK ── */}
              {currentKey === "work" && (
                <div>
                  <h3 data-r10n-proposal-q className="text-[1.6rem] leading-[1.15] font-bold text-foreground mb-1.5 tracking-[-0.02em] text-balance" style={{ fontFamily: "var(--font-heading)" }}>What kind of work?</h3>
                  <p className="text-sm text-muted-foreground mb-5">This sets how the deal is billed.</p>
                  <div className="space-y-3">
                    <ChoiceCard active={form.type === "management"} icon={Repeat} title="Management" desc="Ongoing email + SMS retainer." onClick={() => handleTypeChange("management")} />
                    <ChoiceCard active={form.type === "project"} icon={Layers} title="Project" desc="A one-time build — flows or campaigns." onClick={() => handleTypeChange("project")} />
                  </div>
                </div>
              )}

              {/* ── SCOPE ── */}
              {currentKey === "scope" && (
                <div>
                  <h3 data-r10n-proposal-q className="text-[1.6rem] leading-[1.15] font-bold text-foreground mb-1.5 tracking-[-0.02em] text-balance" style={{ fontFamily: "var(--font-heading)" }}>What&apos;s included?</h3>
                  <p className="text-sm text-muted-foreground mb-5">{form.type === "management" ? "Monthly deliverables." : "Pick the flows in this build."}</p>
                  {form.type === "management" ? (
                    <div className="grid grid-cols-3 gap-3">
                      {[{ key: "emailCampaigns" as const, label: "Email campaigns" }, { key: "smsCampaigns" as const, label: "SMS campaigns" }, { key: "popUps" as const, label: "Pop-ups" }].map(({ key, label }) => (
                        <div key={key}>
                          <label className="block text-[11px] text-muted-foreground mb-1">{label} <span className="opacity-60">/mo</span></label>
                          <input type="number" value={form[key]} onChange={e => set(key, e.target.value)} placeholder="0" min="0"
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-2">Email flows</label>
                        <div className="flex flex-wrap gap-2">
                          {EMAIL_FLOWS.map(flow => (
                            <FlowPill key={flow.id} label={flow.label} count={form.selectedFlows[flow.id]} onToggle={() => toggleFlow(flow.id)} onCountChange={n => setFlowCount(flow.id, n)} unit="emails" />
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-2">SMS flows</label>
                        <div className="flex flex-wrap gap-2">
                          {SMS_FLOWS.map(flow => (
                            <FlowPill key={flow.id} label={flow.label} count={form.selectedFlows[flow.id]} onToggle={() => toggleFlow(flow.id)} onCountChange={n => setFlowCount(flow.id, n)} unit="SMS" />
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-medium text-foreground">Custom</label>
                          <button type="button" onClick={() => setForm(prev => ({ ...prev, customFlows: [...prev.customFlows, newCustomFlow()] }))}
                            className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"><Plus className="w-3 h-3" /> Add custom flow</button>
                        </div>
                        {form.customFlows.length > 0 && (
                          <div className="space-y-2">
                            {form.customFlows.map(cf => (
                              <div key={cf.id} className="flex items-center gap-2">
                                <input type="text" value={cf.name} onChange={e => updateCustomFlow(cf.id, "name", e.target.value)} placeholder="Flow name…"
                                  className="flex-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
                                <input type="number" value={cf.count || ""} onChange={e => updateCustomFlow(cf.id, "count", parseInt(e.target.value) || 1)} placeholder="1" min="1"
                                  className="w-14 px-2 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
                                <select value={cf.type} onChange={e => updateCustomFlow(cf.id, "type", e.target.value)}
                                  className="px-2 py-1.5 text-xs bg-background border border-border rounded-[6px] text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50">
                                  <option value="email">emails</option><option value="sms">SMS</option>
                                </select>
                                <button type="button" onClick={() => removeCustomFlow(cf.id)} className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="mt-4">
                    <label className="block text-xs font-medium text-foreground mb-1.5">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
                    <textarea value={form.scopeNotes} onChange={e => set("scopeNotes", e.target.value)} placeholder="Any extra context for this proposal…" rows={2}
                      className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 resize-none" />
                  </div>
                </div>
              )}

              {/* ── DEAL ── */}
              {currentKey === "deal" && (
                <div>
                  <h3 data-r10n-proposal-q className="text-[1.6rem] leading-[1.15] font-bold text-foreground mb-1.5 tracking-[-0.02em] text-balance" style={{ fontFamily: "var(--font-heading)" }}>How does {form.contact ? toTitleCase(form.contact.name.split(" ")[0]) : "the client"} pay?</h3>
                  <p className="text-sm text-muted-foreground mb-5">Pick the deal — we handle the billing.</p>

                  {form.type === "management" ? (
                    <div className="space-y-3">
                      <ChoiceCard active={form.autoRenew} icon={Repeat} title="Auto-renewing retainer" desc="Bills on a set schedule, renews automatically until cancelled." onClick={() => setAutoRenew(true)}>
                        <div>
                          <p className="text-[11px] font-medium text-foreground mb-2">Bills</p>
                          <Segmented id="seg-cadence"
                            options={[{ key: "month-1", label: "Monthly" }, { key: "month-3", label: "3 mo" }, { key: "month-6", label: "6 mo" }, { key: "year-1", label: "Yearly" }]}
                            value={customCadence ? "" : `${form.billingInterval}-${form.billingIntervalCount}`}
                            onChange={(k) => { const [iv, ct] = k.split("-"); setCustomCadence(false); setForm(prev => ({ ...prev, billingInterval: iv as FormState["billingInterval"], billingIntervalCount: ct })); }}
                          />
                          {!customCadence ? (
                            <button type="button" onClick={() => { setCustomCadence(true); setForm(prev => ({ ...prev, billingInterval: "month" })); }}
                              className="mt-2 block text-[11px] font-medium text-primary/80 hover:text-primary transition-colors">or set a custom period</button>
                          ) : (
                            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted-foreground">Every</span>
                              <input type="number" min="1" max="12" value={form.billingIntervalCount} onChange={e => set("billingIntervalCount", e.target.value)}
                                className="w-16 px-2 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
                              <span className="text-xs text-muted-foreground">months <span className="opacity-60">(max 12)</span></span>
                              <button type="button" onClick={() => { setCustomCadence(false); setForm(prev => ({ ...prev, billingInterval: "month", billingIntervalCount: "1" })); }}
                                className="ml-auto text-[11px] text-muted-foreground hover:text-foreground transition-colors">use a preset</button>
                            </div>
                          )}
                          <label className="flex items-center gap-2.5 mt-3 pt-3 border-t border-primary/10 cursor-pointer">
                            <input type="checkbox" checked={form.hasDeposit} onChange={e => set("hasDeposit", e.target.checked)} className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30" />
                            <span className="text-xs font-medium text-foreground">Collect a deposit up front</span>
                          </label>
                        </div>
                      </ChoiceCard>

                      <ChoiceCard active={!form.autoRenew} icon={CalendarClock} title="Fixed term, paid once" desc="One payment covering a set number of months. Never renews." onClick={() => setAutoRenew(false)}>
                        <div>
                          <p className="text-[11px] font-medium text-foreground mb-2">Length</p>
                          <Segmented id="seg-length"
                            options={[{ key: "1", label: "1 mo" }, { key: "3", label: "3 mo" }, { key: "6", label: "6 mo" }, { key: "12", label: "12 mo" }]}
                            value={customTerm ? "" : (form.billingInterval === "month" ? form.billingIntervalCount : "")}
                            onChange={(k) => { setCustomTerm(false); setForm(prev => ({ ...prev, billingInterval: "month", billingIntervalCount: k })); }}
                          />
                          {!customTerm ? (
                            <button type="button" onClick={() => { setCustomTerm(true); setForm(prev => ({ ...prev, billingInterval: "month" })); }}
                              className="mt-2 block text-[11px] font-medium text-primary/80 hover:text-primary transition-colors">or a custom length</button>
                          ) : (
                            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                              <input type="number" min="1" max="12" value={form.billingIntervalCount} onChange={e => set("billingIntervalCount", e.target.value)}
                                className="w-16 px-2 py-1.5 text-sm bg-background border border-border rounded-[6px] text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
                              <span className="text-xs text-muted-foreground">months <span className="opacity-60">(max 12)</span></span>
                              <button type="button" onClick={() => { setCustomTerm(false); setForm(prev => ({ ...prev, billingInterval: "month", billingIntervalCount: "6" })); }}
                                className="ml-auto text-[11px] text-muted-foreground hover:text-foreground transition-colors">use a preset</button>
                            </div>
                          )}
                        </div>
                      </ChoiceCard>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <ChoiceCard active={form.paymentStructure === "single"} icon={Wallet} title="One payment" desc="Pays the full amount once." onClick={() => set("paymentStructure", "single")} />
                      <ChoiceCard active={form.paymentStructure === "instalment"} icon={Layers} title="Split into payments" desc="A few scheduled payments — you'll set them next." onClick={() => set("paymentStructure", "instalment")} />
                    </div>
                  )}
                </div>
              )}

              {/* ── PRICE ── */}
              {currentKey === "price" && (
                <div>
                  <h3 data-r10n-proposal-q className="text-[1.6rem] leading-[1.15] font-bold text-foreground mb-1.5 tracking-[-0.02em] text-balance" style={{ fontFamily: "var(--font-heading)" }}>How much?</h3>
                  <p className="text-sm text-muted-foreground mb-5">{amountLabel(form)}.</p>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">{amountLabel(form)}</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base text-muted-foreground pointer-events-none">{currencySymbol}</span>
                        <input type="number" value={form.totalAmount} onChange={e => set("totalAmount", e.target.value)} placeholder="0" min="0" step="0.01" autoFocus
                          className="w-full pl-8 pr-3 py-2.5 text-base font-semibold bg-background border border-border rounded-[8px] text-foreground placeholder:text-muted-foreground/50 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                          style={{ fontFamily: "var(--font-heading)" }} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Currency</label>
                      <select value={form.currency} onChange={e => set("currency", e.target.value)}
                        className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-[8px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50">
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Discount */}
                  <div className="mt-4">
                    <label className="block text-xs font-medium text-foreground mb-1.5">Discount <span className="text-muted-foreground font-normal">(optional)</span></label>
                    <div className="flex items-stretch gap-2">
                      <div className="relative flex-1">
                        {form.discountType === "fixed" && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">{currencySymbol}</span>}
                        <input type="number" value={form.discountValue} onChange={e => set("discountValue", e.target.value)} placeholder="0" min="0" step="0.01"
                          className={cn("w-full pr-8 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50", form.discountType === "fixed" ? "pl-7" : "pl-3")} />
                        {form.discountType === "percent" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>}
                      </div>
                      <div className="flex rounded-[7px] border border-border overflow-hidden shrink-0">
                        {(["percent", "fixed"] as const).map(t => (
                          <button key={t} type="button" onClick={() => set("discountType", t)}
                            className={cn("px-3.5 text-sm font-semibold transition-colors", form.discountType === t ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>
                            {t === "percent" ? "%" : currencySymbol || "$"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <AnimatePresence>
                      {hasDiscount && (
                        <motion.div initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                          <div data-r10n-proposal-discount-strip className="mt-2 flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] bg-green-50 border border-green-200">
                            <span className="text-sm text-muted-foreground line-through tabular-nums">{fmtMoney(enteredPrice, form.currency)}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-sm font-bold text-foreground tabular-nums">{fmtMoney(billedTotal, form.currency)}</span>
                            <span data-r10n-proposal-discount-save className="ml-auto text-[11px] font-semibold text-green-700">{discountPct}% off · saves {fmtMoney(discountAmount, form.currency)}</span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {(parseFloat(form.discountValue) || 0) > 0 && billedTotal <= 0 && <p className="mt-2 text-[11px] text-amber-600">Discount can&apos;t be more than the price.</p>}
                  </div>

                  <div className="mt-4">
                    <label className="block text-xs font-medium text-foreground mb-1.5">{form.type === "management" && !form.autoRenew ? "Term starts" : "Start date"}</label>
                    <input type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
                  </div>

                  {form.type === "management" && form.autoRenew && (
                    <div className="mt-4">
                      <label className="block text-xs font-medium text-foreground mb-1.5">First subscription charge <span className="text-muted-foreground font-normal">(optional)</span></label>
                      <input type="date" value={form.subscriptionStartDate} onChange={e => set("subscriptionStartDate", e.target.value)}
                        max={format(new Date(new Date().setMonth(new Date().getMonth() + 18)), "yyyy-MM-dd")}
                        className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
                      <p className="mt-1.5 text-[11px] text-muted-foreground">When recurring billing starts. Leave blank for the default: one cycle after the start date, or immediately if there is no deposit.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── SCHEDULE ── */}
              {currentKey === "schedule" && (
                <div>
                  <h3 data-r10n-proposal-q className="text-[1.6rem] leading-[1.15] font-bold text-foreground mb-1.5 tracking-[-0.02em] text-balance" style={{ fontFamily: "var(--font-heading)" }}>Set the schedule</h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    {form.type === "project" ? `Split ${fmtMoney(billedTotal, form.currency)} into payments.` : `Set the deposit amount and when each payment is due.`}
                  </p>
                  {form.type === "project" ? (
                    <ScheduleEditor rows={form.instalments} currencySymbol={currencySymbol} onUpdate={updateInstalment} onAdd={addInstalment} onRemove={removeInstalment} onDistribute={distributeEvenly} total={billedTotal} addLabel="Add payment" />
                  ) : (
                    <ScheduleEditor rows={form.depositInstalments} currencySymbol={currencySymbol} onUpdate={updateDepositInstalment} onAdd={addDepositInstalment} onRemove={removeDepositInstalment} onDistribute={distributeDepositEvenly} total={form.depositInstalments.reduce((a, i) => a + (i.amount || 0), 0)} addLabel="Add deposit payment" />
                  )}
                </div>
              )}

              {/* ── REVEAL ── */}
              {currentKey === "reveal" && (
                <Reveal form={form} billedTotal={billedTotal} enteredPrice={enteredPrice} hasDiscount={hasDiscount} discountPct={discountPct} discountAmount={discountAmount} currencySymbol={currencySymbol} previewTerms={previewTerms} reduce={!!reduce} setNotes={(v) => set("notes", v)} error={error} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Live deal line — refined navy strip, updates in place */}
        <AnimatePresence>
          {showDealLine && (
            <motion.div initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              data-r10n-proposal-dealline
              className="mx-7 mb-1.5 px-3.5 py-2.5 rounded-[10px] bg-primary/[0.05] border border-primary/15 flex items-start gap-2.5">
              <span data-r10n-proposal-dealline-node className="mt-px w-4 h-4 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <ArrowRight className="w-2.5 h-2.5 text-primary" />
              </span>
              <p className="text-[11px] leading-relaxed text-foreground/80">{clientSentence(previewTerms)}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-7 py-4 border-t border-border/70 shrink-0">
          <button type="button" onClick={goBack}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-[7px] active:scale-[0.97]">
            {safeIndex > 0 && <ChevronLeft className="w-4 h-4" />}{safeIndex === 0 ? "Cancel" : "Back"}
          </button>
          {isLast ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => handleSubmit(false)} disabled={submitting}
                className="px-3.5 py-2.5 text-sm font-semibold rounded-[9px] border border-border text-foreground hover:border-primary/40 hover:bg-primary/[0.03] transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting && submitAction === "draft" ? "Saving…" : "Save as draft"}
              </button>
              <motion.button type="button" onClick={() => handleSubmit(true)} disabled={submitting}
                whileTap={!submitting && !reduce ? { scale: 0.97 } : undefined}
                data-r10n-proposal-wizard-cta
                className={cn("group/cta flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-[9px] transition-colors",
                  !submitting ? "bg-primary text-primary-foreground hover:bg-[#0c3251] shadow-[0_4px_12px_-8px_rgba(15,58,92,0.3)]" : "bg-muted text-muted-foreground cursor-not-allowed")}>
                {submitting && submitAction === "send" ? "Sending…" : <>Send to {form.contact ? toTitleCase(form.contact.name.split(" ")[0]) : "client"} <ArrowRight className="w-4 h-4 transition-transform group-hover/cta:translate-x-0.5" /></>}
              </motion.button>
            </div>
          ) : (
            <motion.button type="button" onClick={goNext} disabled={!advanceable}
              whileTap={advanceable && !reduce ? { scale: 0.97 } : undefined}
              data-r10n-proposal-wizard-cta
              className={cn("group/cta flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-[9px] transition-colors",
                advanceable ? "bg-primary text-primary-foreground hover:bg-[#0c3251] shadow-[0_4px_12px_-8px_rgba(15,58,92,0.3)]" : "bg-muted text-muted-foreground cursor-not-allowed")}>
              Continue <ChevronRight className="w-4 h-4 transition-transform group-hover/cta:translate-x-0.5" />
            </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Reveal screen ──────────────────────────────────────────────────────────────

function Reveal({ form, billedTotal, enteredPrice, hasDiscount, discountPct, discountAmount, currencySymbol, previewTerms, reduce, setNotes, error }: {
  form: FormState; billedTotal: number; enteredPrice: number; hasDiscount: boolean; discountPct: number; discountAmount: number;
  currencySymbol: string; previewTerms: BillingTerms; reduce: boolean; setNotes: (v: string) => void; error: string;
}) {
  const model = billingModel(previewTerms);
  const firstName = form.contact ? toTitleCase(form.contact.name.split(" ")[0]) : "Client";
  const dealTitle =
    form.type === "project"
      ? (model === "instalment" ? "One-time project · paid in instalments" : "One-time project")
      : model === "one_time_term"
        ? `${periodPhrase(form.billingInterval, parseInt(form.billingIntervalCount) || 1)} retainer · paid in full`
        : model === "monthly_recurring"
          ? "Monthly retainer"
          : `Retainer · billed every ${periodPhrase(form.billingInterval, parseInt(form.billingIntervalCount) || 1)}`;

  // The three "what happens" nodes, derived from the model.
  const start = fmtDay(form.startDate || null);
  let nodes: { top: string; bot: string }[];
  if (model === "one_time_term") {
    nodes = [{ top: "Pays once", bot: start ?? "—" }, { top: "Covers", bot: periodPhrase(form.billingInterval, parseInt(form.billingIntervalCount) || 1) }, { top: "Then", bot: "no renewal" }];
  } else if (model === "monthly_recurring") {
    nodes = [{ top: "Bills", bot: "every month" }, { top: "Starts", bot: start ?? "—" }, { top: "Renews", bot: "automatically" }];
  } else if (model === "recurring") {
    nodes = [{ top: "Bills", bot: `every ${periodPhrase(form.billingInterval, parseInt(form.billingIntervalCount) || 1)}` }, { top: "Starts", bot: start ?? "—" }, { top: "Renews", bot: "automatically" }];
  } else if (model === "instalment") {
    nodes = [{ top: "Pays in", bot: `${form.instalments.length} payments` }, { top: "First", bot: start ?? "—" }, { top: "Total", bot: fmtMoney(billedTotal, form.currency) }];
  } else {
    nodes = [{ top: "Pays once", bot: fmtMoney(billedTotal, form.currency) }, { top: "Starts", bot: start ?? "—" }, { top: "Then", bot: "complete" }];
  }
  if (form.type === "management" && form.hasDeposit) {
    nodes = [{ top: "Deposit", bot: `${form.depositInstalments.length} payment${form.depositInstalments.length > 1 ? "s" : ""} first` }, ...nodes.slice(1)];
  }

  const stagger = (i: number) => reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.15 + i * 0.08, duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <div className="pt-1">
      <div data-r10n-proposal-reveal-card className="relative rounded-[14px] border border-border/70 bg-background overflow-hidden shadow-[0_8px_28px_-26px_rgba(15,23,42,0.16)] ring-1 ring-foreground/[0.025]">
        {/* Price hero */}
        <div className="relative px-5 pt-6 pb-5 text-center overflow-hidden">
          {!reduce && <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: EASE_OUT }}
            data-r10n-proposal-reveal-glow
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-primary/[0.06] blur-2xl" />}
          <p data-r10n-proposal-reveal-eyebrow className="relative text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70 mb-1.5 truncate px-6">{firstName === "Client" ? "New proposal" : form.contact?.name && toTitleCase(form.contact.name)}</p>
          <p data-r10n-proposal-reveal-deal className="relative text-[13px] font-semibold text-primary/90 mb-4" style={{ fontFamily: "var(--font-heading)" }}>{dealTitle}</p>

          {hasDiscount && <p data-r10n-proposal-hero-strike className="relative text-sm text-muted-foreground/55 line-through tabular-nums leading-none">{fmtMoney(enteredPrice, form.currency)}</p>}
          <div data-r10n-proposal-reveal-amount className="relative text-[3.25rem] leading-none font-bold text-foreground tracking-[-0.03em] tabular-nums mt-1" style={{ fontFamily: "var(--font-heading)" }}>
            <CountUp value={billedTotal} prefix={currencySymbol || ""} animateOn={!reduce} />
          </div>
          {hasDiscount && (
            <motion.div initial={reduce ? false : { opacity: 0, scale: 0.9, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: 0.42, ...SPRING_SELECT }}
              data-r10n-proposal-reveal-savechip
              className="relative inline-flex items-center gap-1.5 mt-2.5 px-3 py-1 rounded-full bg-accent-green/10 border border-accent-green/25 overflow-hidden">
              {!reduce && <motion.span initial={{ x: "-130%" }} animate={{ x: "170%" }} transition={{ delay: 0.75, duration: 0.9, ease: EASE_OUT }}
                className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent" />}
              <span className="relative text-[11px] font-semibold text-accent-green">You save {fmtMoney(discountAmount, form.currency)} · {discountPct}% off</span>
            </motion.div>
          )}
        </div>

        {/* What happens — nodes with connectors that draw in */}
        <div data-r10n-proposal-reveal-band className="px-5 py-4 border-t border-border/70 bg-muted/25">
          <div className="flex items-stretch justify-between gap-1">
            {nodes.map((n, i) => (
              <div key={i} className="flex items-center gap-1 flex-1 min-w-0">
                <motion.div {...stagger(i)} className="flex-1 min-w-0 text-center">
                  <p data-r10n-proposal-reveal-node-top className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">{n.top}</p>
                  <p data-r10n-proposal-reveal-node-bot className="text-[11px] font-semibold text-foreground mt-1 leading-tight truncate" title={n.bot}>{n.bot}</p>
                </motion.div>
                {i < nodes.length - 1 && (
                  <motion.span initial={reduce ? false : { opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 + i * 0.08, duration: 0.3, ease: EASE_OUT }}>
                    <ArrowRight data-r10n-proposal-reveal-arrow className="w-3 h-3 text-primary/35 shrink-0" />
                  </motion.span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Details */}
        <div className="px-5 py-3 border-t border-border/70">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[11px] text-muted-foreground shrink-0">Included</span>
            <span className="text-[11px] font-medium text-foreground text-right">{scopeSummary(form)}</span>
          </div>
        </div>
      </div>

      {/* Internal note */}
      <div className="mt-4">
        <label className="block text-xs font-medium text-foreground mb-1.5">Note for your team <span className="text-muted-foreground font-normal">(optional, never shown to the client)</span></label>
        <textarea value={form.notes} onChange={e => setNotes(e.target.value)} placeholder="Anything your team should know…" rows={2}
          className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 resize-none" />
      </div>

      {error && <p className="mt-3 text-xs text-red-500 bg-red-50 px-3 py-2 rounded-[6px]">{error}</p>}
    </div>
  );
}
