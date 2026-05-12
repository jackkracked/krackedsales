"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import { Pen, RefreshCw, Check, AlertTriangle, Clock, Shield, Download } from "lucide-react";
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
  contactEmail: string | null;
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
  agreementTerms: string;
}

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtDate(d: string | Date | null) {
  if (!d) return null;
  return format(new Date(d), "d MMM yyyy");
}

function fmtDateShort(d: string | Date | null) {
  if (!d) return null;
  return format(new Date(d), "MM/dd/yyyy");
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

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
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
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  }

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-border rounded-[6px] overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={480}
          height={100}
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
            <div className="flex items-center gap-2 text-muted-foreground/40">
              <Pen className="w-3.5 h-3.5" />
              <span className="text-sm">Draw your signature here</span>
            </div>
          </div>
        )}
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
          onClick={() => {
            if (!hasStroke || !canvasRef.current) return;
            onSign(canvasRef.current.toDataURL("image/png"));
          }}
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

// ─── Document divider (matches PDF black bars) ─────────────────────────────────

function DocDivider() {
  return <div className="h-3 bg-foreground rounded-sm my-6" />;
}

// ─── Pricing table ─────────────────────────────────────────────────────────────

function PricingTable({ proposal }: { proposal: ProposalData }) {
  const isManagement = proposal.type === "management";
  const totalLabel = isManagement
    ? `${fmtAmount(proposal.totalAmount, proposal.currency)}/mo`
    : fmtAmount(proposal.totalAmount, proposal.currency);

  const serviceLabel = isManagement
    ? "Kracked Retention Email + SMS Marketing Management"
    : (proposal.serviceDescription ?? "Project Services");

  return (
    <div className="my-6">
      <p className="text-sm font-bold text-foreground mb-1">Pricing</p>
      <p className="text-sm text-foreground/80 mb-3">
        All costs listed below are based on the scope and assumptions included in this Statement of Work.
      </p>

      {/* Main pricing table */}
      <table className="w-full border-collapse mb-4 text-sm">
        <thead>
          <tr>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground">
              {isManagement ? "Services" : "Project"}
            </th>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-right font-bold text-foreground w-32">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {proposal.paymentStructure === "instalment" ? (
            proposal.instalments
              .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
              .map((inst) => (
                <tr key={inst.id}>
                  <td className="border border-foreground/20 px-3 py-2 font-medium text-foreground">
                    {serviceLabel} — Instalment {inst.instalmentNumber} of {proposal.instalments.length}
                    <span className="text-foreground/60 font-normal ml-2">
                      (due {fmtDateShort(inst.dueDate)})
                    </span>
                  </td>
                  <td className="border border-foreground/20 px-3 py-2 text-right font-bold text-foreground">
                    {fmtAmount(inst.amount, proposal.currency)}
                  </td>
                </tr>
              ))
          ) : (
            <tr>
              <td className="border border-foreground/20 px-3 py-2 font-medium text-foreground">
                {serviceLabel}
              </td>
              <td className="border border-foreground/20 px-3 py-2 text-right font-bold text-foreground">
                {totalLabel}
              </td>
            </tr>
          )}
          <tr>
            <td className="border border-foreground/20 px-3 py-2 text-right font-bold text-foreground">Total:</td>
            <td className="border border-foreground/20 px-3 py-2 text-right font-bold text-foreground">
              {totalLabel}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Invoice date table */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground">
              Invoice Date
            </th>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground">
              Payment Options
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-foreground/20 px-3 py-2 font-medium text-foreground">
              {proposal.startDate ? fmtDateShort(proposal.startDate) : format(new Date(), "MM/dd/yyyy")}
            </td>
            <td className="border border-foreground/20 px-3 py-2 text-foreground/80">
              Invoice via Stripe
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ProposalSigningPage({ token, preview = false }: { token: string; preview?: boolean }) {
  const [signed, setSigned] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const today = format(new Date(), "MM/dd/yyyy");

  const { data, isLoading, isError } = useQuery<
    { preview?: boolean; proposal: ProposalData } | { status: string; title?: string }
  >({
    queryKey: ["public-proposal", token, preview],
    queryFn: () =>
      fetch(`/api/proposals/public/${token}${preview ? "?preview=1" : ""}`).then((r) => r.json()),
    staleTime: 60 * 1000,
    retry: false,
  });

  const signMutation = useMutation({
    mutationFn: async (signatureDataUrl: string) => {
      const proposal = (data as { proposal: ProposalData }).proposal;
      const res = await fetch(`/api/proposals/${proposal.id}/sign`, {
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
        // Small delay so the user sees the confirmation before redirect
        setTimeout(() => { window.location.href = hostedUrl; }, 1200);
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

  if ("status" in data && !("proposal" in data)) {
    const statusMap: Record<string, { title: string; message: string; color: "muted" | "green" | "amber" | "red"; icon: React.ElementType }> = {
      draft: { icon: Clock, title: "Not available yet", message: "This proposal isn't ready to be viewed yet.", color: "muted" },
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
    if (redirecting) {
      return (
        <StatusScreen
          icon={Check}
          title="Taking you to payment..."
          message="Your proposal is signed. Redirecting to your invoice now."
          color="green"
        />
      );
    }
    // Signed but no Stripe redirect — payment link will be sent manually
    return (
      <StatusScreen
        icon={Check}
        title="Proposal signed!"
        message="Thank you — your signed agreement has been received. You'll receive a payment link by email shortly."
        color="green"
      />
    );
  }

  const isPreview = preview || ("preview" in data && data.preview === true);
  const { proposal } = data as { proposal: ProposalData };
  const isManagement = proposal.type === "management";

  return (
    <div className="min-h-screen bg-[#f5f5f0]">
      {/* Preview banner */}
      {isPreview && (
        <div className="bg-primary text-primary-foreground px-6 py-2.5 flex items-center justify-center gap-3 text-sm font-medium print:hidden">
          <span className="px-2 py-0.5 bg-white/20 rounded text-xs font-bold tracking-wide uppercase">Preview</span>
          <span>This is how your client will see the proposal. Signing is disabled.</span>
        </div>
      )}

      {/* Expiry banner */}
      {proposal.expiresAt && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-end gap-2">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-xs text-amber-700 font-medium">
            Expires {fmtDate(proposal.expiresAt)}
          </span>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 lg:py-12">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-10 items-start">

          {/* ── Left: Full SOW document ── */}
          <div className="flex-1 min-w-0 bg-white shadow-sm border border-black/8 rounded-[4px] px-10 py-10 lg:py-12 print:shadow-none print:border-0 print:px-0">

            {/* Download PDF button — hidden in print */}
            <div className="flex justify-end mb-6 print:hidden">
              <a
                href={`/api/proposals/${proposal.id}/pdf`}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-[6px] hover:border-foreground/40 hover:text-foreground transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </a>
            </div>

            {/* Logo */}
            <div className="text-center mb-8">
              <div
                className="text-4xl font-black text-foreground leading-none tracking-tight"
                style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}
              >
                Kracked
              </div>
              <div
                className="text-[11px] font-bold tracking-[0.35em] text-foreground mt-0.5"
              >
                RETENTION
              </div>
            </div>

            {/* Document title */}
            <p className="text-sm font-bold text-foreground mb-4">
              Service Agreement and Statement of Work
            </p>

            <DocDivider />

            {/* Opening paragraph */}
            <p className="text-sm text-foreground/80 leading-relaxed mb-6">
              This {isManagement ? "Agreement" : "agreement"} is made between Kracked Retention{" "}
              {isManagement ? '("Service Provider")' : ""} and{" "}
              <strong>{proposal.contactName}</strong> (&ldquo;Client&rdquo;) and becomes effective upon the
              execution of this document or the commencement of services, whichever occurs first.
            </p>

            {/* Project Scope */}
            <p className="text-sm font-bold text-foreground mb-2">Project Scope</p>
            <p className="text-sm text-foreground/80 mb-3">
              Kracked Retention will fully manage and deliver the following
              {isManagement ? " services for the Client's brand" : ""}:
            </p>

            {proposal.serviceDescription ? (
              <div className="text-sm text-foreground/80 leading-relaxed mb-2 whitespace-pre-wrap pl-4 border-l-2 border-foreground/15">
                {proposal.serviceDescription}
              </div>
            ) : (
              <ul className="text-sm text-foreground/80 leading-relaxed list-disc pl-6 mb-2 space-y-1">
                {isManagement ? (
                  <>
                    <li><strong>Email + SMS Marketing Management</strong> — Strategy, copywriting, design, and implementation of all campaigns</li>
                    <li><strong>Campaign Calendar Planning</strong> — Monthly planning, ideation, strategy, scheduling, and execution</li>
                    <li><strong>Optimization &amp; Reporting</strong> — Monthly reporting and quarterly flow deep dives</li>
                    <li><strong>Creative Delivery</strong> — All designs delivered in Miro for review</li>
                    <li><strong>Communication</strong> — Dedicated Slack channel and bi-weekly/monthly check-in calls</li>
                  </>
                ) : (
                  <>
                    <li>Strategy, copy, design, and implementation included</li>
                    <li>All designs delivered in Miro for review</li>
                    <li>All designs available in Figma for future use</li>
                    <li>Kick-off call &amp; project completion call</li>
                  </>
                )}
              </ul>
            )}

            <DocDivider />

            {/* Pricing */}
            <PricingTable proposal={proposal} />

            <DocDivider />

            {/* Agreement terms (legal sections) */}
            <div className="text-sm text-foreground/80 leading-relaxed">
              <ReactMarkdown
                components={{
                  h2: ({ children }) => (
                    <h2 className="text-sm font-bold text-foreground mt-5 mb-1.5">{children}</h2>
                  ),
                  p: ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1.5 mb-3">{children}</ul>,
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  hr: () => <hr className="my-5 border-foreground/15" />,
                  table: ({ children }) => (
                    <table className="w-full border-collapse text-sm mb-4">{children}</table>
                  ),
                  thead: ({ children }) => <thead>{children}</thead>,
                  tbody: ({ children }) => <tbody>{children}</tbody>,
                  tr: ({ children }) => <tr>{children}</tr>,
                  th: ({ children }) => (
                    <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-foreground/20 px-3 py-2 text-foreground/80">
                      {children}
                    </td>
                  ),
                }}
              >
                {proposal.agreementTerms}
              </ReactMarkdown>
            </div>

            <DocDivider />

            {/* Acceptance section */}
            <p className="text-sm font-bold text-foreground mb-3">Acceptance</p>
            <p className="text-sm text-foreground/80 leading-relaxed mb-2">
              The Client named below acknowledges and agrees to the terms outlined in this Statement of
              Work. Both parties confirm they have the proper authority to enter into this agreement on
              behalf of their respective companies.
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed mb-2">
              The Client authorizes Kracked Retention to invoice for the agreed-upon purchase and payment
              plan. The Client certifies that they are an authorized user of the provided payment method
              and will not dispute the payment, provided it aligns with the terms of this agreement.
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed mb-6">
              The Client represents and warrants that they are authorized to execute this payment
              authorization and indemnifies Kracked Retention, the bank, and the payment processor from
              any claims, damages, or losses arising from authorized transactions under this agreement.
            </p>

            {/* Signature block */}
            <div className="grid grid-cols-2 gap-8 mt-6">
              {/* Kracked Retention side */}
              <div>
                <p className="text-xs font-bold text-foreground mb-3">Kracked Retention</p>
                <div className="space-y-2 text-sm text-foreground/80">
                  <p><span className="font-semibold">Company:</span> KRACKED RETENTION</p>
                  <p><span className="font-semibold">Title:</span> CEO</p>
                  <p><span className="font-semibold">Full Name:</span> GAGE FLESHER</p>
                </div>
                <div className="mt-4">
                  <p className="text-xs text-foreground/60 mb-1">Signature:</p>
                  <div className="border-b border-foreground/40 pb-4 mb-2">
                    <span
                      className="text-xl text-foreground/70 italic"
                      style={{ fontFamily: "Georgia, serif" }}
                    >
                      Gage Flesher
                    </span>
                  </div>
                  <p className="text-xs text-foreground/60">Date: {today}</p>
                </div>
              </div>

              {/* Client side */}
              <div>
                <p className="text-xs font-bold text-foreground mb-3">Client</p>
                <div className="space-y-2 text-sm text-foreground/80">
                  <p><span className="font-semibold">Full Name:</span> {proposal.contactName}</p>
                </div>
                <div className="mt-4">
                  <p className="text-xs text-foreground/60 mb-1">Signature:</p>
                  <div className="border-b border-foreground/40 pb-4 mb-2 min-h-[32px]">
                    <span className="text-xs text-foreground/40 italic">
                      Sign using the panel on the right
                    </span>
                  </div>
                  <p className="text-xs text-foreground/60">Date: {today}</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-10 pt-4 border-t border-foreground/15 flex items-center justify-between text-[11px] text-foreground/40">
              <span>&copy; 2026 Confidential and Proprietary</span>
              <span>Statement of Work</span>
              <span>Customer Service: admin@krackedretention.com</span>
            </div>
          </div>

          {/* ── Right: Sticky action panel ── */}
          <div className="lg:w-72 shrink-0 print:hidden">
            <div className="lg:sticky lg:top-8 space-y-3">
              <div className="bg-white border border-black/8 rounded-[8px] overflow-hidden shadow-sm">
                {/* Amount */}
                <div className="px-5 py-4 border-b border-border bg-muted/10">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                    {isManagement ? "Monthly Retainer" : "Project Investment"}
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

                {/* Payment schedule */}
                {proposal.paymentStructure === "instalment" && proposal.instalments.length > 0 && (
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Payment Schedule
                    </p>
                    <div className="space-y-1.5">
                      {proposal.instalments
                        .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
                        .map((inst) => (
                          <div key={inst.id} className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              {inst.instalmentNumber}. {fmtDate(inst.dueDate)}
                            </span>
                            <span className="text-xs font-medium text-foreground tabular-nums">
                              {fmtAmount(inst.amount, proposal.currency)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Sign section */}
                <div className="px-4 py-4">
                  <p className="text-xs font-semibold text-foreground mb-1">
                    Sign to accept &amp; proceed to payment
                  </p>
                  <p className="text-[11px] text-muted-foreground mb-3">
                    By signing you confirm you have read and agree to the terms in this agreement.
                  </p>

                  {signMutation.isError && (
                    <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200/50 rounded-[6px]">
                      <p className="text-xs text-red-600">Signing failed. Please try again.</p>
                    </div>
                  )}

                  {isPreview ? (
                    <div className="flex items-center justify-center py-6 border-2 border-dashed border-border rounded-[6px] text-xs text-muted-foreground">
                      Signature disabled in preview mode
                    </div>
                  ) : (
                    <SignatureCanvas
                      onSign={(dataUrl) => signMutation.mutate(dataUrl)}
                      disabled={signMutation.isPending}
                    />
                  )}
                </div>
              </div>

              {/* Trust signal */}
              <div className="flex items-start gap-2 px-3 py-2.5 bg-white border border-black/8 rounded-[8px]">
                <Shield className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground leading-tight">
                  Secured by 256-bit encryption. Your signature is legally binding under e-signature law.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
