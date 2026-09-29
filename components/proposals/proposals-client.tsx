"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Plus, Send, MessageSquare, Eye, Check, Loader2, Ban } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import { Avatar } from "@/components/ui/avatar";
import { ProposalStatusBadge } from "./proposal-status-badge";
import { ProposalCreateModal } from "./proposal-create-modal";
import { ProposalDetailSlideOver } from "./proposal-detail-slide-over";
import { EngagementCell, type EngagementSummary } from "./engagement";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { WON_STATUSES } from "@/lib/proposals/status";
import { CreditChip, type ProposalCredit, type TeamMember } from "@/components/proposals/credit-chip";
import { ProposalBulkBar } from "@/components/proposals/proposal-bulk-bar";

interface Instalment {
  id: string;
  instalmentNumber: number;
  amount: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
}

interface Proposal {
  id: string;
  token: string;
  title: string;
  type: string;
  contactName: string;
  contactEmail: string | null;
  ghlContactId: string;
  opportunityId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  status: string;
  totalAmount: number;
  currency: string;
  paymentStructure: string;
  hasDeposit: boolean;
  depositTotal: number | null;
  depositsPaidTotal: number;
  serviceDescription: string | null;
  stripeInvoiceId: string | null;
  sentAt: string | null;
  signedAt: string | null;
  paidAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  lostBy: string | null;
  createdAt: string;
  instalments: Instalment[];
  /** Who is credited as closer and setter (lib/proposals/credit.ts). Null if it could not load. */
  credit: ProposalCredit | null;
}

// "Active" (retainer running) and "Completed" (term finished) sit next to the states they relate
// to rather than at the end, so the strip still reads left-to-right as a lifecycle.
const STATUS_FILTERS = ["All", "Draft", "Sent", "Signed", "Active", "Partial", "Completed", "Paid", "Overdue", "Lost", "Archived"] as const;

function fmtDate(d: string | null, tz: string) {
  if (!d) return null;
  return format(toZonedDate(new Date(d), tz), "d MMM");
}

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * How much has actually been collected on a proposal so far, using only fields the
 * list already returns (no extra Stripe calls):
 *   - deposit deals: the deposit cash cleared (paid deposit instalments, reconciled from Stripe)
 *   - instalment projects: the sum of paid instalments
 *   - single / subscription: the whole amount once it flips to paid
 */
function paidSoFar(p: Proposal): number {
  const paidInstalments = (p.instalments ?? [])
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + i.amount, 0);
  if (p.hasDeposit) return Math.max(paidInstalments, p.depositsPaidTotal ?? 0);
  if (p.paymentStructure === "instalment") return paidInstalments;
  // WON_STATUSES, not just "paid": a spread retainer sits in "active" for most of its life and
  // would otherwise report $0 collected in the list.
  return WON_STATUSES.includes(p.status) || p.paidAt ? p.totalAmount : 0;
}


function TypeBadge({ type }: { type: string }) {
  return (
    <span
      data-r10n-proposal-type
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide",
        type === "management"
          ? "bg-indigo-50 text-indigo-700"
          : "bg-blue-50 text-blue-700"
      )}
    >
      {type === "management" ? "Management" : "Project"}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border">
      <td className="px-4 py-3" colSpan={8}>
        <div className="h-4 bg-muted/60 rounded animate-pulse w-full" />
      </td>
    </tr>
  );
}

function SelectCheckbox({
  checked,
  onChange,
  alwaysVisible,
}: {
  checked: boolean;
  onChange: () => void;
  alwaysVisible: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        "w-[15px] h-[15px] rounded-[3px] border flex items-center justify-center shrink-0 transition-all duration-100",
        checked
          ? "bg-primary border-primary"
          : "border-border hover:border-muted-foreground",
        alwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}
      aria-label={checked ? "Deselect" : "Select"}
    >
      {checked && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
    </button>
  );
}


