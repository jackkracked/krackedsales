import React from "react";
import path from "path";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import { format } from "date-fns";

const LOGO_PATH = path.join(process.cwd(), "public", "kracked-logo.png");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstalmentForPdf {
  id: string;
  instalmentNumber: number;
  amount: number;
  dueDate: Date | string;
  status: string;
}

export interface ProposalForPdf {
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
  startDate: Date | string | null;
  endDate: Date | string | null;
  signedAt?: Date | string | null;
  instalments: InstalmentForPdf[];
  agreementTerms: string;
  signatureData?: string | null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1a1a1a",
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 56,
  },
  logoWrap: { alignItems: "center", marginBottom: 20 },
  logoImage: { width: 180, height: 48, objectFit: "contain" },
  divider: { height: 8, backgroundColor: "#1a1a1a", borderRadius: 1, marginVertical: 14 },
  docTitle: { fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 6 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 4, marginTop: 8 },
  body: { fontSize: 8.5, lineHeight: 1.55, color: "#333" },
  bodyMb: { fontSize: 8.5, lineHeight: 1.55, color: "#333", marginBottom: 5 },
  // Table
  tableWrap: { marginBottom: 10 },
  tableRow: { flexDirection: "row" },
  tableCellHead: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    backgroundColor: "#f0f0f0",
    paddingVertical: 4,
    paddingHorizontal: 6,
    flex: 1,
    borderWidth: 0.5,
    borderColor: "#ccc",
  },
  tableCellHeadR: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    backgroundColor: "#f0f0f0",
    paddingVertical: 4,
    paddingHorizontal: 6,
    width: 90,
    textAlign: "right",
    borderWidth: 0.5,
    borderColor: "#ccc",
  },
  tableCell: {
    fontSize: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    flex: 1,
    borderWidth: 0.5,
    borderColor: "#ddd",
  },
  tableCellR: {
    fontSize: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    width: 90,
    textAlign: "right",
    borderWidth: 0.5,
    borderColor: "#ddd",
  },
  tableCellBold: { fontFamily: "Helvetica-Bold" },
  // Sig block
  sigRow: { flexDirection: "row", gap: 28, marginTop: 16 },
  sigCol: { flex: 1 },
  sigColLabel: { fontFamily: "Helvetica-Bold", fontSize: 8, marginBottom: 6 },
  sigFieldLabel: { fontSize: 7, color: "#666", marginBottom: 2 },
  sigFieldValue: { fontSize: 8.5, color: "#333", marginBottom: 5 },
  sigLine: {
    borderBottomWidth: 0.5,
    borderColor: "#888",
    minHeight: 24,
    marginBottom: 3,
    paddingBottom: 2,
  },
  sigHandwritten: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 13,
    color: "#444",
  },
  sigDate: { fontSize: 7.5, color: "#666" },
  sigSigImage: { width: 120, height: 30, objectFit: "contain" },
  // Footer
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderColor: "#ccc",
    paddingTop: 8,
    marginTop: 20,
  },
  footerText: { fontSize: 7, color: "#aaa" },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmt(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "";
  try { return format(new Date(d), "MM/dd/yyyy"); } catch { return ""; }
}

// ─── Markdown → PDF renderer ──────────────────────────────────────────────────

type ParsedInline = string | { bold: string };

function parseInline(text: string): ParsedInline[] {
  const parts: ParsedInline[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ bold: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function InlineText({ text, baseStyle }: { text: string; baseStyle?: any }) {
  const parts = parseInline(text);
  if (parts.length === 1 && typeof parts[0] === "string") {
    return <Text style={baseStyle}>{text}</Text>;
  }
  return (
    <Text style={baseStyle}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : (
          <Text key={i} style={{ fontFamily: "Helvetica-Bold" }}>
            {p.bold}
          </Text>
        )
      )}
    </Text>
  );
}

