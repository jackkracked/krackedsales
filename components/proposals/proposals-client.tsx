"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Plus, Send, MessageSquare, Eye, Trash2, Archive, X, Check, Loader2, Ban } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import { Avatar } from "@/components/ui/avatar";
import { ProposalStatusBadge } from "./proposal-status-badge";
import { ProposalCreateModal } from "./proposal-create-modal";
import { ProposalDetailSlideOver } from "./proposal-detail-slide-over";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";

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
}

const STATUS_FILTERS = ["All", "Draft", "Sent", "Signed", "Partial", "Paid", "Overdue", "Lost", "Archived"] as const;

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


function TypeBadge({ type }: { type: string }) {
  return (
    <span
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

function BulkDeleteConfirmModal({
  count,
  onConfirm,
  onCancel,
  isDeleting,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-fade-in"
        onClick={onCancel}
      />
      {/* Modal */}
      <div className="absolute top-1/2 left-1/2 animate-scale-in w-full max-w-[380px] bg-card rounded-[12px] border border-border shadow-2xl p-6">
        <h3
          className="text-base font-bold text-foreground mb-1.5"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Delete {count} proposal{count !== 1 ? "s" : ""}?
        </h3>
        <p className="text-sm text-muted-foreground mb-5">
          This cannot be undone. All associated instalments will also be removed.
        </p>
        <div className="flex items-center justify-end gap-2.5">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-foreground rounded-[8px] hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-[8px] transition-colors disabled:opacity-70"
          >
            {isDeleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
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
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [selectedSendStep, setSelectedSendStep] = useState<"idle" | "confirm">("idle");
  const [oppModal, setOppModal] = useState<{ opp: GHLOpportunity; stageName: string } | null>(null);
  const [oppLoading, setOppLoading] = useState<string | null>(null); // proposal.id being fetched

  // Mark as Lost
  const [lostTarget, setLostTarget] = useState<Proposal | null>(null);

  // Bulk selection
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  async function handleBulkDelete() {
    if (bulkSelected.size === 0) return;
    setIsDeleting(true);
    try {
      const results = await Promise.allSettled(
        Array.from(bulkSelected).map((id) =>
          fetch(`/api/proposals/${id}`, { method: "DELETE" })
        )
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      if (succeeded > 0) {
        queryClient.invalidateQueries({ queryKey: ["proposals"] });
      }
      setBulkSelected(new Set());
      setShowDeleteConfirm(false);
    } catch {
      // errors handled per-request via allSettled
    } finally {
      setIsDeleting(false);
    }
  }

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

  const { data, isPending } = useQuery<{ proposals: Proposal[] }>({
    queryKey: ["proposals"],
    queryFn: () => fetch("/api/proposals").then((r) => r.json()),
    staleTime: 30 * 1000,
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

  const filtered = filter === "All"
    ? allProposals.filter((p) => p.status !== "draft" && p.status !== "void" && p.status !== "lost")
    : filter === "Archived"
    ? allProposals.filter((p) => p.status === "void")
    : filter === "Lost"
    ? allProposals.filter((p) => p.status === "lost")
    : allProposals.filter((p) => p.status.toLowerCase() === filter.toLowerCase());

  // Stats
  const counts = {
    sent: allProposals.filter((p) => p.status === "sent").length,
    signed: allProposals.filter((p) => p.status === "signed").length,
    partial: allProposals.filter((p) => p.status === "partial").length,
    paid: allProposals.filter((p) => p.status === "paid").length,
    outstanding: allProposals.filter((p) => ["sent", "signed", "partial"].includes(p.status)).length,
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
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {s.label}
              </span>
              <span className="text-xl font-bold text-foreground tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
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
              onClick={() => setFilter(f)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
                filter === f
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {f}
              {draftCount > 0 && (
                <span className={cn(
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
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-[10px] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border group">
                <th className="w-10 pl-4 pr-0 py-2.5">
                  {filtered.length > 0 && (
                    <SelectCheckbox
                      checked={filtered.length > 0 && filtered.every((p) => bulkSelected.has(p.id))}
                      onChange={() => toggleSelectAll(filtered.map((p) => p.id))}
                      alwaysVisible={bulkSelected.size > 0}
                    />
                  )}
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Client</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rep</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Type</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sent</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Signed</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Paid</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center">
                    <FileText className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {filter === "All"
                        ? allProposals.some((p) => p.status === "draft")
                          ? "No active proposals — check the Draft tab to finish and send."
                          : "No proposals yet. Create your first proposal to get started."
                        : `No ${filter.toLowerCase()} proposals.`}
                    </p>
                    {filter === "All" && !allProposals.some((p) => p.status === "draft") && (
                      <button
                        onClick={() => setShowCreate(true)}
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
                          <p className="text-sm font-medium text-foreground truncate leading-tight">
                            {proposal.contactName}
                          </p>
                          {proposal.status === "lost" && proposal.lostReason ? (
                            <p className="text-xs text-red-500/70 truncate leading-tight" title={proposal.lostReason}>
                              Lost: {proposal.lostReason}
                            </p>
                          ) : proposal.contactEmail ? (
                            <p className="text-xs text-muted-foreground truncate leading-tight">
                              {proposal.contactEmail}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {proposal.createdByName ? (
                        <div className="flex items-center gap-1.5">
                          <Avatar name={proposal.createdByName} size={20} variant="rep" />
                          <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                            {proposal.createdByName.split(" ")[0]}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={proposal.type} />
                    </td>
                    <td className="px-4 py-3">
                      <ProposalStatusBadge status={proposal.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {fmtDate(proposal.sentAt, tz) ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {fmtDate(proposal.signedAt, tz) ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {fmtDate(proposal.paidAt, tz) ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground/80">
                      {fmtAmount(proposal.totalAmount, proposal.currency)}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {proposal.status === "draft" && (
                          <button
                            title="Send proposal"
                            onClick={(e) => { e.stopPropagation(); openWithSend(proposal); }}
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
        />
      )}

      {oppModal && (
        <OpportunityModal
          opportunity={oppModal.opp}
          stageName={oppModal.stageName}
          onClose={() => setOppModal(null)}
        />
      )}

      {/* Floating bulk action bar */}
      {bulkSelected.size > 0 && (
        <div className="fixed bottom-6 z-50 animate-slide-up-fade flex items-center gap-2.5 bg-card border border-border rounded-[10px] px-4 py-2.5 shadow-xl" style={{ left: "calc(50% + 6rem)", transform: "translateX(-50%)" }}>
          <span className="text-sm font-semibold text-foreground tabular-nums whitespace-nowrap">
            {bulkSelected.size} selected
          </span>
          <div className="w-px h-5 bg-border" />
          {isAdmin && (
            <>
              <button
                onClick={async () => {
                  const ids = [...bulkSelected];
                  await Promise.allSettled(ids.map(id =>
                    fetch(`/api/proposals/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "void" }) })
                  ));
                  clearBulkSelection();
                  queryClient.invalidateQueries({ queryKey: ["proposals"] });
                }}
                className="flex items-center gap-1.5 border border-border rounded-[7px] px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
                Archive
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 border border-red-200 bg-red-50 rounded-[7px] px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </>
          )}
          <button
            onClick={clearBulkSelection}
            className="p-1 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Deselect all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <BulkDeleteConfirmModal
          count={bulkSelected.size}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          isDeleting={isDeleting}
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
