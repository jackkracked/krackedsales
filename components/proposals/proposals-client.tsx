"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ProposalStatusBadge } from "./proposal-status-badge";
import { ProposalCreateModal } from "./proposal-create-modal";
import { ProposalDetailSlideOver } from "./proposal-detail-slide-over";

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
}

const STATUS_FILTERS = ["All", "Draft", "Sent", "Signed", "Paid", "Overdue"] as const;

function fmtDate(d: string | null) {
  if (!d) return null;
  return format(new Date(d), "d MMM");
}

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount);
}

function InitialsAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
      {initials || "?"}
    </div>
  );
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
      <td className="px-4 py-3" colSpan={7}>
        <div className="h-4 bg-muted/60 rounded animate-pulse w-full" />
      </td>
    </tr>
  );
}

export function ProposalsClient() {
  const [filter, setFilter] = useState<string>("All");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery<{ proposals: Proposal[] }>({
    queryKey: ["proposals"],
    queryFn: () => fetch("/api/proposals").then((r) => r.json()),
    staleTime: 30 * 1000,
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/proposals/${id}/send`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals"] }),
  });

  const allProposals = data?.proposals ?? [];

  const filtered = filter === "All"
    ? allProposals.filter((p) => p.status !== "draft")
    : allProposals.filter((p) => p.status.toLowerCase() === filter.toLowerCase());

  // Stats
  const counts = {
    sent: allProposals.filter((p) => p.status === "sent").length,
    signed: allProposals.filter((p) => p.status === "signed").length,
    paid: allProposals.filter((p) => p.status === "paid").length,
    outstanding: allProposals.filter((p) => ["sent", "signed"].includes(p.status)).length,
    overdue: allProposals.filter((p) => p.status === "overdue").length,
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
            { label: "Paid", value: counts.paid },
            { label: "Outstanding", value: counts.outstanding },
            { label: "Overdue", value: counts.overdue },
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
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Client</th>
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
                  <td colSpan={8} className="px-4 py-16 text-center">
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
                filtered.map((proposal) => (
                  <tr
                    key={proposal.id}
                    onClick={() => setSelected(proposal)}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <InitialsAvatar name={proposal.contactName} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate leading-tight">
                            {proposal.contactName}
                          </p>
                          {proposal.contactEmail && (
                            <p className="text-xs text-muted-foreground truncate leading-tight">
                              {proposal.contactEmail}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={proposal.type} />
                    </td>
                    <td className="px-4 py-3">
                      <ProposalStatusBadge status={proposal.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {fmtDate(proposal.sentAt) ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {fmtDate(proposal.signedAt) ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {fmtDate(proposal.paidAt) ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground/80">
                      {fmtAmount(proposal.totalAmount, proposal.currency)}
                    </td>
                    <td className="px-4 py-3">
                      {proposal.status === "draft" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            sendMutation.mutate(proposal.id);
                          }}
                          disabled={sendMutation.isPending}
                          className="text-xs font-medium px-2.5 py-1 rounded-[5px] bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                        >
                          Send
                        </button>
                      )}
                    </td>
                  </tr>
                ))
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
          onClose={() => setSelected(null)}
          onUpdated={() => queryClient.invalidateQueries({ queryKey: ["proposals"] })}
        />
      )}
    </>
  );
}
