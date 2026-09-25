"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, ExternalLink, Copy, Check, Send, Clock, CreditCard, Repeat, Download, Eye, Mail, Trash2, Ban } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import { ProposalStatusBadge } from "./proposal-status-badge";
import { ActivityTimeline } from "./engagement";
import { BillingActivity } from "./billing-activity";
import { discountInfo, clientSentence, fullTermTotal, termMultiplier, managementSchedule, isNinetyDay, billingAnchor, type BillingTerms } from "@/lib/proposals/billing";

interface Instalment {
  id: string;
  instalmentNumber: number;
  amount: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
  isDeposit?: boolean;
  stripeHostedUrl?: string | null;
  /** Null means NO INVOICE EXISTS. Not "unpaid": nobody has been asked. */
  stripeInvoiceId?: string | null;
}

interface Proposal {
  id: string;
  token: string;
  title: string;
  type: string;
  contactName: string;
  contactEmail: string | null;
  ghlContactId: string;
  status: string;
  totalAmount: number;
  currency: string;
  paymentStructure: string;
  serviceDescription: string | null;
  sentAt: string | null;
  signedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  instalments: Instalment[];
  stripeHostedUrl?: string | null;
  notes?: string | null;
  billingInterval?: string | null;
  billingIntervalCount?: number | null;
  autoRenew?: boolean | null;
  listAmount?: number | null;
  discountType?: string | null;
  discountValue?: number | null;
  discountScope?: string | null;
  startDate?: string | null;
  // 90-Day Management billing display fields.
  managementOption?: string | null;
  autoRebillMode?: string | null;
  firstPaymentSplit?: Array<{ amount: number; offsetDays?: number }> | null;
  contractStartAt?: string | null;
  expiresAt?: string | null;
  hasDeposit?: boolean;
  depositTotal?: number | null;
  depositsPaidTotal?: number | null;
  subscriptionCreatedAt?: string | null;
  /** Term progress for a 90-day spread retainer, supplied by the API from
   *  lib/proposals/status.ts. Absent for every other proposal type, and absent until the
   *  derivation is wired into the proposals endpoints — the UI simply renders nothing then. */
  termProgress?: { collected: number; expected: number; amountCollected: number | null; amountExpected: number | null } | null;
}

interface ProposalDetailSlideOverProps {
  proposal: Proposal;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
  isAdmin?: boolean;
  initialSendStep?: "idle" | "confirm";
}

function fmtDate(d: string | null | undefined, tz: string) {
  if (!d) return null;
  return format(toZonedDate(new Date(d), tz), "d MMM yyyy");
}

