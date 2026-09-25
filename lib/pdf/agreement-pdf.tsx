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
import { priceSuffix, discountInfo, discountSentence, clientSentence, fullTermTotal, termMultiplier, managementSchedule, billingAnchor, fmtDay, type BillingTerms } from "@/lib/proposals/billing";
import type { Deliverables, DeliverableGroup } from "@/lib/proposals/content";

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
  autoRenew?: boolean | null;
  listAmount?: number | null;
  discountType?: string | null;
  discountValue?: number | null;
  // "recurring" | "first_payment" | "total" — decides whether the discount repeats. Without it
  // a once-off discount reads as recurring and the document prints the wrong money.
  discountScope?: string | null;
  startDate: Date | string | null;
  // 90-Day Management billing display fields.
  managementOption?: string | null;
  autoRebillMode?: string | null;
  firstPaymentSplit?: Array<{ amount: number; offsetDays?: number }> | null;
  contractStartAt?: Date | string | null;
  // Frozen schedule for an already-sent proposal; rendered verbatim when present.
  scheduleSnapshot?: Array<{ label: string; when: string; amount: number }> | null;
  endDate: Date | string | null;
  signedAt?: Date | string | null;
  instalments: InstalmentForPdf[];
  agreementTerms: string;
  signatureData?: string | null;
  // Structured, line-by-line deliverables (package/builder). When present + populated they
  // replace the legacy serviceDescription block in the scope section. Legacy proposals leave
  // this null and render exactly as before.
  deliverables?: Deliverables | null;
  // Optional per-proposal acceptance copy (markdown). Falls back to the hardcoded block below.
  acceptance?: string | null;
  // Per-proposal scope prose (markdown) — the edited "Project Scope" section shown on the web.
  // When present it IS the scope (heading + intro + bullets); the PDF renders it verbatim so the
  // download matches the on-screen proposal. Falls back to the hardcoded scope when absent.
  scopeIntro?: string | null;
  // Pricing-table service label (from content). Falls back to the derived label.
  serviceLabel?: string | null;
}

