"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import {
  FileText, FilePlus2, FileCheck2, Mail, CheckCircle2, XCircle, Ban,
  AlertTriangle, Repeat, Send, PenLine, ExternalLink, CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Kind =
  | "proposal_created" | "proposal_sent" | "proposal_signed" | "created" | "finalized"
  | "reminder" | "paid" | "failed" | "voided" | "uncollectible" | "subscription" | "subscription_cancelled";

interface BillingEvent {
  at: string;
  kind: Kind;
  label: string;
  amount?: number | null;
  currency?: string | null;
  invoiceNumber?: string | null;
  hostedUrl?: string | null;
  source: "app" | "stripe";
}
interface Summary {
  label: string;
  tone: "paid" | "pending" | "overdue" | "failed" | "none";
  amount?: number | null;
  currency?: string | null;
  hostedUrl?: string | null;
  dueDate?: string | null;
}

const KIND: Record<Kind, { icon: React.ElementType; tone: "success" | "destructive" | "primary" | "amber" | "muted" }> = {
  proposal_created: { icon: FileText, tone: "muted" },
  proposal_sent: { icon: Send, tone: "primary" },
  proposal_signed: { icon: PenLine, tone: "primary" },
  created: { icon: FilePlus2, tone: "muted" },
  finalized: { icon: FileCheck2, tone: "muted" },
  reminder: { icon: Mail, tone: "amber" },
  paid: { icon: CheckCircle2, tone: "success" },
  failed: { icon: XCircle, tone: "destructive" },
  voided: { icon: Ban, tone: "destructive" },
  uncollectible: { icon: AlertTriangle, tone: "destructive" },
  subscription: { icon: Repeat, tone: "primary" },
  subscription_cancelled: { icon: XCircle, tone: "destructive" },
};

const TONE_ICON: Record<string, string> = {
  success: "bg-success/10 text-success ring-success/20",
  destructive: "bg-destructive/10 text-destructive ring-destructive/20",
  primary: "bg-primary/10 text-primary ring-primary/20",
  amber: "bg-amber-500/10 text-amber-600 ring-amber-500/20",
  muted: "bg-muted text-muted-foreground ring-border",
};

function fmtMoney(v?: number | null, c?: string | null): string {
  if (v == null) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: (c ?? "usd").toUpperCase(), maximumFractionDigits: 0 }).format(v);
}

const SUMMARY_TONE: Record<Summary["tone"], string> = {
  paid: "bg-success/10 text-success",
  pending: "bg-primary/10 text-primary",
  overdue: "bg-destructive/10 text-destructive",
  failed: "bg-destructive/10 text-destructive",
  none: "bg-muted text-muted-foreground",
};

export function BillingActivity({ proposalId }: { proposalId: string }) {
  const { data, isLoading, isError } = useQuery<{ events: BillingEvent[]; summary: Summary }>({
    queryKey: ["billing-activity", proposalId],
    queryFn: async () => {
      const r = await fetch(`/api/proposals/${proposalId}/billing-activity`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 30_000,
    retry: false,
  });

  // Admin-only endpoint (403 for reps) — hide the whole section rather than show a misleading empty state.
  if (isError) return null;

  const events = data?.events ?? [];
  const summary = data?.summary;

  return (
    <div>
      {/* Header + live status */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
          <span data-r10n-proposal-section className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Billing activity</span>
        </div>
        {summary && summary.tone !== "none" && (
          <div className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", SUMMARY_TONE[summary.tone])}>
            <span>{summary.label}</span>
            {summary.amount != null && <span className="tabular-nums">{fmtMoney(summary.amount, summary.currency)}</span>}
            {summary.dueDate && summary.tone === "pending" && <span className="font-medium opacity-80">· due {format(new Date(summary.dueDate), "MMM d")}</span>}
          </div>
        )}
      </div>

      <div className="rounded-[10px] border border-border bg-card">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="h-3 flex-1 animate-pulse rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
            <CreditCard className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No billing activity yet.</p>
            <p className="text-[11px] text-muted-foreground/70">Invoices and payments appear here the moment they happen.</p>
          </div>
        ) : (
          <ul className="relative px-4 py-3.5">
            {/* connecting rail */}
            <span aria-hidden className="absolute left-[27px] top-[26px] bottom-[26px] w-px bg-border" />
            {events.map((e, i) => {
              const meta = KIND[e.kind] ?? KIND.created;
              const Icon = meta.icon;
              const when = new Date(e.at);
              return (
                <li key={i} className="relative flex gap-3 py-2 first:pt-0.5 last:pb-0.5">
                  <span className={cn("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1", TONE_ICON[meta.tone])}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pt-0.5">
                    <div className="min-w-0">
                      <p className="text-[13px] leading-snug text-foreground">
                        {e.label}
                        {e.hostedUrl && (
                          <a href={e.hostedUrl} target="_blank" rel="noopener noreferrer" title="Open invoice in Stripe"
                            className="ml-1 inline-flex translate-y-px text-muted-foreground/60 transition-colors hover:text-primary">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        <span title={format(when, "PPpp")}>{formatDistanceToNow(when, { addSuffix: true })}</span>
                        {e.invoiceNumber && <span className="text-muted-foreground/60"> · {e.invoiceNumber}</span>}
                      </p>
                    </div>
                    {e.amount != null && (
                      <span className={cn("shrink-0 text-[13px] font-bold tabular-nums", meta.tone === "success" ? "text-success" : meta.tone === "destructive" ? "text-destructive" : "text-foreground")}
                        style={{ fontFamily: "var(--font-heading)" }}>
                        {fmtMoney(e.amount, e.currency)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
