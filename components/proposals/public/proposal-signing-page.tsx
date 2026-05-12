"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import { Pen, RefreshCw, Check, AlertTriangle, Clock, Shield } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Instalment {
  id: string;
  instalmentNumber: number;
  amount: number;
  dueDate: string;
  status: string;
}

interface ProposalData {
  id: string;
  title: string;
  type: string;
  contactName: string;
  totalAmount: number;
  currency: string;
  serviceDescription: string | null;
  paymentStructure: string;
  billingInterval: string | null;
  billingIntervalCount: number | null;
  startDate: string | null;
  endDate: string | null;
  expiresAt: string | null;
  status: string;
  instalments: Instalment[];
  agreementBody: string;
}

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtDate(d: string | null) {
  if (!d) return null;
  return format(new Date(d), "d MMM yyyy");
}

// ─── Signature Canvas ──────────────────────────────────────────────────────────

function SignatureCanvas({
  onSign,
  disabled,
}: {
  onSign: (dataUrl: string) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  function getPos(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvasRef.current!.width / rect.width),
      y: (e.clientY - rect.top) * (canvasRef.current!.height / rect.height),
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing(true);
    const pos = getPos(e);
    lastPos.current = pos;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1, 0, Math.PI * 2);
    ctx.fillStyle = "#0F3A5C";
    ctx.fill();
    setHasStroke(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing || !lastPos.current || disabled) return;
    const pos = getPos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#0F3A5C";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
  }

  function handlePointerUp() {
    setDrawing(false);
    lastPos.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  }

  function confirm() {
    if (!hasStroke || !canvasRef.current) return;
    onSign(canvasRef.current.toDataURL("image/png"));
  }

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-border rounded-[8px] overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={480}
          height={120}
          className={cn(
            "w-full touch-none select-none",
            disabled ? "opacity-40 cursor-not-allowed" : "cursor-crosshair"
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {!hasStroke && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 text-muted-foreground/50">
              <Pen className="w-4 h-4" />
              <span className="text-sm">Draw your signature here</span>
            </div>
          </div>
        )}
        <div className="absolute bottom-2 left-3 right-0 flex items-end">
          <div className="h-px flex-1 bg-border/60 max-w-[200px]" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={clear}
          disabled={!hasStroke || disabled}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <RefreshCw className="w-3 h-3" />
          Clear
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!hasStroke || disabled}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-[7px] transition-all",
            hasStroke && !disabled
              ? "bg-primary text-white hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          <Check className="w-3.5 h-3.5" />
          Sign &amp; Continue
        </button>
      </div>
    </div>
  );
}

// ─── Status screens ────────────────────────────────────────────────────────────