/** Format a calendar date (startDate, dueDate, expiresAt) using UTC — no timezone shift */
function fmtCalendarDate(d: string | null | undefined) {
  if (!d) return null;
  const date = new Date(d);
  return `${date.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount);
}

function ScopeDisplay({ text }: { text: string }) {
  const sections = text.split(/\n\n+/);
  return (
    <div className="space-y-3">
      {sections.map((section, si) => {
        const lines = section.split("\n").filter(Boolean);
        if (!lines.length) return null;
        const firstLine = lines[0];
        const isHeader = firstLine.endsWith(":") && !firstLine.startsWith("•");
        const header = isHeader ? firstLine.slice(0, -1) : null;
        const bodyLines = isHeader ? lines.slice(1) : lines;
        const bullets = bodyLines.filter((l) => l.startsWith("•") || l.startsWith("-") || l.startsWith("*"));
        const prose = bodyLines.filter((l) => !l.startsWith("•") && !l.startsWith("-") && !l.startsWith("*"));
        return (
          <div key={si}>
            {header && (
              <p className="text-[10px] font-bold text-foreground uppercase tracking-wide mb-1">{header}</p>
            )}
            {bullets.length > 0 && (
              <ul className="space-y-0.5">
                {bullets.map((line, li) => (
                  <li key={li} className="flex items-baseline gap-1.5 text-xs text-foreground/80">
                    <span className="text-foreground/40 shrink-0">•</span>
                    <span>{line.replace(/^[•\-*]\s*/, "")}</span>
                  </li>
                ))}
              </ul>
            )}
            {prose.map((line, li) => (
              <p key={li} className="text-xs text-foreground/80 leading-relaxed">{line}</p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What is actually happening with this payment.
 *
 * WHY THIS IS NOT JUST `status`
 * The row's status only ever said "pending", which covered two completely different situations:
 * an invoice sitting with the client waiting to be paid, and NO INVOICE HAVING EVER BEEN RAISED.
 * The second is the one that cost us: nine clients and $20,975 sat unbilled for six weeks and
 * this screen showed them as "1 of 2 paid, one pending", indistinguishable from a payment that
 * was simply not due yet. Nobody could have spotted it here, because it was not shown.
 *
 * So the absence of an invoice now has its own, louder label.
 */
function InstalmentBadge({ inst }: { inst: Instalment }) {
  const overdue = !!inst.dueDate && new Date(inst.dueDate) < new Date();
  const kind =
    inst.status === "paid" ? "paid"
    : inst.status === "failed" ? "failed"
    : inst.status === "cancelled" ? "cancelled"
    : !inst.stripeInvoiceId ? "not-billed"
    : overdue ? "awaiting"
    : "scheduled";

  const look: Record<string, { label: string; className: string; title: string }> = {
    paid:        { label: "Paid",        className: "bg-green-50 text-green-700",  title: "Collected" },
    failed:      { label: "Failed",      className: "bg-red-50 text-red-700",      title: "The payment was declined. It blocks the next instalment until it is resolved." },
    cancelled:   { label: "Cancelled",   className: "bg-muted text-muted-foreground", title: "This payment was cancelled and will not be collected." },
    "not-billed":{ label: "Not billed",  className: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300", title: "No invoice exists for this payment yet, so the client has not been asked for it. It is raised automatically once the previous instalment is paid." },
    awaiting:    { label: "Awaiting",    className: "bg-amber-50 text-amber-700",  title: "Invoiced and past its due date, not yet paid." },
    scheduled:   { label: "Scheduled",   className: "bg-blue-50 text-blue-700",    title: "Invoiced and set to collect on its due date." },
  };
  const v = look[kind];

  return (
    <span
      data-r10n-status-pill
      data-status={kind}
      title={v.title}
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide",
        v.className,
      )}
    >
      {v.label}
    </span>
  );
}

function InstalmentTable({ proposal, onUpdate }: { proposal: Proposal; onUpdate: () => void }) {
  const tz = useUserTimezone();
  const canMarkPaid = ["signed", "partial"].includes(proposal.status);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [localInstalments, setLocalInstalments] = useState(proposal.instalments);

  async function togglePaid(inst: Instalment) {
    const newStatus = inst.status === "paid" ? "pending" : "paid";

    // ASK FIRST. This used to colour a badge. It now cancels the Stripe invoice for this
    // instalment and raises the NEXT one, which for a client with a card on file is a real
    // debit. A single mis-click on a row should not move a customer's money.
    const warning = newStatus === "paid"
      ? `Mark instalment ${inst.instalmentNumber} as paid?\n\n` +
        `This cancels any Stripe invoice for it and schedules the next instalment, which will ` +
        `charge the client's saved payment method on its due date.`
      : `Mark instalment ${inst.instalmentNumber} as unpaid again?`;
    if (!window.confirm(warning)) return;

    setLoadingId(inst.id);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/instalments/${inst.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        // Never show a payment as changed when the server refused. The old code updated the
        // row on screen regardless, so a 403 looked exactly like success.
        const { error } = await res.json().catch(() => ({ error: "" }));
        window.alert(error || "That change was not saved.");
        return;
      }
      setLocalInstalments((prev) =>
        prev.map((i) => i.id === inst.id ? { ...i, status: newStatus, paidAt: newStatus === "paid" ? new Date().toISOString() : null } : i)
      );
      onUpdate();
    } finally {
      setLoadingId(null);
    }
  }

  const paidCount = localInstalments.filter((i) => i.status === "paid").length;
  // Money nobody has asked for. Worth its own line, because the progress bar counts what has
  // been PAID and is perfectly happy to show "1 of 2" for a payment that was never even raised.
  const unbilled = localInstalments.filter(
    (i) => !["paid", "cancelled", "superseded_by_subscription"].includes(i.status) && !i.stripeInvoiceId,
  );
  const unbilledTotal = unbilled.reduce((t, i) => t + i.amount, 0);

  return (
    <div data-r10n-proposal-subtable className="bg-muted/30 rounded-[8px] overflow-hidden border border-border/60">
      {paidCount > 0 && (
        <div data-r10n-proposal-progress className="px-3 py-2 bg-orange-50 border-b border-orange-100 flex items-center gap-2">
          <span data-r10n-proposal-progress-label className="text-[11px] font-semibold text-orange-700">
            {paidCount} of {localInstalments.length} instalment{localInstalments.length !== 1 ? "s" : ""} paid
          </span>
          <div data-r10n-proposal-progress-track className="flex-1 h-1 bg-orange-200 rounded-full overflow-hidden">
            <div
              data-r10n-proposal-progress-bar
              className="h-full bg-orange-500 rounded-full transition-all"
              style={{ width: `${(paidCount / localInstalments.length) * 100}%` }}
            />
          </div>
        </div>
      )}
      {unbilled.length > 0 && (
        <div
          data-r10n-proposal-unbilled
          className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-[11px] leading-relaxed text-amber-900"
        >
          <span className="font-semibold">
            {fmtAmount(unbilledTotal, proposal.currency)} has no invoice raised
          </span>
          {" "}
          {unbilled.length === 1 ? "on this plan." : `across ${unbilled.length} payments.`}{" "}
          {unbilled.length === localInstalments.length - paidCount && paidCount > 0
            ? "It is raised automatically once the previous payment clears."
            : "The next one is raised automatically as each payment clears."}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60">
            <th data-r10n-th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">#</th>
            <th data-r10n-th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
            <th data-r10n-th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Due</th>
            <th data-r10n-th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
            {canMarkPaid && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {localInstalments
            .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
            .map((inst) => (
              <tr key={inst.id} className="border-b border-border/40 last:border-0">
                <td data-r10n-proposal-subtable-cell className="px-3 py-2 text-muted-foreground text-xs">{inst.instalmentNumber}</td>
                <td data-r10n-proposal-subtable-amount className="px-3 py-2 text-right tabular-nums font-medium text-foreground/80 text-xs">
                  {fmtAmount(inst.amount, proposal.currency)}
                </td>
                <td data-r10n-proposal-subtable-cell className="px-3 py-2 text-muted-foreground text-xs tabular-nums">
                  {fmtCalendarDate(inst.dueDate)}
                </td>
                <td className="px-3 py-2">
                  <InstalmentBadge inst={inst} />
                </td>
                {canMarkPaid && (
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => togglePaid(inst)}
                      disabled={loadingId === inst.id}
                      data-r10n-proposal-markpaid
                      data-paid={inst.status === "paid"}
                      className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-[4px] transition-colors disabled:opacity-50",
                        inst.status === "paid"
                          ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                          : "text-green-700 bg-green-50 hover:bg-green-100"
                      )}
                    >
                      {loadingId === inst.id ? "…" : inst.status === "paid" ? "Undo" : "Mark Paid"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProposalDetailSlideOver({ proposal, onClose, onUpdated, onDeleted, isAdmin, initialSendStep }: ProposalDetailSlideOverProps) {
  const tz = useUserTimezone();
  const [copied, setCopied] = useState(false);
  const [sendStep, setSendStep] = useState<"idle" | "confirm">(initialSendStep ?? "idle");
  const [sendEmail, setSendEmail] = useState(proposal.contactEmail ?? "");
  const [emailWarning, setEmailWarning] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [markPaidStep, setMarkPaidStep] = useState<"idle" | "confirm">("idle");
  const [markPaidDate, setMarkPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deleteStep, setDeleteStep] = useState<"idle" | "confirm">("idle");
  const [markLostStep, setMarkLostStep] = useState<"idle" | "confirm">("idle");
  const [lostReason, setLostReason] = useState("");
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/proposals/${proposal.id}`, { method: "DELETE" });
      const json = await r.json();
      if (!r.ok || json.error) throw new Error(json.error ?? "Failed to delete");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      onDeleted?.();
      onClose();
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async (paidAt: string) => {
      const r = await fetch(`/api/proposals/${proposal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid", paidAt: new Date(paidAt + "T12:00:00.000Z").toISOString() }),
      });
      const json = await r.json();
      if (!r.ok || json.error) throw new Error(json.error ?? "Failed");
      return json;
    },
    onSuccess: () => {
      setMarkPaidStep("idle");
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      onUpdated();
    },
  });

  const lostMutation = useMutation({
    mutationFn: async (reason: string) => {
      const r = await fetch(`/api/proposals/${proposal.id}/lost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await r.json();
      if (!r.ok || json.error) throw new Error(json.error ?? "Failed to mark lost");
      return json;
    },
    onSuccess: () => {
      setMarkLostStep("idle");
      setLostReason("");
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      onUpdated();
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (recipientEmail?: string) => {
      const r = await fetch(`/api/proposals/${proposal.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: recipientEmail || undefined }),
      });
      const json = await r.json();
      if (!r.ok || json.error) throw new Error(json.error ?? "Failed to send");
      return json;
    },
    onSuccess: (data) => {
      setSendStep("idle");
      if (data?.emailWarning) setEmailWarning(data.emailWarning);
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      onUpdated();
    },
  });


  const [resendStep, setResendStep] = useState<"idle" | "confirm">("idle");
  const [resendEmail, setResendEmail] = useState(proposal.contactEmail ?? "");

  const resendEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      const r = await fetch(`/api/proposals/${proposal.id}/resend-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: email || undefined }),
      });
      const json = await r.json();
      if (!r.ok || json.error) throw new Error(json.error ?? "Failed to resend");
      return json;
    },
    onSuccess: () => {
      setResendStep("idle");
      setResendSuccess(true);
      setTimeout(() => setResendSuccess(false), 3000);
    },
  });

  const publicUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/p/${proposal.token}`
      : `/p/${proposal.token}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }

  const paidCount = proposal.instalments.filter((i) => i.status === "paid").length;
  const totalCount = proposal.instalments.length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-foreground/10 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div data-r10n-proposal-panel className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-card border-l border-border shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="min-w-0 pr-3">
            <div className="flex items-center gap-2 flex-wrap">
              <ProposalStatusBadge status={proposal.status} management={proposal.type === "management"} />
              <span
                data-r10n-proposal-type
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide",
                  proposal.type === "management"
                    ? "bg-indigo-50 text-indigo-700"
                    : "bg-blue-50 text-blue-700"
                )}
              >
                {proposal.type === "management" ? "Management" : "Project"}
              </span>
            </div>
            <h2
              data-r10n-proposal-panel-name
              className="mt-2 text-base font-semibold text-foreground truncate"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {proposal.contactName}
            </h2>
            {proposal.contactEmail && (
              <p data-r10n-proposal-panel-email className="text-xs text-muted-foreground">{proposal.contactEmail}</p>
            )}
            <a
              href={`/pipeline?contact=${proposal.ghlContactId}`}
              data-r10n-proposal-opplink
              className="inline-flex items-center gap-1 mt-1 text-[11px] text-primary/70 hover:text-primary transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              View opportunity
            </a>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Amount */}
          {(() => {
            const terms = proposal as BillingTerms;
            const disc = discountInfo(terms);
            const isMgmt = proposal.type === "management";
            // 90-Day Management leads with the full 90-day total (monthly × 3); mult is 1 elsewhere.
            const mult = termMultiplier(terms);
            const mgmtSchedule = managementSchedule(terms);
  const termProgress = proposal.termProgress ?? null;
            return (
              <div data-r10n-proposal-hero className="text-center py-4 px-4 bg-muted/30 rounded-[10px]">
                {disc && (
                  <p data-r10n-proposal-hero-strike className="text-sm text-muted-foreground/60 line-through tabular-nums">
                    {fmtAmount(disc.listAmount, proposal.currency)}
                  </p>
                )}
                <p
                  data-r10n-proposal-hero-amount
                  className="text-3xl font-bold text-foreground"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {fmtAmount(fullTermTotal(terms), proposal.currency)}
                </p>
                {disc && (
                  <p data-r10n-proposal-discount className="text-xs font-semibold text-green-700 mt-0.5">
                    {disc.pct}% off · saves {fmtAmount(disc.saved, proposal.currency)}
                  </p>
                )}
                {isMgmt && (
                  <p data-r10n-proposal-hero-meta className="text-xs text-muted-foreground mt-1.5 leading-snug">{clientSentence(terms)}</p>
                )}
                {mgmtSchedule && mgmtSchedule.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/60 text-left space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 text-center">Payment Schedule</p>
                    {termProgress && (
                      // The full progress line lives here rather than in the list, where the pill
                      // carries only the counter. Says collected-vs-contracted in one read.
                      <p data-r10n-term-progress className="text-[11px] text-muted-foreground text-center mb-1.5 tabular-nums">
                        <span className="font-semibold text-foreground">{termProgress.collected} of {termProgress.expected}</span>
                        {" collected"}
                        {termProgress.amountCollected != null && termProgress.amountExpected != null && (
                          <> · {fmtAmount(termProgress.amountCollected, proposal.currency)} of {fmtAmount(termProgress.amountExpected, proposal.currency)}</>
                        )}
                      </p>
                    )}
                    {mgmtSchedule.map((row, i) => (
                      <div key={i} className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground min-w-0 truncate">{row.label} · {row.when}</span>
                        <span className="text-xs font-medium text-foreground tabular-nums shrink-0">{fmtAmount(row.amount, proposal.currency)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {proposal.paymentStructure === "instalment" && totalCount > 0 && (
                  <p data-r10n-proposal-hero-meta className="text-xs text-muted-foreground mt-1">
                    {paidCount}/{totalCount} instalments paid
                  </p>
                )}
              </div>
            );
          })()}

          {/* Timeline dates */}
          <div data-r10n-proposal-timeline className="grid grid-cols-3 gap-px bg-border rounded-[8px] overflow-hidden">
            {[
              { label: "Created", date: proposal.createdAt, icon: Clock },
              { label: "Sent", date: proposal.sentAt, icon: Send },
              { label: "Signed", date: proposal.signedAt, icon: Check },
            ].map(({ label, date, icon: Icon }) => (
              <div key={label} data-r10n-proposal-timeline-cell className="bg-card px-3 py-2.5 text-center">
                <Icon data-r10n-proposal-timeline-icon className="w-3 h-3 text-muted-foreground mx-auto mb-1" />
                <p data-r10n-proposal-timeline-label className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
                <p data-r10n-proposal-timeline-date className="text-xs font-medium text-foreground mt-0.5">
                  {fmtDate(date, tz) ?? <span className="text-muted-foreground/50">—</span>}
                </p>
              </div>
            ))}
          </div>

          {/* Signed agreement — prominent view/download of the legal record */}
          {proposal.signedAt && (
            <div className="rounded-[8px] border border-green-600/30 bg-green-600/[0.05] p-3.5">
              <div className="flex items-center gap-2 mb-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-600/15">
                  <Check className="w-3.5 h-3.5 text-green-700" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">Signed agreement on file</p>
                  <p className="text-[10px] text-muted-foreground">Signed {fmtDate(proposal.signedAt, tz)} · signature, timestamp & IP stored</p>
                </div>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/proposals/${proposal.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground bg-card border border-border rounded-[7px] hover:border-foreground/40 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  View signed agreement
                </a>
                <a
                  href={`/api/proposals/${proposal.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-green-700 rounded-[7px] hover:bg-green-800 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PDF
                </a>
              </div>
            </div>
          )}

          {/* Prospect activity timeline (opens / clicks / views) */}
          <ActivityTimeline
            proposalId={proposal.id}
            sentAt={proposal.sentAt}
            signedAt={proposal.signedAt}
            paidAt={proposal.paidAt ?? null}
          />

          {/* Billing activity — every invoice / payment / reminder / subscription event */}
          <BillingActivity proposalId={proposal.id} />

          {/* Service description */}
          {proposal.serviceDescription && (
            <div>
              <p data-r10n-proposal-section className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Service</p>
              <ScopeDisplay text={proposal.serviceDescription} />
            </div>
          )}

          {/* Instalment table */}
          {proposal.paymentStructure === "instalment" && proposal.instalments.length > 0 && (
            <div>
              <p data-r10n-proposal-section className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Instalments
              </p>
              <InstalmentTable proposal={proposal} onUpdate={() => queryClient.invalidateQueries({ queryKey: ["proposals"] })} />
            </div>
          )}

          {/* Subscription details */}
          {proposal.paymentStructure === "subscription" && (
            <div>
              <p data-r10n-proposal-section className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Billing
              </p>
              <div data-r10n-proposal-tile className="flex items-center gap-2 px-3 py-2.5 bg-muted/30 rounded-[8px] border border-border/60">
                <Repeat data-r10n-proposal-tile-icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground/80">
                  {isNinetyDay(proposal as BillingTerms)
                    // 90-day: the full-term total framed as monthly × 3, so it agrees with the hero
                    // ($4,500) instead of showing the raw monthly rate.
                    ? `${fmtAmount(fullTermTotal(proposal as BillingTerms), proposal.currency)} over the 90-day term (${fmtAmount(proposal.totalAmount, proposal.currency)}/mo × 3)`
                    : `${fmtAmount(proposal.totalAmount, proposal.currency)} every ${
                        proposal.billingIntervalCount && proposal.billingIntervalCount > 1
                          ? `${proposal.billingIntervalCount} ${proposal.billingInterval}s`
                          : proposal.billingInterval
                      }`}
                </span>
                {billingAnchor(proposal as BillingTerms) && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {/* Same anchor as the payment schedule rendered above, so this "from" date
                        cannot quote a different day once contractStartAt is set. */}
                    from {fmtCalendarDate(billingAnchor(proposal as BillingTerms)!.toISOString())}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Deposit progress */}
          {proposal.hasDeposit && (() => {
            const depositInstalments = proposal.instalments.filter(i => i.isDeposit);
            const paidDeposits = depositInstalments.filter(i => i.status === "paid").length;
            const totalDeposits = depositInstalments.length;
            const depositTotal = proposal.depositTotal ?? proposal.totalAmount;
            const depositsPaid = proposal.depositsPaidTotal ?? 0;

            return (
              <div>
                <p data-r10n-proposal-section className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Deposits
                </p>
                <div data-r10n-proposal-subtable className="bg-muted/30 rounded-[8px] overflow-hidden border border-border/60">
                  {/* Progress header */}
                  <div data-r10n-proposal-progress data-tone="deposit" className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
                    <span data-r10n-proposal-progress-label className="text-[11px] font-semibold text-indigo-700">
                      {paidDeposits} of {totalDeposits} deposit{totalDeposits !== 1 ? "s" : ""} paid — {fmtAmount(depositsPaid, proposal.currency)} / {fmtAmount(depositTotal, proposal.currency)}
                    </span>
                    <div data-r10n-proposal-progress-track className="flex-1 h-1 bg-indigo-200 rounded-full overflow-hidden">
                      <div
                        data-r10n-proposal-progress-bar
                        className="h-full bg-indigo-500 rounded-full transition-all"
                        style={{ width: `${totalDeposits > 0 ? (paidDeposits / totalDeposits) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Deposit rows */}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60">
                        <th data-r10n-th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">#</th>
                        <th data-r10n-th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                        <th data-r10n-th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Due</th>
                        <th data-r10n-th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {depositInstalments
                        .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
                        .map((inst) => (
                          <tr key={inst.id} className="border-b border-border/40 last:border-0">
                            <td data-r10n-proposal-subtable-cell className="px-3 py-2 text-muted-foreground text-xs">{inst.instalmentNumber}</td>
                            <td data-r10n-proposal-subtable-amount className="px-3 py-2 text-right tabular-nums font-medium text-foreground/80 text-xs">
                              {fmtAmount(inst.amount, proposal.currency)}
                            </td>
                            <td data-r10n-proposal-subtable-cell className="px-3 py-2 text-muted-foreground text-xs tabular-nums">
                              {fmtCalendarDate(inst.dueDate)}
                            </td>
                            <td className="px-3 py-2">
                              <InstalmentBadge inst={inst} />
                            </td>
                            <td className="px-3 py-2 text-right">
                              {inst.stripeHostedUrl && inst.status !== "paid" && (
                                <a
                                  href={inst.stripeHostedUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  data-r10n-proposal-paylink
                                  className="text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors"
                                >
                                  Pay Link
                                </a>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>

                  {/* Subscription status */}
                  <div className="px-3 py-2 border-t border-border/60 bg-muted/20">
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-semibold">Subscription:</span>{" "}
                      {proposal.subscriptionCreatedAt
                        ? `Active since ${fmtDate(proposal.subscriptionCreatedAt, tz)}`
                        : "Pending deposits"
                      }
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Expiry */}
          {proposal.expiresAt && !["paid", "void"].includes(proposal.status) && (
            <div data-r10n-proposal-expiry className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200/50 rounded-[7px]">
              <Clock data-r10n-proposal-expiry-icon className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span data-r10n-proposal-expiry-text className="text-xs text-amber-700 font-medium">
                Expires {fmtCalendarDate(proposal.expiresAt)}
              </span>
            </div>
          )}

          {/* Stripe link */}
          {proposal.stripeHostedUrl && (
            <div>
              <p data-r10n-proposal-section className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Payment Link
              </p>
              <a
                href={proposal.stripeHostedUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-r10n-proposal-tile
                className="flex items-center gap-2 px-3 py-2.5 bg-muted/30 border border-border/60 rounded-[8px] hover:bg-muted/50 transition-colors group"
              >
                <CreditCard data-r10n-proposal-tile-icon className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-foreground/80 font-medium flex-1 truncate">
                  Stripe Invoice
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              </a>
            </div>
          )}

          {/* Public link */}
          {["sent", "signed"].includes(proposal.status) && (
            <div>
              <p data-r10n-proposal-section className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Client Link
              </p>
              <div data-r10n-proposal-tile className="flex items-center gap-2 px-3 py-2 bg-muted/30 border border-border/60 rounded-[8px]">
                <span data-r10n-proposal-token className="text-xs text-muted-foreground font-mono flex-1 truncate">
                  /p/{proposal.token.slice(0, 12)}…
                </span>
                <button
                  onClick={copyLink}
                  data-r10n-proposal-copy
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          {/* Notes */}
          {proposal.notes && (
            <div>
              <p data-r10n-proposal-section className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Notes</p>
              <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">{proposal.notes}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-border shrink-0 space-y-2">
          {/* Preview + Live link row */}
          <div className="flex gap-2">
            <a
              href={`/p/${proposal.token}?preview=1`}
              target="_blank"
              rel="noopener noreferrer"
              data-r10n-proposal-cta="ghost"
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              Preview
            </a>
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-r10n-proposal-cta="ghost"
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Live Link
            </a>
          </div>

          {proposal.status === "draft" && (
            <div className="space-y-2">
              {/* Primary send button — slides out when confirm opens */}
              <div
                className="overflow-hidden transition-all duration-300 ease-out"
                style={{ maxHeight: sendStep === "idle" ? "52px" : "0px", opacity: sendStep === "idle" ? 1 : 0 }}
              >
                <button
                  onClick={() => { setSendEmail(proposal.contactEmail ?? ""); setSendStep("confirm"); }}
                  data-r10n-proposal-cta="primary"
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-[8px] hover:bg-primary/90 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send to Client
                </button>
              </div>

              {/* Confirm step — slides in */}
              <div
                className="overflow-hidden transition-all duration-300 ease-out"
                style={{ maxHeight: sendStep === "confirm" ? "120px" : "0px", opacity: sendStep === "confirm" ? 1 : 0 }}
              >
                <div className="space-y-2 pt-0.5">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border border-border rounded-[7px]">
                    <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <input
                      type="email"
                      value={sendEmail}
                      onChange={(e) => setSendEmail(e.target.value)}
                      placeholder="Recipient email"
                      className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                    />
                  </div>
                  {sendMutation.isError && (
                    <p data-r10n-proposal-error className="text-[11px] text-red-600 px-1">
                      {(sendMutation.error as Error)?.message ?? "Send failed"}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setSendStep("idle"); sendMutation.reset(); }}
                      data-r10n-proposal-cta="ghost"
                      className="flex-1 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => sendMutation.mutate(sendEmail.trim() !== proposal.contactEmail ? sendEmail.trim() : undefined)}
                      disabled={sendMutation.isPending || !sendEmail.trim()}
                      data-r10n-proposal-cta="primary"
                      className="flex-[2] flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-[7px] hover:bg-primary/90 transition-colors disabled:opacity-60"
                    >
                      <Send className="w-3 h-3" />
                      {sendMutation.isPending ? "Sending…" : "Confirm & Send"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {proposal.status === "signed" && proposal.stripeHostedUrl && (
            <a
              href={proposal.stripeHostedUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-r10n-proposal-cta="pay"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-[8px] hover:bg-green-700 transition-colors"
            >
              <CreditCard className="w-3.5 h-3.5" />
              View Stripe Invoice
            </a>
          )}

          {proposal.status === "sent" && (
            <div className="space-y-2">
              <div data-r10n-proposal-wait className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                Waiting for client signature
              </div>
              {emailWarning && (
                <p data-r10n-proposal-emailwarn className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-[6px] px-3 py-2 leading-snug">
                  ⚠️ {emailWarning}
                </p>
              )}
              {resendSuccess ? (
                <p data-r10n-proposal-resend-ok className="text-center text-[11px] text-green-600 font-medium py-1">Email sent ✓</p>
              ) : resendStep === "idle" ? (
                <button
                  onClick={() => { setResendEmail(proposal.contactEmail ?? ""); setResendStep("confirm"); }}
                  data-r10n-proposal-cta="ghost"
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Resend Email to Client
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground px-0.5">
                    Originally sent to: <span className="font-medium text-foreground">{proposal.contactEmail ?? "—"}</span>
                  </p>
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border border-border rounded-[7px]">
                    <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <input
                      type="email"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="Send to address"
                      className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                    />
                  </div>
                  {resendEmailMutation.isError && (
                    <p data-r10n-proposal-error className="text-[11px] text-red-600 px-1">
                      {(resendEmailMutation.error as Error)?.message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setResendStep("idle"); resendEmailMutation.reset(); }}
                      data-r10n-proposal-cta="ghost"
                      className="flex-1 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => resendEmailMutation.mutate(resendEmail.trim())}
                      disabled={resendEmailMutation.isPending || !resendEmail.trim()}
                      data-r10n-proposal-cta="primary"
                      className="flex-[2] flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-[7px] hover:bg-primary/90 transition-colors disabled:opacity-60"
                    >
                      <Send className="w-3 h-3" />
                      {resendEmailMutation.isPending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {proposal.status === "paid" && (
            <div data-r10n-proposal-paid-confirm className="flex items-center justify-center gap-1.5 text-xs text-green-600 font-medium">
              <Check className="w-3.5 h-3.5" />
              {fmtDate(proposal.paidAt, tz) ? `Paid on ${fmtDate(proposal.paidAt, tz)}` : "Paid in full"}
            </div>
          )}

          {/* Deposit reconciliation is fully automatic (Stripe webhook + settleDeposits). No manual button. */}

          {/* Mark as Paid — manual backfill for existing clients */}
          {/* Aligned with InstalmentTable's own canMarkPaid. "active"/"completed" are derived from
              the subscription, so overwriting them by hand would be immediately undone and would
              also clobber a live term. */}
          {!["paid", "void", "active", "completed", "past_due", "lost"].includes(proposal.status) && (
            <div className="space-y-2">
              <div
                className="overflow-hidden transition-all duration-300 ease-out"
                style={{ maxHeight: markPaidStep === "idle" ? "52px" : "0px", opacity: markPaidStep === "idle" ? 1 : 0 }}
              >
                <button
                  onClick={() => setMarkPaidStep("confirm")}
                  data-r10n-proposal-cta="positive-soft"
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-[7px] hover:bg-emerald-100 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Mark as Paid
                </button>
              </div>

              <div
                className="overflow-hidden transition-all duration-300 ease-out"
                style={{ maxHeight: markPaidStep === "confirm" ? "140px" : "0px", opacity: markPaidStep === "confirm" ? 1 : 0 }}
              >
                <div className="space-y-2 pt-0.5">
                  <p className="text-[10px] text-muted-foreground px-0.5">Set the payment date:</p>
                  <input
                    type="date"
                    value={markPaidDate}
                    onChange={(e) => setMarkPaidDate(e.target.value)}
                    className="w-full h-8 rounded-[7px] border border-border bg-card px-2.5 text-xs text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {markPaidMutation.isError && (
                    <p data-r10n-proposal-error className="text-[11px] text-red-600 px-1">
                      {(markPaidMutation.error as Error)?.message ?? "Failed"}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setMarkPaidStep("idle"); markPaidMutation.reset(); }}
                      data-r10n-proposal-cta="ghost"
                      className="flex-1 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => markPaidMutation.mutate(markPaidDate)}
                      disabled={markPaidMutation.isPending || !markPaidDate}
                      data-r10n-proposal-cta="positive"
                      className="flex-[2] flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 text-white text-xs font-medium rounded-[7px] hover:bg-emerald-700 transition-colors disabled:opacity-60"
                    >
                      <Check className="w-3 h-3" />
                      {markPaidMutation.isPending ? "Saving…" : "Confirm Payment"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Mark as Lost — for proposals that won't close */}
          {!["paid", "void", "lost", "active", "completed"].includes(proposal.status) && (
            <div className="space-y-2">
              {markLostStep === "idle" ? (
                <button
                  onClick={() => setMarkLostStep("confirm")}
                  data-r10n-proposal-cta="lost-soft"
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-amber-700 border border-amber-200 bg-amber-50 rounded-[7px] hover:bg-amber-100 transition-colors"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Mark as Lost
                </button>
              ) : (
                <div data-r10n-proposal-promptbox="lost" className="space-y-2 p-3 bg-amber-50/60 border border-amber-200 rounded-[8px]">
                  <p className="text-[10px] text-muted-foreground px-0.5">
                    Why was it lost? (required). This also voids any unpaid invoices.
                  </p>
                  <textarea
                    value={lostReason}
                    onChange={(e) => setLostReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. Went with a competitor on price"
                    className="w-full rounded-[7px] border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                  {lostMutation.isError && (
                    <p data-r10n-proposal-error className="text-[11px] text-red-600 px-1">{(lostMutation.error as Error)?.message}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setMarkLostStep("idle"); lostMutation.reset(); }}
                      data-r10n-proposal-cta="ghost"
                      className="flex-1 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => lostMutation.mutate(lostReason.trim())}
                      disabled={lostMutation.isPending || lostReason.trim().length === 0}
                      data-r10n-proposal-cta="lost"
                      className="flex-[2] flex items-center justify-center gap-2 px-3 py-2 bg-amber-600 text-white text-xs font-medium rounded-[7px] hover:bg-amber-700 transition-colors disabled:opacity-60"
                    >
                      <Ban className="w-3 h-3" />
                      {lostMutation.isPending ? "Saving…" : "Mark Lost"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Delete — admin only */}
          {isAdmin && (
            <div className="pt-1">
              {deleteStep === "idle" ? (
                <button
                  onClick={() => setDeleteStep("confirm")}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-destructive/70 border border-destructive/20 rounded-[7px] hover:border-destructive/50 hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Proposal
                </button>
              ) : (
                <div className="space-y-2 p-3 bg-destructive/5 border border-destructive/20 rounded-[8px]">
                  <p className="text-xs text-destructive font-medium text-center">
                    Permanently delete this proposal?
                  </p>
                  {deleteMutation.isError && (
                    <p className="text-[11px] text-destructive px-1">
                      {(deleteMutation.error as Error)?.message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setDeleteStep("idle"); deleteMutation.reset(); }}
                      className="flex-1 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate()}
                      disabled={deleteMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-destructive text-white text-xs font-medium rounded-[7px] hover:bg-destructive/90 transition-colors disabled:opacity-60"
                    >
                      <Trash2 className="w-3 h-3" />
                      {deleteMutation.isPending ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Download PDF — available for all non-draft proposals */}
          {proposal.status !== "draft" && (
            <a
              href={`/api/proposals/${proposal.id}/pdf`}
              download
              data-r10n-proposal-cta="ghost"
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download Agreement PDF
            </a>
          )}
        </div>
      </div>
    </>
  );
}