function MarkdownSection({ content }: { content: string }) {
  const elements: React.ReactElement[] = [];
  const lines = content.split("\n");
  let key = 0;

  // Detect table block: consecutive lines starting with |
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      elements.push(<View key={key++} style={{ height: 4 }} />);
      i++;
      continue;
    }

    if (trimmed === "---") {
      elements.push(
        <View key={key++} style={{ height: 0.5, backgroundColor: "#d0d0d0", marginVertical: 8 }} />
      );
      i++;
      continue;
    }

    // Table block
    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const rows = tableLines.filter((l) => !l.replace(/\|/g, "").replace(/-/g, "").replace(/\s/g, "").length === false || !l.includes("---"));
      const nonSep = rows.filter((r) => !r.replace(/[|\-\s]/g, "").length === false && !r.replace(/\|/g, "").match(/^[\s\-]+$/));
      if (nonSep.length > 0) {
        elements.push(
          <View key={key++} style={s.tableWrap}>
            {nonSep.map((row, ri) => {
              const cells = row.slice(1, -1).split("|").map((c) => c.trim());
              const isHead = ri === 0;
              return (
                <View key={ri} style={s.tableRow}>
                  {cells.map((cell, ci) => (
                    <Text
                      key={ci}
                      style={
                        ci === 0
                          ? isHead ? s.tableCellHead : s.tableCell
                          : isHead ? s.tableCellHeadR : s.tableCellR
                      }
                    >
                      {cell}
                    </Text>
                  ))}
                </View>
              );
            })}
          </View>
        );
      }
      continue;
    }

    // Standalone bold line → section heading
    if (trimmed.startsWith("**") && trimmed.endsWith("**") && !trimmed.slice(2, -2).includes("**")) {
      const content = trimmed.slice(2, -2);
      elements.push(
        <Text key={key++} style={s.sectionTitle}>{content}</Text>
      );
      i++;
      continue;
    }

    // Bullet point
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ") || trimmed.startsWith("* ")) {
      const text = trimmed.slice(2);
      elements.push(
        <View key={key++} style={{ flexDirection: "row", paddingLeft: 10, marginBottom: 2 }}>
          <Text style={[s.body, { width: 10 }]}>{"•"}</Text>
          <InlineText text={text} baseStyle={[s.body, { flex: 1 }]} />
        </View>
      );
      i++;
      continue;
    }

    // Sub-bullet (starts with spaces then -)
    if (trimmed.startsWith("  - ") || trimmed.match(/^\s{2,}- /)) {
      const text = trimmed.replace(/^\s*- /, "");
      elements.push(
        <View key={key++} style={{ flexDirection: "row", paddingLeft: 22, marginBottom: 2 }}>
          <Text style={[s.body, { width: 10, color: "#555" }]}>{"–"}</Text>
          <InlineText text={text} baseStyle={[s.body, { flex: 1 }]} />
        </View>
      );
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <InlineText key={key++} text={trimmed} baseStyle={s.bodyMb} />
    );
    i++;
  }

  return <>{elements}</>;
}

// ─── Pricing Table ────────────────────────────────────────────────────────────