// Group ordering + labels, mirrored from the web signing page (DELIVERABLE_GROUPS).
const DELIVERABLE_GROUPS: { key: DeliverableGroup; label: string }[] = [
  { key: "included", label: "Included" },
  { key: "exclusive", label: "Exclusive to your plan" },
  { key: "custom", label: "Additional" },
];

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
  // Structured deliverables
  dlvCountRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  dlvCountStat: {
    flexDirection: "row",
    alignItems: "baseline",
    borderWidth: 0.5,
    borderColor: "#dcdcdc",
    backgroundColor: "#fafafa",
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  dlvCountValue: { fontFamily: "Helvetica-Bold", fontSize: 10, color: "#1a1a1a", marginRight: 4 },
  dlvCountLabel: { fontSize: 8, color: "#666" },
  dlvGroup: { marginBottom: 7 },
  dlvGroupLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    letterSpacing: 0.5,
    color: "#8a8a8a",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  dlvItemRow: { flexDirection: "row", marginBottom: 3 },
  dlvGlyph: { fontSize: 8.5, color: "#7a7a7a", width: 11, lineHeight: 1.5 },
  dlvItemLabel: { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: "#1a1a1a", lineHeight: 1.5 },
  dlvItemDetail: { fontSize: 8.5, color: "#777", lineHeight: 1.5 },
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

// ─── Structured Deliverables ──────────────────────────────────────────────────

/** True when there is at least one line-item to render. Count-only deliverables (no items)
 *  still fall back to serviceDescription, matching the web (which gates on items.length). */
function hasDeliverableItems(d?: Deliverables | null): d is Deliverables {
  return !!d && Array.isArray(d.items) && d.items.length > 0;
}

function DeliverablesSection({ deliverables }: { deliverables: Deliverables }) {
  const emails = deliverables.emails ?? 0;
  const popUps = deliverables.popUps ?? 0;
  const hasCounts = emails > 0 || popUps > 0;

  const populated = DELIVERABLE_GROUPS.map((g) => ({
    ...g,
    items: deliverables.items
      .filter((i) => i.group === g.key)
      .sort((a, b) => a.order - b.order),
  })).filter((g) => g.items.length > 0);

  // Only label the groups when more than one is present, same rule as the web.
  const showLabels = populated.length > 1;

  return (
    <View style={{ marginBottom: 6 }}>
      {hasCounts && (
        <View style={s.dlvCountRow}>
          {emails > 0 && (
            <View style={s.dlvCountStat}>
              <Text style={s.dlvCountValue}>{emails}</Text>
              <Text style={s.dlvCountLabel}>
                {emails === 1 ? "Email campaign / flow" : "Email campaigns + flows"}
              </Text>
            </View>
          )}
          {popUps > 0 && (
            <View style={s.dlvCountStat}>
              <Text style={s.dlvCountValue}>{popUps}</Text>
              <Text style={s.dlvCountLabel}>
                {popUps === 1 ? "Pop-up redesign" : "Pop-up redesigns"}
              </Text>
            </View>
          )}
        </View>
      )}

      {populated.map((g) => (
        <View key={g.key} style={s.dlvGroup}>
          {showLabels && <Text style={s.dlvGroupLabel}>{g.label}</Text>}
          {g.items.map((it) => (
            <View key={it.id} style={s.dlvItemRow}>
              <Text style={s.dlvGlyph}>{"✓"}</Text>
              <Text style={{ flex: 1 }}>
                <Text style={s.dlvItemLabel}>{it.label}</Text>
                {it.detail ? <Text style={s.dlvItemDetail}>{` — ${it.detail}`}</Text> : null}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── Pricing Table ────────────────────────────────────────────────────────────

function PricingSection({ proposal }: { proposal: ProposalForPdf }) {
  const isManagement = proposal.type === "management";
  // Model-accurate suffix (never a hard-coded "/mo") + discount, from the shared helper.
  const terms = proposal as BillingTerms;
  const suffix = priceSuffix(terms);
  const disc = discountInfo(terms);
  // One shared sentence for web + PDF, so the client cannot read two different explanations.
  const discSentence = discountSentence(terms, (n) => fmtAmt(n, proposal.currency));
  // 90-Day Management leads with the full 90-day total (monthly × 3); mult is 1 for everything else.
  const mult = termMultiplier(terms);
  const totalLabel = `${fmtAmt(fullTermTotal(terms), proposal.currency)}${suffix}`;
  const mgmtSchedule = managementSchedule(terms);

  const serviceLabel = proposal.serviceLabel?.trim()
    ? proposal.serviceLabel
    : isManagement
      ? "Kracked Retention Email + SMS Marketing Management"
      : (proposal.serviceDescription?.split("\n")[0] ?? "Project Services");

  // fmtDay (UTC, "10 Aug 2026") not fmtDate: fmtDate renders in the SERVER's local zone and in
  // MM/DD/YYYY, so the same proposal could print a different day here than in the schedule
  // above, and "08/10/2026" reads as 8 October to anyone outside the US. Same anchor as the
  // sentence and the schedule.
  const invoiceDate = fmtDay(billingAnchor(terms)) ?? fmtDay(new Date()) ?? "";

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

      {discSentence && <Text style={s.bodyMb}>{discSentence}</Text>}
      {isManagement && (
        <Text style={s.bodyMb}>{clientSentence(terms)}</Text>
      )}

      {/* 90-Day Management payment schedule (spread) — mirrors the project instalment breakdown */}
      {mgmtSchedule && mgmtSchedule.length > 0 && (
        <View style={s.tableWrap}>
          <View style={s.tableRow}>
            <Text style={s.tableCellHead}>Payment Schedule</Text>
            <Text style={s.tableCellHead}>Date</Text>
            <Text style={s.tableCellHeadR}>Amount</Text>
          </View>
          {mgmtSchedule.map((row, i) => (
            <View key={i} style={s.tableRow}>
              <Text style={s.tableCell}>{row.label}</Text>
              <Text style={s.tableCell}>{row.when}</Text>
              <Text style={s.tableCellR}>{fmtAmt(row.amount, proposal.currency)}</Text>
            </View>
          ))}
        </View>
      )}

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

        {/* Scope — prefer the per-proposal edited scope (content.scopeIntro), rendered verbatim so
            the download matches the on-screen proposal. Only legacy proposals with no scope prose
            fall back to the hardcoded heading + intro + default bullets. */}
        {proposal.scopeIntro && proposal.scopeIntro.trim() ? (
          <MarkdownSection content={proposal.scopeIntro} />
        ) : (
          <>
            <Text style={s.sectionTitle}>Project Scope</Text>
            <Text style={s.bodyMb}>
              Kracked Retention will fully manage and deliver the following
              {isManagement ? " services for the Client's brand" : ""}:
            </Text>
            {!hasDeliverableItems(proposal.deliverables) && (
              proposal.serviceDescription ? (
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
              )
            )}
          </>
        )}

        {/* Structured, line-by-line deliverables (counts + grouped items) — shown when populated,
            supplementing the scope prose (e.g. package proposals). */}
        {hasDeliverableItems(proposal.deliverables) && (
          <View style={{ paddingLeft: 10, marginBottom: 6 }}>
            <DeliverablesSection deliverables={proposal.deliverables} />
          </View>
        )}

        <View style={s.divider} />

        <PricingSection proposal={proposal} />

        <View style={s.divider} />

        {/* Legal terms */}
        <MarkdownSection content={proposal.agreementTerms} />

        <View style={s.divider} />

        {/* Acceptance — prefer per-proposal content copy (markdown), else the legacy block. */}
        {proposal.acceptance ? (
          <MarkdownSection content={proposal.acceptance} />
        ) : (
          <>
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
          </>
        )}

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