function StatusScreen({
  icon: Icon,
  title,
  message,
  color = "muted",
}: {
  icon: React.ElementType;
  title: string;
  message: string;
  color?: "muted" | "green" | "amber" | "red";
}) {
  const colorMap = {
    muted: "text-muted-foreground bg-muted",
    green: "text-green-600 bg-green-50",
    amber: "text-amber-600 bg-amber-50",
    red: "text-red-600 bg-red-50",
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="text-center max-w-xs">
        <div className={cn("w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4", colorMap[color])}>
          <Icon className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>{title}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ProposalSigningPage({ token }: { token: string }) {
  const [signed, setSigned] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  const { data, isLoading, isError } = useQuery<
    { proposal: ProposalData } | { status: string; title?: string }
  >({
    queryKey: ["public-proposal", token],
    queryFn: () => fetch(`/api/proposals/public/${token}`).then((r) => r.json()),
    staleTime: 60 * 1000,
    retry: false,
  });

  const signMutation = useMutation({
    mutationFn: async (signatureDataUrl: string) => {
      const res = await fetch(`/api/proposals/${(data as { proposal: ProposalData }).proposal.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: signatureDataUrl }),
      });
      if (!res.ok) throw new Error("Failed to sign");
      return res.json() as Promise<{ hostedUrl: string | null }>;
    },
    onSuccess: ({ hostedUrl }) => {
      setSigned(true);
      if (hostedUrl) {
        setRedirecting(true);
        setTimeout(() => {
          window.location.href = hostedUrl;
        }, 1500);
      }
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <StatusScreen
        icon={AlertTriangle}
        title="Proposal not found"
        message="This link may be invalid or has expired."
        color="red"
      />
    );
  }

  // Non-sent status responses
  if ("status" in data && !("proposal" in data)) {
    const statusMap: Record<string, { title: string; message: string; color: "muted" | "green" | "amber" | "red"; icon: React.ElementType }> = {
      draft: { icon: Clock, title: "Not available yet", message: "This proposal isn't ready to be viewed yet. Your contact will send it to you when it's ready.", color: "muted" },
      signed: { icon: Check, title: "Already signed", message: "This proposal has already been signed. Check your email for your invoice.", color: "green" },
      paid: { icon: Check, title: "Paid in full", message: "This proposal has been signed and paid. Thank you!", color: "green" },
      void: { icon: AlertTriangle, title: "Proposal voided", message: "This proposal is no longer active.", color: "muted" },
      failed: { icon: AlertTriangle, title: "Payment issue", message: "There was an issue with payment. Please contact us.", color: "red" },
      overdue: { icon: Clock, title: "Proposal overdue", message: "This proposal has passed its due date. Please contact us.", color: "amber" },
    };
    const s = statusMap[data.status] ?? { icon: AlertTriangle, title: "Unavailable", message: "This proposal is not currently available.", color: "muted" as const };
    return <StatusScreen icon={s.icon} title={s.title} message={s.message} color={s.color} />;
  }

  if (signed) {
    return (
      <StatusScreen
        icon={Check}
        title={redirecting ? "Redirecting to payment…" : "Proposal signed!"}
        message={
          redirecting
            ? "Taking you to the invoice now."
            : "Your proposal has been signed. You'll receive a copy by email."
        }
        color="green"
      />
    );
  }

  const { proposal } = data as { proposal: ProposalData };

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-[6px] bg-primary flex items-center justify-center">
            <span className="text-[10px] font-bold text-white">K</span>
          </div>
          <span className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Kracked Retention
          </span>
        </div>
        {proposal.expiresAt && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600">
            <Clock className="w-3.5 h-3.5" />
            Expires {fmtDate(proposal.expiresAt)}
          </div>
        )}
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 lg:py-12">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
          {/* Left: Agreement */}
          <div className="flex-1 min-w-0">
            <div className="mb-6">
              <h1
                className="text-2xl font-bold text-foreground mb-1"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {proposal.title}
              </h1>
              <p className="text-sm text-muted-foreground">
                Prepared for {proposal.contactName}
              </p>
            </div>

            {/* Service summary */}
            {proposal.serviceDescription && (
              <div className="mb-6 px-4 py-4 bg-card border border-border rounded-[10px]">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Scope of Services</p>
                <p className="text-sm text-foreground/80 leading-relaxed">{proposal.serviceDescription}</p>
              </div>
            )}

            {/* Agreement text */}
            <div className="prose prose-sm max-w-none text-foreground/80 leading-relaxed">
              <ReactMarkdown
                components={{
                  h2: ({ children }) => (
                    <h2 className="text-base font-bold text-foreground mt-6 mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-semibold text-foreground mt-4 mb-1">{children}</h3>
                  ),
                  p: ({ children }) => <p className="text-sm text-foreground/75 leading-relaxed mb-3">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-foreground/90">{children}</strong>,
                  ul: ({ children }) => <ul className="text-sm text-foreground/75 list-disc pl-4 space-y-1 mb-3">{children}</ul>,
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                }}
              >
                {proposal.agreementBody}
              </ReactMarkdown>
            </div>
          </div>

          {/* Right: Sticky action panel */}
          <div className="lg:w-80 shrink-0">
            <div className="lg:sticky lg:top-8 space-y-4">
              {/* Summary card */}
              <div className="bg-card border border-border rounded-[12px] overflow-hidden">
                <div className="px-5 py-4 border-b border-border bg-muted/20">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    {proposal.type === "management" ? "Monthly Retainer" : "Project Investment"}
                  </p>
                  <p
                    className="text-2xl font-bold text-foreground"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {fmtAmount(proposal.totalAmount, proposal.currency)}
                  </p>
                  {proposal.paymentStructure === "subscription" && proposal.billingInterval && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      per {proposal.billingIntervalCount && proposal.billingIntervalCount > 1
                        ? `${proposal.billingIntervalCount} ${proposal.billingInterval}s`
                        : proposal.billingInterval}
                    </p>
                  )}
                </div>

                {/* Instalment schedule */}
                {proposal.paymentStructure === "instalment" && proposal.instalments.length > 0 && (
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Payment Schedule</p>
                    <div className="space-y-1.5">
                      {proposal.instalments
                        .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
                        .map((inst) => (
                          <div key={inst.id} className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              Instalment {inst.instalmentNumber} — {fmtDate(inst.dueDate)}
                            </span>
                            <span className="text-xs font-medium text-foreground tabular-nums">
                              {fmtAmount(inst.amount, proposal.currency)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Dates */}
                {(proposal.startDate || proposal.endDate) && (
                  <div className="px-4 py-3 border-b border-border">
                    {proposal.startDate && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Start Date</span>
                        <span className="text-xs font-medium text-foreground">{fmtDate(proposal.startDate)}</span>
                      </div>
                    )}
                    {proposal.endDate && (
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">End Date</span>
                        <span className="text-xs font-medium text-foreground">{fmtDate(proposal.endDate)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Signature section */}
                <div className="px-4 py-4">
                  <p className="text-xs font-semibold text-foreground mb-3">
                    Sign to accept &amp; proceed to payment
                  </p>

                  {signMutation.isError && (
                    <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200/50 rounded-[6px]">
                      <p className="text-xs text-red-600">Signing failed. Please try again.</p>
                    </div>
                  )}

                  <SignatureCanvas
                    onSign={(dataUrl) => signMutation.mutate(dataUrl)}
                    disabled={signMutation.isPending}
                  />
                </div>
              </div>

              {/* Trust signals */}
              <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border/60 rounded-[8px]">
                <Shield className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <p className="text-[11px] text-muted-foreground leading-tight">
                  Secured by 256-bit encryption. Your signature is legally binding.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