function PricingSection({ proposal }: { proposal: ProposalForPdf }) {
  const isManagement = proposal.type === "management";
  const totalLabel = isManagement
    ? `${fmtAmt(proposal.totalAmount, proposal.currency)}/mo`
    : fmtAmt(proposal.totalAmount, proposal.currency);

  const serviceLabel = isManagement
    ? "Kracked Retention Email + SMS Marketing Management"
    : (proposal.serviceDescription?.split("\n")[0] ?? "Project Services");

  const invoiceDate = proposal.startDate ? fmtDate(proposal.startDate) : fmtDate(new Date());

  return (
    <View>
      <Text style={s.sectionTitle}>Pricing</Text>
      <Text style={s.bodyMb}>
        All costs listed below are based on the scope and assumptions included in this Statement of Work.
      </Text>

      {/* Main table */}
      <View style={s.tableWrap}>
        <View style={s.tableRow}>
          <Text style={s.tableCellHead}>{isManagement ? "Services" : "Project"}</Text>
          <Text style={s.tableCellHeadR}>Cost</Text>
        </View>
        {proposal.paymentStructure === "instalment" ? (
          [...proposal.instalments]
            .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
            .map((inst) => (
              <View key={inst.id} style={s.tableRow}>
                <Text style={s.tableCell}>
                  {serviceLabel} — Instalment {inst.instalmentNumber} of {proposal.instalments.length}
                  {" "}(due {fmtDate(inst.dueDate)})
                </Text>
                <Text style={s.tableCellR}>{fmtAmt(inst.amount, proposal.currency)}</Text>
              </View>
            ))
        ) : (
          <View style={s.tableRow}>
            <Text style={s.tableCell}>{serviceLabel}</Text>
            <Text style={s.tableCellR}>{totalLabel}</Text>
          </View>
        )}
        <View style={s.tableRow}>
          <Text style={[s.tableCell, s.tableCellBold, { textAlign: "right" }]}>Total:</Text>
          <Text style={[s.tableCellR, s.tableCellBold]}>{totalLabel}</Text>
        </View>
      </View>

      {/* Invoice date table */}
      <View style={s.tableWrap}>
        <View style={s.tableRow}>
          <Text style={s.tableCellHead}>Invoice Date</Text>
          <Text style={s.tableCellHead}>Payment Options</Text>
        </View>
        <View style={s.tableRow}>
          <Text style={s.tableCell}>{invoiceDate}</Text>
          <Text style={s.tableCell}>Invoice via Stripe</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main Document ────────────────────────────────────────────────────────────

export function AgreementPdf({ proposal }: { proposal: ProposalForPdf }) {
  const isManagement = proposal.type === "management";
  const today = fmtDate(proposal.signedAt ?? new Date());

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {/* Logo */}
        <View style={s.logoWrap}>
          <Image src={LOGO_PATH} style={s.logoImage} />
        </View>

        <Text style={s.docTitle}>Service Agreement and Statement of Work</Text>

        <View style={s.divider} />

        {/* Opening */}
        <Text style={s.bodyMb}>
          This {isManagement ? "Agreement" : "agreement"} is made between Kracked Retention
          {isManagement ? ' ("Service Provider")' : ""} and {proposal.contactName} ("Client") and becomes
          effective upon the execution of this document or the commencement of services, whichever occurs first.
        </Text>

        {/* Scope */}
        <Text style={s.sectionTitle}>Project Scope</Text>
        <Text style={s.bodyMb}>
          Kracked Retention will fully manage and deliver the following
          {isManagement ? " services for the Client's brand" : ""}:
        </Text>

        {proposal.serviceDescription ? (
          <View style={{ paddingLeft: 10, borderLeftWidth: 1.5, borderColor: "#d0d0d0", marginBottom: 6 }}>
            <Text style={s.body}>{proposal.serviceDescription}</Text>
          </View>
        ) : (
          <View style={{ paddingLeft: 10, marginBottom: 6 }}>
            {isManagement ? (
              <>
                <Text style={s.bodyMb}>• Email + SMS Marketing Management — Strategy, copywriting, design, and implementation</Text>
                <Text style={s.bodyMb}>• Campaign Calendar Planning — Monthly planning, ideation, strategy, and execution</Text>
                <Text style={s.bodyMb}>• Optimization & Reporting — Monthly reporting and quarterly flow deep dives</Text>
                <Text style={s.bodyMb}>• Creative Delivery — All designs delivered in Miro for review</Text>
              </>
            ) : (
              <>
                <Text style={s.bodyMb}>• Strategy, copy, design, and implementation included</Text>
                <Text style={s.bodyMb}>• All designs delivered in Miro for review</Text>
                <Text style={s.bodyMb}>• All designs available in Figma for future use</Text>
                <Text style={s.bodyMb}>• Kick-off call & project completion call</Text>
              </>
            )}
          </View>
        )}

        <View style={s.divider} />

        <PricingSection proposal={proposal} />

        <View style={s.divider} />

        {/* Legal terms */}
        <MarkdownSection content={proposal.agreementTerms} />

        <View style={s.divider} />

        {/* Acceptance */}
        <Text style={s.sectionTitle}>Acceptance</Text>
        <Text style={s.bodyMb}>
          The Client named below acknowledges and agrees to the terms outlined in this Statement of Work.
          Both parties confirm they have the proper authority to enter into this agreement on behalf of
          their respective companies.
        </Text>
        <Text style={s.bodyMb}>
          The Client authorizes Kracked Retention to invoice for the agreed-upon purchase and payment plan.
          The Client certifies that they are an authorized user of the provided payment method and will not
          dispute the payment, provided it aligns with the terms of this agreement.
        </Text>
        <Text style={s.bodyMb}>
          The Client represents and warrants that they are authorized to execute this payment authorization
          and indemnifies Kracked Retention, the bank, and the payment processor from any claims, damages,
          or losses arising from authorized transactions under this agreement.
        </Text>

        {/* Signature block */}
        <View style={s.sigRow}>
          {/* Kracked side */}
          <View style={s.sigCol}>
            <Text style={s.sigColLabel}>Kracked Retention</Text>
            <Text style={s.sigFieldLabel}>Company:</Text>
            <Text style={s.sigFieldValue}>KRACKED RETENTION</Text>
            <Text style={s.sigFieldLabel}>Title:</Text>
            <Text style={s.sigFieldValue}>CEO</Text>
            <Text style={s.sigFieldLabel}>Full Name:</Text>
            <Text style={s.sigFieldValue}>GAGE FLESHER</Text>
            <Text style={s.sigFieldLabel}>Signature:</Text>
            <View style={s.sigLine}>
              <Text style={s.sigHandwritten}>Gage Flesher</Text>
            </View>
            <Text style={s.sigDate}>Date: {today}</Text>
          </View>

          {/* Client side */}
          <View style={s.sigCol}>
            <Text style={s.sigColLabel}>Client</Text>
            <Text style={s.sigFieldLabel}>Full Name:</Text>
            <Text style={s.sigFieldValue}>{proposal.contactName}</Text>
            <Text style={s.sigFieldLabel}>Signature:</Text>
            <View style={s.sigLine}>
              {proposal.signatureData ? (
                <Image src={proposal.signatureData} style={s.sigSigImage} />
              ) : (
                <Text style={[s.body, { color: "#999", fontFamily: "Helvetica-Oblique" }]}>
                  Not yet signed
                </Text>
              )}
            </View>
            <Text style={s.sigDate}>Date: {today}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>© 2026 Confidential and Proprietary</Text>
          <Text style={s.footerText}>Statement of Work</Text>
          <Text style={s.footerText}>admin@krackedretention.com</Text>
        </View>
      </Page>
    </Document>
  );
}