function MarkAsLostModal({
  proposal,
  onClose,
  onLost,
}: {
  proposal: Proposal;
  onClose: () => void;
  onLost: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/lost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (res.ok) {
        onLost();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="absolute top-1/2 left-1/2 animate-scale-in w-full max-w-[420px] bg-card rounded-[12px] border border-border shadow-2xl p-6">
        <h3
          className="text-base font-bold text-foreground mb-1"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Mark as Lost
        </h3>
        <p className="text-sm text-muted-foreground mb-5">
          {proposal.contactName} · {new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: proposal.currency.toUpperCase(),
            maximumFractionDigits: 0,
          }).format(proposal.totalAmount)}
        </p>

        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
          Reason <span className="text-destructive">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why was this deal lost? (e.g. went with competitor, budget cut, no response...)"
          rows={3}
          autoFocus
          className={cn(
            "w-full text-sm px-3 py-2.5 border border-border rounded-[10px] bg-background text-foreground",
            "placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary",
            "resize-none transition-colors"
          )}
        />

        {proposal.stripeInvoiceId && (
          <p className="text-xs text-muted-foreground mt-2">
            Unpaid Stripe invoices will be voided automatically.
          </p>
        )}

        <div className="flex items-center justify-end gap-2.5 mt-5">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-foreground rounded-[8px] hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !reason.trim()}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-[8px] transition-all",
              reason.trim() && !saving
                ? "text-white bg-red-500 hover:bg-red-600"
                : "text-muted-foreground bg-muted cursor-not-allowed"
            )}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Ban className="w-3.5 h-3.5" />
            )}
            {saving ? "Marking..." : "Mark as Lost"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProposalsClient() {
  const tz = useUserTimezone();
  const [filter, setFilter] = useState<string>("All");
  const [creditOnly, setCreditOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [selectedSendStep, setSelectedSendStep] = useState<"idle" | "confirm">("idle");
  const [oppModal, setOppModal] = useState<{ opp: GHLOpportunity; stageName: string } | null>(null);
  const [oppLoading, setOppLoading] = useState<string | null>(null); // proposal.id being fetched

  // Mark as Lost
  const [lostTarget, setLostTarget] = useState<Proposal | null>(null);

  // Bulk selection
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  const toggleBulkSelect = useCallback((id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (ids: string[]) => {
      setBulkSelected((prev) => {
        const allSelected = ids.every((id) => prev.has(id));
        if (allSelected) return new Set();
        return new Set(ids);
      });
    },
    []
  );

  const clearBulkSelection = useCallback(() => setBulkSelected(new Set()), []);



  async function openOppModal(proposal: Proposal) {
    if (oppLoading) return;
    setOppLoading(proposal.id);
    try {
      // Prefer direct opportunityId lookup — fast and reliable
      if (proposal.opportunityId) {
        const res = await fetch(`/api/ghl/opportunities/${proposal.opportunityId}`);
        const opp = await res.json();
        if (opp?.id) {
          setOppModal({ opp, stageName: opp.pipelineStageId_name ?? "Unknown" });
          return;
        }
      }
      // Fall back to contact-based lookup
      const res = await fetch(
        `/api/ghl/contacts/${proposal.ghlContactId}/opportunity?name=${encodeURIComponent(proposal.contactName)}`
      );
      const json = await res.json();
      if (json.opportunity) {
        setOppModal({ opp: json.opportunity, stageName: json.stageName ?? "Unknown" });
      }
    } finally {
      setOppLoading(null);
    }
  }
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery<{ proposals: Proposal[]; team?: TeamMember[]; creditError?: string | null }>({
    queryKey: ["proposals"],
    queryFn: () => fetch("/api/proposals").then((r) => r.json()),
    staleTime: 30 * 1000,
  });

  const { data: tracking } = useQuery<{ summary: Record<string, EngagementSummary> }>({
    queryKey: ["proposals-tracking"],
    queryFn: () => fetch("/api/proposals/tracking-summary").then((r) => r.json()),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const { data: me } = useQuery<{ role: string }>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/me").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const isAdmin = me?.role === "admin";

  function openWithSend(proposal: Proposal) {
    setSelected(proposal);
    setSelectedSendStep("confirm");
  }

  const allProposals = data?.proposals ?? [];
  const team = data?.team ?? [];

  // CREDIT TO CONFIRM: deals that can earn (sent, not archived) whose closer or setter is still
  // only a suggestion. The admin's backlog, one click away.
  const needsCredit = (p: Proposal) => !!p.credit && !!p.sentAt && p.status !== "void" &&
    (p.credit.closer.suggested || p.credit.setter.mode === "suggested");
  const creditToConfirm = allProposals.filter(needsCredit).length;

  const byStatus = filter === "All"
    ? allProposals.filter((p) => p.status !== "draft" && p.status !== "void" && p.status !== "lost")
    : filter === "Archived"
    ? allProposals.filter((p) => p.status === "void")
    : filter === "Lost"
    ? allProposals.filter((p) => p.status === "lost")
    : allProposals.filter((p) => p.status.toLowerCase() === filter.toLowerCase());
  const filtered = creditOnly ? allProposals.filter(needsCredit) : byStatus;

  // Stats
  const counts = {
    sent: allProposals.filter((p) => p.status === "sent").length,
    signed: allProposals.filter((p) => p.status === "signed").length,
    partial: allProposals.filter((p) => p.status === "partial").length,
    // "active" and "past_due" are money-in-progress: still outstanding, not yet complete.
    active: allProposals.filter((p) => p.status === "active").length,
    // A completed 90-day term is collected in full, so it belongs with paid, not on its own line.
    paid: allProposals.filter((p) => ["paid", "completed"].includes(p.status)).length,
    outstanding: allProposals.filter((p) => ["sent", "signed", "partial", "active", "past_due"].includes(p.status)).length,
    overdue: allProposals.filter((p) => p.status === "overdue").length,
    lost: allProposals.filter((p) => p.status === "lost").length,
  };

  const isLoading = isPending && !data;

  return (
    <>
      <div className="flex flex-col h-full p-6 gap-5 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1
            data-r10n-proposal-title
            className="text-2xl font-bold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Proposals
          </h1>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-[7px] hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Proposal
          </button>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-0 text-sm border-b border-border pb-4">
          {[
            { label: "Sent", value: counts.sent },
            { label: "Signed", value: counts.signed },
            { label: "Partial", value: counts.partial },
            { label: "Paid", value: counts.paid },
            { label: "Outstanding", value: counts.outstanding },
            { label: "Overdue", value: counts.overdue },
            { label: "Lost", value: counts.lost },
          ].map((s, i) => (
            <div key={s.label} className={cn("flex items-center gap-3", i > 0 && "pl-4 border-l border-border ml-4")}>
              <span data-r10n-proposal-stat-label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {s.label}
              </span>
              <span data-r10n-proposal-stat-value className="text-xl font-bold text-foreground tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
                {s.value}
              </span>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 border-b border-border">
          {STATUS_FILTERS.map((f) => {
            const draftCount = f === "Draft" ? allProposals.filter((p) => p.status === "draft").length : 0;
            return (
            <button
              key={f}
              onClick={() => { setFilter(f); setCreditOnly(false); }}
              data-r10n-proposal-tab
              data-active={filter === f && !creditOnly}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
                filter === f && !creditOnly
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {f}
              {draftCount > 0 && (
                <span
                  data-r10n-proposal-tab-count
                  className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none tabular-nums",
                  filter === f
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground"
                )}>
                  {draftCount}
                </span>
              )}
            </button>
            );
          })}
          {isAdmin && (creditToConfirm > 0 || creditOnly) && (
            <button
              type="button"
              onClick={() => setCreditOnly((v) => !v)}
              aria-pressed={creditOnly}
              className={cn(
                "ml-auto mb-1 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                creditOnly ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              Credit to confirm
              <span className="tabular-nums">{creditToConfirm}</span>
            </button>
          )}
        </div>
        {data?.creditError && (
          <p role="alert" className="-mt-2 text-xs text-destructive">{data.creditError}. Closer and setter show as a dash until it loads.</p>
        )}

        {/* Table — shrink-0 so this flex child keeps its full height. Without it, the
            overflow-hidden here makes the item shrinkable, so flexbox squashes the table to
            fit the viewport and clips the lower rows instead of letting the page scroll. */}
        {/* Scrolls sideways rather than clipping: Closer and Setter added a column, and a money
            column cut off at the edge is worse than a scrollbar. */}
        <div data-r10n-proposal-table className="shrink-0 bg-card border border-border rounded-[10px] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr data-r10n-proposal-table-head className="border-b border-border group">
                <th className="w-10 pl-4 pr-0 py-2.5">
                  {filtered.length > 0 && (
                    <SelectCheckbox
                      checked={filtered.length > 0 && filtered.every((p) => bulkSelected.has(p.id))}
                      onChange={() => toggleSelectAll(filtered.map((p) => p.id))}
                      alwaysVisible={bulkSelected.size > 0}
                    />
                  )}
                </th>
                <th data-r10n-th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Client</th>
                <th data-r10n-th className="text-left px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Closer</th>
                <th data-r10n-th className="text-left px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Setter</th>
                <th data-r10n-th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Type</th>
                <th data-r10n-th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                <th data-r10n-th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sent</th>
                <th data-r10n-th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Signed</th>
                <th data-r10n-th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Paid</th>
                <th data-r10n-th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Activity</th>
                <th data-r10n-th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-16 text-center">
                    <FileText className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p data-r10n-proposal-empty-text className="text-sm text-muted-foreground">
                      {filter === "All"
                        ? allProposals.some((p) => p.status === "draft")
                          ? "No active proposals — check the Draft tab to finish and send."
                          : "No proposals yet. Create your first proposal to get started."
                        : `No ${filter.toLowerCase()} proposals.`}
                    </p>
                    {filter === "All" && !allProposals.some((p) => p.status === "draft") && (
                      <button
                        onClick={() => setShowCreate(true)}
                        data-r10n-proposal-empty-cta
                        className="mt-3 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        Create proposal
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((proposal) => {
                  const isRowSelected = bulkSelected.has(proposal.id);
                  return (
                  <tr
                    key={proposal.id}
                    onClick={() => { setSelected(proposal); setSelectedSendStep("idle"); }}
                    data-r10n-proposal-table-row
                    data-selected={isRowSelected}
                    className={cn(
                      "border-b border-border last:border-0 hover:bg-muted/30 transition-colors duration-100 cursor-pointer group",
                      isRowSelected && "bg-primary/[0.03]"
                    )}
                  >
                    <td className="w-10 pl-4 pr-0 py-3">
                      <SelectCheckbox
                        checked={isRowSelected}
                        onChange={() => toggleBulkSelect(proposal.id)}
                        alwaysVisible={isRowSelected}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={proposal.contactName} size={28} />
                        <div className="min-w-0">
                          <p data-r10n-proposal-name className="text-sm font-medium text-foreground truncate leading-tight">
                            {proposal.contactName}
                          </p>
                          {proposal.status === "lost" && proposal.lostReason ? (
                            <p data-r10n-proposal-sub data-tone="lost" className="text-xs text-red-500/70 truncate leading-tight" title={proposal.lostReason}>
                              Lost: {proposal.lostReason}
                            </p>
                          ) : proposal.contactEmail ? (
                            <p data-r10n-proposal-sub className="text-xs text-muted-foreground truncate leading-tight">
                              {proposal.contactEmail}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    {/* Credit, visible and editable right on the row (Jack, 2026-09-29). The chip
                        stops the row click, so changing it never opens the proposal. */}
                    <td className="px-2 py-3">
                      <CreditChip proposalId={proposal.id} clientName={proposal.contactName} field="closer"
                        credit={proposal.credit} team={team} isAdmin={isAdmin} paidAt={proposal.paidAt} compact />
                    </td>
                    <td className="px-2 py-3">
                      <CreditChip proposalId={proposal.id} clientName={proposal.contactName} field="setter"
                        credit={proposal.credit} team={team} isAdmin={isAdmin} paidAt={proposal.paidAt} compact />
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={proposal.type} />
                    </td>
                    <td className="px-4 py-3">
                      <ProposalStatusBadge status={proposal.status} management={proposal.type === "management"} />
                    </td>
                    <td data-r10n-proposal-cell-date className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {fmtDate(proposal.sentAt, tz) ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td data-r10n-proposal-cell-date className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {fmtDate(proposal.signedAt, tz) ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td data-r10n-proposal-cell-date className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {fmtDate(proposal.paidAt, tz) ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <EngagementCell summary={tracking?.summary[proposal.id]} />
                    </td>
                    <td data-r10n-proposal-amount className="px-4 py-3 text-right tabular-nums">
                      {(() => {
                        const paid = paidSoFar(proposal);
                        const total = proposal.totalAmount;
                        const pct = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0;
                        const full = paid > 0 && paid >= total;
                        return (
                          <div className="flex flex-col items-end gap-1">
                            {/* Value — the full deal amount */}
                            <span className="font-medium text-foreground/85 leading-none">
                              {fmtAmount(total, proposal.currency)}
                            </span>
                            {/* Paid so far — micro progress track + caption, colored by state */}
                            <div className="flex items-center gap-1.5">
                              <span
                                className="relative block h-1 w-10 rounded-full bg-foreground/10 overflow-hidden"
                                aria-hidden
                              >
                                <span
                                  className={cn(
                                    "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
                                    paid > 0 ? "bg-emerald-500" : "bg-transparent",
                                  )}
                                  style={{ width: `${pct}%` }}
                                />
                              </span>
                              <span
                                className={cn(
                                  "text-[10.5px] font-medium leading-none tabular-nums",
                                  paid > 0 ? "text-emerald-600" : "text-muted-foreground/45",
                                )}
                              >
                                {full
                                  ? "Paid"
                                  : `${fmtAmount(paid, proposal.currency)} paid`}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {proposal.status === "draft" && (
                          <button
                            title="Send proposal"
                            onClick={(e) => { e.stopPropagation(); openWithSend(proposal); }}
                            data-r10n-proposal-action="send"
                            className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          title="Message contact"
                          disabled={oppLoading === proposal.id}
                          onClick={(e) => { e.stopPropagation(); openOppModal(proposal); }}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                        >
                          <MessageSquare className={cn("w-3.5 h-3.5", oppLoading === proposal.id && "animate-pulse")} />
                        </button>
                        <button
                          title="View opportunity"
                          disabled={oppLoading === proposal.id}
                          onClick={(e) => { e.stopPropagation(); openOppModal(proposal); }}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                        >
                          <Eye className={cn("w-3.5 h-3.5", oppLoading === proposal.id && "animate-pulse")} />
                        </button>
                        {!["draft", "paid", "lost", "void"].includes(proposal.status) && (
                          <button
                            title="Mark as lost"
                            onClick={(e) => { e.stopPropagation(); setLostTarget(proposal); }}
                            data-r10n-proposal-action="lost"
                            className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <ProposalCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ["proposals"] });
            setShowCreate(false);
          }}
        />
      )}

      {selected && (
        <ProposalDetailSlideOver
          proposal={allProposals.find((p) => p.id === selected.id) ?? selected}
          onClose={() => { setSelected(null); setSelectedSendStep("idle"); }}
          onUpdated={() => queryClient.invalidateQueries({ queryKey: ["proposals"] })}
          onDeleted={() => { setSelected(null); setSelectedSendStep("idle"); }}
          isAdmin={isAdmin}
          initialSendStep={selectedSendStep}
          team={team}
        />
      )}

      {oppModal && (
        <OpportunityModal
          opportunity={oppModal.opp}
          stageName={oppModal.stageName}
          onClose={() => setOppModal(null)}
        />
      )}

      {/* Multi-select actions: the pipeline's bar (components/proposals/proposal-bulk-bar.tsx). */}
      {bulkSelected.size > 0 && (
        <ProposalBulkBar
          selected={allProposals.filter((p) => bulkSelected.has(p.id))}
          team={team}
          onClear={clearBulkSelection}
          isAdmin={isAdmin}
        />
      )}

      {/* Mark as Lost modal */}
      {lostTarget && (
        <MarkAsLostModal
          proposal={lostTarget}
          onClose={() => setLostTarget(null)}
          onLost={() => {
            setLostTarget(null);
            queryClient.invalidateQueries({ queryKey: ["proposals"] });
          }}
        />
      )}
    </>
  );
}
