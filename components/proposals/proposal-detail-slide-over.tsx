"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, ExternalLink, Copy, Check, Send, Clock, CreditCard, Repeat, Download, Eye, Mail } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { ProposalStatusBadge } from "./proposal-status-badge";

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
  startDate?: string | null;
  expiresAt?: string | null;
}

interface ProposalDetailSlideOverProps {
  proposal: Proposal;
  onClose: () => void;
  onUpdated: () => void;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  return format(new Date(d), "d MMM yyyy");
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

function InstalmentBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    paid: "bg-green-50 text-green-700",
    failed: "bg-red-50 text-red-700",
    overdue: "bg-amber-50 text-amber-700",
  };
  return (
    <span className={cn(
      "inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide",
      styles[status] ?? "bg-muted text-muted-foreground"
    )}>
      {status}
    </span>
  );
}

export function ProposalDetailSlideOver({ proposal, onClose, onUpdated }: ProposalDetailSlideOverProps) {
  const [copied, setCopied] = useState(false);
  const [sendStep, setSendStep] = useState<"idle" | "confirm">("idle");
  const [sendEmail, setSendEmail] = useState(proposal.contactEmail ?? "");
  const queryClient = useQueryClient();

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
    onSuccess: () => {
      setSendStep("idle");
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      onUpdated();
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
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-card border-l border-border shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="min-w-0 pr-3">
            <div className="flex items-center gap-2 flex-wrap">
              <ProposalStatusBadge status={proposal.status} />
              <span
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
              className="mt-2 text-base font-semibold text-foreground truncate"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {proposal.contactName}
            </h2>
            {proposal.contactEmail && (
              <p className="text-xs text-muted-foreground">{proposal.contactEmail}</p>
            )}
            <a
              href={`https://app.gohighlevel.com/v2/location/qg7S6Yx9XxcRKUYZpjsi/contacts/detail/${proposal.ghlContactId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1 text-[11px] text-primary/70 hover:text-primary transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              View in GHL
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
          <div className="text-center py-4 px-4 bg-muted/30 rounded-[10px]">
            <p
              className="text-3xl font-bold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {fmtAmount(proposal.totalAmount, proposal.currency)}
            </p>
            {proposal.paymentStructure === "subscription" && proposal.billingInterval && (
              <p className="text-xs text-muted-foreground mt-1">
                per {proposal.billingIntervalCount && proposal.billingIntervalCount > 1
                  ? `${proposal.billingIntervalCount} ${proposal.billingInterval}s`
                  : proposal.billingInterval}
              </p>
            )}
            {proposal.paymentStructure === "instalment" && totalCount > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {paidCount}/{totalCount} instalments paid
              </p>
            )}
          </div>

          {/* Timeline dates */}
          <div className="grid grid-cols-3 gap-px bg-border rounded-[8px] overflow-hidden">
            {[
              { label: "Created", date: proposal.createdAt, icon: Clock },
              { label: "Sent", date: proposal.sentAt, icon: Send },
              { label: "Signed", date: proposal.signedAt, icon: Check },
            ].map(({ label, date, icon: Icon }) => (
              <div key={label} className="bg-card px-3 py-2.5 text-center">
                <Icon className="w-3 h-3 text-muted-foreground mx-auto mb-1" />
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
                <p className="text-xs font-medium text-foreground mt-0.5">
                  {fmtDate(date) ?? <span className="text-muted-foreground/50">—</span>}
                </p>
              </div>
            ))}
          </div>

          {/* Service description */}
          {proposal.serviceDescription && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Service</p>
              <ScopeDisplay text={proposal.serviceDescription} />
            </div>
          )}

          {/* Instalment table */}
          {proposal.paymentStructure === "instalment" && proposal.instalments.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Instalments
              </p>
              <div className="bg-muted/30 rounded-[8px] overflow-hidden border border-border/60">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">#</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Due</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposal.instalments
                      .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
                      .map((inst) => (
                        <tr key={inst.id} className="border-b border-border/40 last:border-0">
                          <td className="px-3 py-2 text-muted-foreground text-xs">{inst.instalmentNumber}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground/80 text-xs">
                            {fmtAmount(inst.amount, proposal.currency)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-xs tabular-nums">
                            {fmtDate(inst.dueDate)}
                          </td>
                          <td className="px-3 py-2">
                            <InstalmentBadge status={inst.status} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Subscription details */}
          {proposal.paymentStructure === "subscription" && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Billing
              </p>
              <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30 rounded-[8px] border border-border/60">
                <Repeat className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground/80">
                  {fmtAmount(proposal.totalAmount, proposal.currency)} every{" "}
                  {proposal.billingIntervalCount && proposal.billingIntervalCount > 1
                    ? `${proposal.billingIntervalCount} ${proposal.billingInterval}s`
                    : proposal.billingInterval}
                </span>
                {proposal.startDate && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    from {fmtDate(proposal.startDate)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Expiry */}
          {proposal.expiresAt && !["paid", "void"].includes(proposal.status) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200/50 rounded-[7px]">
              <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="text-xs text-amber-700 font-medium">
                Expires {fmtDate(proposal.expiresAt)}
              </span>
            </div>
          )}

          {/* Stripe link */}
          {proposal.stripeHostedUrl && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Payment Link
              </p>
              <a
                href={proposal.stripeHostedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2.5 bg-muted/30 border border-border/60 rounded-[8px] hover:bg-muted/50 transition-colors group"
              >
                <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
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
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Client Link
              </p>
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border border-border/60 rounded-[8px]">
                <span className="text-xs text-muted-foreground font-mono flex-1 truncate">
                  /p/{proposal.token.slice(0, 12)}…
                </span>
                <button
                  onClick={copyLink}
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
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Notes</p>
              <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">{proposal.notes}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-border shrink-0 space-y-2">
          {/* Preview — always available */}
          <a
            href={`/p/${proposal.token}?preview=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview Client View
          </a>

          {proposal.status === "draft" && (
            <div className="space-y-2">
              {/* Primary send button — slides out when confirm opens */}
              <div
                className="overflow-hidden transition-all duration-300 ease-out"
                style={{ maxHeight: sendStep === "idle" ? "52px" : "0px", opacity: sendStep === "idle" ? 1 : 0 }}
              >
                <button
                  onClick={() => { setSendEmail(proposal.contactEmail ?? ""); setSendStep("confirm"); }}
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
                    <p className="text-[11px] text-red-600 px-1">
                      {(sendMutation.error as Error)?.message ?? "Send failed"}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setSendStep("idle"); sendMutation.reset(); }}
                      className="flex-1 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:border-foreground/40 hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => sendMutation.mutate(sendEmail.trim() !== proposal.contactEmail ? sendEmail.trim() : undefined)}
                      disabled={sendMutation.isPending || !sendEmail.trim()}
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
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-[8px] hover:bg-green-700 transition-colors"
            >
              <CreditCard className="w-3.5 h-3.5" />
              View Stripe Invoice
            </a>
          )}

          {proposal.status === "sent" && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              Waiting for client signature
            </div>
          )}

          {proposal.status === "paid" && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-green-600 font-medium">
              <Check className="w-3.5 h-3.5" />
              {fmtDate(proposal.paidAt) ? `Paid on ${fmtDate(proposal.paidAt)}` : "Paid in full"}
            </div>
          )}

          {/* Download PDF — available for all non-draft proposals */}
          {proposal.status !== "draft" && (
            <a
              href={`/api/proposals/${proposal.id}/pdf`}
              download
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
