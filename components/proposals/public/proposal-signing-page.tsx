"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
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

// ─── Scope display ─────────────────────────────────────────────────────────────
// Parses the compileScope() output format into clean section headers + bullet lists

function ScopeDisplay({ text }: { text: string }) {
  const sections = text.split(/\n\n+/);
  return (
    <div className="mb-4 space-y-3">
      {sections.map((section, si) => {
        const lines = section.split("\n").filter(Boolean);
        if (!lines.length) return null;

        // Check if first line is a section header (ends with : and no bullet)
        const firstLine = lines[0];
        const isHeader = firstLine.endsWith(":") && !firstLine.startsWith("•");
        const header = isHeader ? firstLine.slice(0, -1) : null;
        const bodyLines = isHeader ? lines.slice(1) : lines;

        const bullets = bodyLines.filter((l) => l.startsWith("•") || l.startsWith("-") || l.startsWith("*"));
        const prose = bodyLines.filter((l) => !l.startsWith("•") && !l.startsWith("-") && !l.startsWith("*"));

        return (
          <div key={si}>
            {header && (
              <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-1.5">{header}</p>
            )}
            {bullets.length > 0 && (
              <ul className="space-y-0.5">
                {bullets.map((line, li) => (
                  <li key={li} className="flex items-baseline gap-2 text-sm text-foreground/80">
                    <span className="text-foreground/40 shrink-0">•</span>
                    <span>{line.replace(/^[•\-*]\s*/, "")}</span>
                  </li>
                ))}
              </ul>
            )}
            {prose.map((line, li) => (
              <p key={li} className="text-sm text-foreground/80 leading-relaxed">{line}</p>
            ))}
          </div>
        );
      })}
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
              Invoice via Stripe, Bank Transfer, or Zelle
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Legal section heading ─────────────────────────────────────────────────────

function LegalHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-bold text-foreground mt-5 mb-2">{children}</p>;
}

// ─── Additional scope pricing table ───────────────────────────────────────────

function AdditionalScopePricing({ isManagement }: { isManagement: boolean }) {
  const rows = isManagement
    ? [
        ["Campaign Emails", "$300 per email"],
        ["Flow Emails", "$300 per email"],
        ["Flow Email Edits", "$100 per email"],
        ["SMS", "$100 per SMS/MMS"],
        ["Pop-Up", "$150 per Pop-Up"],
      ]
    : [
        ["Flow Emails", "$300 per email"],
        ["SMS", "$100 per SMS/MMS"],
        ["Pop-Up", "$150 per Pop-Up"],
      ];

  return (
    <div className="my-4">
      <p className="text-sm text-foreground/80 leading-relaxed mb-3">
        {isManagement
          ? "If additional services are requested (e.g., extra campaigns, flow build-outs, or any other additional support), Kracked Retention will pro-rate based on the below table. If a service is not listed, a proposal via Slack or email will be sent upon request outlining the additional scope and cost. Upon written acceptance, work will be completed and prorated at the end of the month."
          : "Any services outside the agreed scope (e.g., Monthly Management, extra flows, or campaigns) will require a separate agreement mutually approved by both parties. If additional items are requested after the kick-off call, they will be pro-rated and invoiced separately per the pricing table below."}
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground">Additional Scope Pricing</th>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-right font-bold text-foreground w-40">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, cost]) => (
            <tr key={label}>
              <td className="border border-foreground/20 px-3 py-2 font-medium text-foreground">{label}</td>
              <td className="border border-foreground/20 px-3 py-2 text-right text-foreground/80">{cost}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Management legal terms ────────────────────────────────────────────────────

function ManagementTerms() {
  return (
    <div className="text-sm text-foreground/80 leading-relaxed">
      <p className="mb-3">
        Invoices will be issued monthly via Stripe, ACH, or Zelle, and payment is due upon receipt.
        Failure to complete payment within the agreed timeframe may result in a temporary pause of
        services until payment is received.
      </p>

      <AdditionalScopePricing isManagement={true} />

      <LegalHeading>Clarifications</LegalHeading>
      <p className="mb-2">
        <strong className="text-foreground">Flow Email Edit</strong> — A modification to an existing
        flow email that does not change the core strategy or structure. This includes copy revisions,
        minor design adjustments, formatting updates, or small content swaps where the original email
        framework remains intact.
      </p>
      <p className="mb-2">
        <strong className="text-foreground">New Flow Email</strong> — A newly created flow email that
        requires new strategy, messaging, or layout. This includes net new emails added to an existing
        flow, replacement emails built from scratch, or any email where the copy, design, or structure
        is materially different from an existing asset.
      </p>
      <p className="mb-4 text-foreground/60 italic">
        *If a request does not fit any of the above definitions, both parties will agree on a mutual rate.
      </p>

      <LegalHeading>Service Collaboration &amp; Cooperation</LegalHeading>
      <p className="mb-2">
        To maintain a fair and healthy long-term relationship, Kracked Retention reserves the right to
        temporarily pause services if cooperation or communication from the Client prevents effective
        service delivery. This pause will remain in effect until both parties reach a mutual resolution
        on how to proceed. Additionally, if payment for services is not made, Kracked Retention may
        suspend all active services until the agreed-upon payment is completed.
      </p>
      <p>
        Our goal is to maintain a positive, collaborative, and results-driven partnership to ensure
        successful outcomes across all managed brands.
      </p>

      <LegalHeading>Term &amp; Renewal</LegalHeading>
      <p className="mb-2">
        This Agreement operates on a month-to-month basis and will automatically renew unless terminated
        in accordance with the Pause &amp; Termination Policy. Services and billing will automatically
        renew monthly (every 30 Days) per the terms of this agreement.
      </p>
      <p>
        If the Client wishes to initiate any additional services during a billing month, a separate
        invoice will be issued based on the additional scope pricing as mutually agreed upon by both
        parties. This ensures seamless continuity across all planning, scheduling, and delivery efforts
        for the Client.
      </p>

      <LegalHeading>Pause &amp; Termination Policy</LegalHeading>
      <p className="mb-3">
        Kracked Retention&apos;s production cycle requires strategic planning, copywriting, and design to
        be completed up to 30 days ahead of implementation. Given that Kracked Retention operates on a
        proactive schedule and plans all campaigns and deliverables in advance, the Client agrees to the
        following terms regarding pauses or cancellations:
      </p>
      <ul className="list-disc pl-5 space-y-2 mb-3">
        <li>
          <strong className="text-foreground">Notice Requirement:</strong> If the Client wishes to pause
          or suspend services, a minimum of 30 days&apos; written notice must be provided to
          admin@krackedretention.com. This allows Kracked Retention to adjust campaign schedules,
          production timelines, and resources accordingly.
        </li>
        <li>
          <strong className="text-foreground">Work Completed in Advance:</strong> Because Kracked
          Retention begins preparing campaigns and creative assets ahead of schedule, any work that has
          already been completed or is in progress at the time of notice, as documented in internal
          project management tools, Figma files, or Slack communications, will remain billable and will
          be invoiced in full. These deliverables will be completed, implemented, or provided to the
          Client as part of the final closeout.
        </li>
        <li>
          <strong className="text-foreground">Final Closeout:</strong> Once all in-progress work has
          been completed and implemented, Kracked Retention will consider the client&apos;s account closed
          and inactive until a written request to resume services is made and mutually agreed upon.
        </li>
        <li>
          <strong className="text-foreground">No Immediate Termination:</strong> Pausing or canceling
          services without providing the required notice may result in outstanding invoices for work
          already planned or completed under the 30-day lookahead schedule.
        </li>
      </ul>
      <p>
        This policy ensures clarity and fairness regarding scheduling, deliverables, and billing for
        all parties involved.
      </p>

      <LegalHeading>Privacy &amp; Confidentiality</LegalHeading>
      <p className="mb-2">
        Both parties agree to maintain the confidentiality of all business information, data, and
        assets shared throughout the partnership.
      </p>
      <ul className="list-disc pl-5 space-y-2 mb-2">
        <li>Kracked Retention and Client agree to keep all confidential business information private and not disclose it to any third party.</li>
        <li>The final email assets, including copy and design, will be owned by the Client upon full payment.</li>
        <li>Kracked Retention will maintain necessary access to each brand&apos;s ESP and SMS platforms in addition to Shopify until all deliverables and payments are completed.</li>
        <li>If either party violates or shows intent to violate any agreements within this section, the non-violating party shall be entitled to injunctive relief to prevent further harm.</li>
        <li>You further agree that your participation is subject to our Privacy Policy and Terms of Use.</li>
      </ul>

      <LegalHeading>Terms of Sale</LegalHeading>
      <ul className="list-disc pl-5 space-y-2 mb-2">
        <li>You acknowledge that all sales are final and non-refundable. You waive any rights to charge back your purchase with your credit card processor, provided that the project is completed in a timely manner as agreed upon by both parties.</li>
        <li>If the Client wishes to cancel the services, they must provide written notice via email to admin@krackedretention.com or via Slack. Any outstanding balance for work completed up to the cancellation date remains due, unless the cancellation is due to an agreed-upon cause of incompletion, such as the Service Provider&apos;s inability to fulfill the agreed scope of work.</li>
        <li>Deliverables are measured by work planned and created, not by final deployment. Any campaign, message, or asset that is strategized, written, designed, or prepared during the billing period will be counted toward deliverable limits and billed accordingly, regardless of whether the Client elects to send, delay, or cancel deployment.</li>
        <li>This agreement applies only to the baseline services outlined in the scope of work. Any additional services, including extra email campaigns, SMS campaigns, or flows, will require mutual written agreement and will be invoiced separately.</li>
        <li>The Client retains sole ownership of all Customer Materials, including final assets created under this agreement, upon full payment.</li>
      </ul>

      <LegalHeading>Governing Law</LegalHeading>
      <ul className="list-disc pl-5 space-y-2">
        <li>This Agreement is governed by the laws of the State of Tennessee. All parties consent to the jurisdiction of Tennessee courts for dispute resolution and waive the right to a jury trial to the full extent allowable.</li>
        <li>This Agreement constitutes the entire understanding between the parties and supersedes all prior agreements, whether written or verbal. In the event any provision of this Agreement is held invalid or unenforceable, the remaining provisions shall remain in full force and effect. Time is of the essence in fulfilling all obligations under this Agreement.</li>
      </ul>
    </div>
  );
}

// ─── Project legal terms ───────────────────────────────────────────────────────

function ProjectTerms() {
  return (
    <div className="text-sm text-foreground/80 leading-relaxed">
      <AdditionalScopePricing isManagement={false} />

      <LegalHeading>Service Collaboration &amp; Cooperation</LegalHeading>
      <p className="mb-2">
        To fully experience and gain the most benefit from our services, you agree: In order to
        maintain a fair and healthy long-term relationship, we reserve the right to temporarily pause
        our services if you become uncooperative to the extent that it hampers our ability to provide
        effective service. This pause will remain in effect until we reach a mutual agreement on how to
        proceed. Additionally, if payment for our services is not made, we may also suspend all services
        until the agreed-upon payment is completed.
      </p>
      <p>
        Our goal is to maintain a positive, collaborative, and results-driven partnership to ensure a
        successful outcome for both parties.
      </p>

      <LegalHeading>Privacy &amp; Confidentiality</LegalHeading>
      <p className="mb-2">
        We respect your privacy and must insist that you respect the privacy of team members involved.
        Video calls and phone calls may be recorded for quality and training purposes. We respect your
        confidential and proprietary information, ideas, and plans.
      </p>
      <ul className="list-disc pl-5 space-y-2 mb-2">
        <li>Kracked Retention and Client agree to keep all confidential business information private and not disclose it to any third party.</li>
        <li>The final email assets, including copy and design, will be owned by the Client upon full payment.</li>
        <li>Kracked Retention must be granted access to the ESP (e.g., Klaviyo) until the project is completed and all outstanding payments are settled.</li>
        <li>If either party violates or shows intent to violate any agreements within this section, the non-violating party shall be entitled to injunctive relief to prevent further harm.</li>
        <li>If the Client chooses to cancel services, both parties must return all documents and materials containing Confidential Information, delete all such information from digital systems, and provide written certification of compliance.</li>
        <li>You further agree that your participation is subject to our Privacy Policy and Terms of Use.</li>
      </ul>

      <LegalHeading>Terms of Sale</LegalHeading>
      <ul className="list-disc pl-5 space-y-2 mb-2">
        <li>You acknowledge that all sales are final and non-refundable. You waive any rights to charge back your purchase with your credit card processor, provided that the project is completed in a timely manner as deemed by Kracked Retention.</li>
        <li>If the Client wishes to cancel the project before completion, they must provide written notice via email to admin@krackedretention.com. Any outstanding balance for work completed up to the cancellation date remains due, unless the cancellation is due to an agreed-upon cause of project incompletion, such as the Service Provider&apos;s inability to fulfill the agreed scope of work.</li>
        <li>Unlimited revisions apply only to refinements within the brand direction and strategy approved at kickoff. Any request that requires reworking or recreating email assets due to a material change in branding, positioning, tone, or creative direction is considered out of scope and will be billed separately, with fees and timelines agreed upon in writing before work begins.</li>
        <li><strong className="text-foreground">Revision:</strong> A minor adjustment to an existing email that does not alter the approved strategy, structure, or creative direction. Revisions include small copy edits, light visual tweaks, formatting adjustments, or clarification requests that build upon the originally approved concept without requiring rework of the email.</li>
        <li><strong className="text-foreground">Substantive Revision:</strong> Any change that materially alters the approved strategy, messaging, structure, or creative direction of an email. This includes requests driven by shifts in branding, tone, positioning, layout, or campaign objective, and any change that requires partial or full re-creation of copy, design, or implementation. Substantive revisions are treated as new scope and billed at $100 per email.</li>
        <li>This agreement applies only to the one-time setup project outlined in the scope of work. Any additional services, including ongoing monthly management, require a separate agreement.</li>
        <li>The Client retains sole ownership of all Customer Materials, including final email assets created under this agreement, upon full payment.</li>
        <li>This Agreement is governed by the laws of the State of Tennessee. All parties consent to the jurisdiction of Tennessee courts for dispute resolution and waive the right to a jury trial to the full extent allowable.</li>
        <li>This Agreement constitutes the entire understanding between the parties and supersedes all prior agreements, whether written or verbal. Time is of the essence in fulfilling all obligations under this Agreement.</li>
      </ul>
    </div>
  );
}

// ─── Acceptance body text (type-specific) ─────────────────────────────────────

function AcceptanceText({ isManagement }: { isManagement: boolean }) {
  if (isManagement) {
    return (
      <>
        <p className="text-sm text-foreground/80 leading-relaxed mb-2">
          The Client named below acknowledges and agrees to all terms outlined in this Statement of
          Work. Both parties confirm they have the authority to enter into this Agreement on behalf of
          their respective companies.
        </p>
        <p className="text-sm text-foreground/80 leading-relaxed mb-2">
          The Client authorizes Kracked Retention to issue invoices and collect payments for all
          services rendered under this Agreement, including any approved additional work or prorated
          amounts. The Client certifies that they are an authorized user of the provided payment method
          and agrees not to dispute charges that align with the terms of this Agreement.
        </p>
        <p className="text-sm text-foreground/80 leading-relaxed mb-2">
          In the event of a failed or delayed payment, Kracked Retention reserves the right to adjust
          the payment schedule, suspend services, or modify invoice amounts as necessary to recover any
          outstanding balance.
        </p>
        <p className="text-sm text-foreground/80 leading-relaxed mb-6">
          The Client represents and warrants that they are authorized to execute this Agreement and
          payment authorization and agrees to indemnify and hold harmless Kracked Retention, its
          affiliates, the bank, and any payment processors from all claims, damages, or losses arising
          from authorized transactions made pursuant to this Agreement.
        </p>
      </>
    );
  }
  return (
    <>
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
      <p className="text-sm text-foreground/80 leading-relaxed mb-2">
        In the event of a failed payment, the payment schedule and/or amounts may be adjusted to
        recover any outstanding balance.
      </p>
      <p className="text-sm text-foreground/80 leading-relaxed mb-6">
        The Client represents and warrants that they are authorized to execute this payment
        authorization and indemnifies Kracked Retention, the bank, and the payment processor from
        any claims, damages, or losses arising from authorized transactions under this agreement.
      </p>
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ProposalSigningPage({ token, preview = false }: { token: string; preview?: boolean }) {
  const [signed, setSigned] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [signerName, setSignerName] = useState("");
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

  // Initialise signerName once proposal data arrives
  useEffect(() => {
    if (data && "proposal" in data && !signerName) {
      setSignerName((data as { proposal: ProposalData }).proposal.contactName);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const signMutation = useMutation({
    mutationFn: async (signatureDataUrl: string) => {
      const proposal = (data as { proposal: ProposalData }).proposal;
      const res = await fetch(`/api/proposals/${proposal.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: signatureDataUrl, signerName: signerName.trim() || proposal.contactName }),
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
              <ScopeDisplay text={proposal.serviceDescription} />
            ) : (
              <ul className="text-sm text-foreground/80 leading-relaxed list-disc pl-6 mb-2 space-y-1">
                {isManagement ? (
                  <>
                    <li><strong>Email + SMS Marketing Management</strong> — Strategy, copywriting, design, and implementation of all campaigns, including campaign calendar planning, ideation, scheduling, and execution</li>
                    <li><strong>Optimization &amp; Reporting</strong> — Monthly reporting and quarterly flow deep dive presenting opportunities within your account</li>
                    <li><strong>Creative Delivery</strong> — All designs delivered within Miro for review</li>
                    <li><strong>Creative Assets</strong> — All designs available in Figma for future use</li>
                    <li><strong>Communication</strong> — Dedicated Slack channel and bi-weekly or monthly check-in calls with account strategist</li>
                  </>
                ) : (
                  <>
                    <li>Kick-off call &amp; project completion call</li>
                    <li>Strategy, copy, design, and implementation included</li>
                    <li>All designs delivered in Miro for review</li>
                    <li>All designs available in Figma for future use</li>
                  </>
                )}
              </ul>
            )}

            <DocDivider />

            {/* Pricing */}
            <PricingTable proposal={proposal} />

            <DocDivider />

            {/* Agreement terms (legal sections — hardcoded per type to match PDF agreements) */}
            {isManagement ? <ManagementTerms /> : <ProjectTerms />}

            <DocDivider />

            {/* Acceptance section */}
            <p className="text-sm font-bold text-foreground mb-3">Acceptance</p>
            <AcceptanceText isManagement={isManagement} />

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
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold shrink-0">Full Name:</span>
                    <input
                      type="text"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      disabled={isPreview || signed}
                      className="flex-1 min-w-0 border-0 border-b border-foreground/20 focus:border-foreground/60 bg-transparent text-sm text-foreground outline-none pb-0.5 transition-colors disabled:opacity-70 disabled:cursor-default"
                      placeholder="Full name"
                    />
                  </div>
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
