"use client";

import { pdf } from "@react-pdf/renderer";
import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from "@react-pdf/renderer";
import { format } from "date-fns";
import type { CallPrepSections } from "@/lib/call-prep/types";

// ─── Styles ──────────────────────────────────────────────────────────────────

const NAVY = "#0F3A5C";
const GOLD = "#D4A574";
const TEXT = "#1C2333";
const MUTED = "#6E6A64";
const BG = "#FAFAF7";

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: TEXT,
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 48,
    backgroundColor: "#FFFFFF",
  },
  // Header
  headerBar: {
    backgroundColor: NAVY,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 6,
    marginBottom: 20,
  },
  headerCallType: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: GOLD,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  headerName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    color: "#FFFFFF",
    marginBottom: 2,
  },
  headerTime: {
    fontSize: 9,
    color: "#FFFFFF",
    opacity: 0.7,
  },
  // Section
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    marginTop: 18,
  },
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: MUTED,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  sectionDivider: {
    height: 1,
    backgroundColor: "#E5E2DD",
    marginTop: 2,
    marginBottom: 10,
    flex: 1,
    marginLeft: 8,
  },
  // Content
  body: {
    fontSize: 9.5,
    lineHeight: 1.6,
    color: TEXT,
  },
  bodyMuted: {
    fontSize: 9,
    lineHeight: 1.5,
    color: MUTED,
  },
  bold: {
    fontFamily: "Helvetica-Bold",
  },
  agendaItem: {
    flexDirection: "row",
    marginBottom: 4,
    gap: 6,
  },
  agendaNumber: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: NAVY,
    width: 16,
    textAlign: "right",
  },
  qualGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  qualCell: {
    width: "45%",
    marginBottom: 6,
  },
  qualLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: MUTED,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  objectionBlock: {
    marginBottom: 10,
  },
  objectionQ: {
    fontFamily: "Helvetica-BoldOblique",
    fontSize: 9.5,
    color: TEXT,
    marginBottom: 2,
  },
  objectionA: {
    fontSize: 9,
    color: MUTED,
    paddingLeft: 8,
    lineHeight: 1.5,
  },
  messageBadge: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    color: MUTED,
    backgroundColor: BG,
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 2,
    marginRight: 6,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerText: {
    fontSize: 7.5,
    color: MUTED,
  },
});

// ─── PDF Document ────────────────────────────────────────────────────────────

interface PdfProps {
  contactName: string;
  callType: "intro" | "follow_up";
  sections: CallPrepSections;
  generatedAt: string | null;
}

function CallPrepPdfDocument({
  contactName,
  callType,
  sections,
  generatedAt,
}: PdfProps) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header bar */}
        <View style={s.headerBar}>
          <Text style={s.headerCallType}>
            {callType === "intro" ? "Intro Call Prep" : "Follow-up Call Prep"}
          </Text>
          <Text style={s.headerName}>{contactName}</Text>
          {generatedAt && (
            <Text style={s.headerTime}>
              Generated {format(new Date(generatedAt), "d MMM yyyy, h:mm a")}
            </Text>
          )}
        </View>

        {/* Executive Summary */}
        <SectionHeading title="Executive Summary" />
        <Text style={s.body}>{sections.executiveSummary}</Text>

        {/* Call Agenda */}
        <SectionHeading title="Call Agenda" />
        {sections.callAgenda.map((item, i) => (
          <View key={i} style={s.agendaItem}>
            <Text style={s.agendaNumber}>{i + 1}.</Text>
            <Text style={[s.body, { flex: 1 }]}>{item}</Text>
          </View>
        ))}

        {/* Brand Research */}
        {sections.brandResearch && (
          <>
            <SectionHeading title="Brand Research" />
            <Text style={[s.qualLabel, { marginBottom: 1 }]}>What they do</Text>
            <Text style={[s.body, { marginBottom: 6 }]}>
              {sections.brandResearch.summary}
            </Text>
            <Text style={[s.qualLabel, { marginBottom: 1 }]}>Their audience</Text>
            <Text style={[s.body, { marginBottom: 6 }]}>
              {sections.brandResearch.audience}
            </Text>
            <Text style={[s.qualLabel, { marginBottom: 1 }]}>
              Current marketing
            </Text>
            <Text style={s.body}>{sections.brandResearch.currentMarketing}</Text>
          </>
        )}

        {/* Qualification */}
        <SectionHeading title="Qualification" />
        <View style={s.qualGrid}>
          <View style={s.qualCell}>
            <Text style={s.qualLabel}>Budget</Text>
            <Text style={s.body}>{sections.qualification.budget}</Text>
          </View>
          <View style={s.qualCell}>
            <Text style={s.qualLabel}>Timeline</Text>
            <Text style={s.body}>{sections.qualification.timeline}</Text>
          </View>
          <View style={s.qualCell}>
            <Text style={s.qualLabel}>Decision Maker</Text>
            <Text style={s.body}>{sections.qualification.decisionMaker}</Text>
          </View>
          <View style={s.qualCell}>
            <Text style={s.qualLabel}>Fit</Text>
            <Text style={[s.body, s.bold]}>{sections.qualification.fit}</Text>
          </View>
        </View>

        {/* Objection Playbook */}
        <SectionHeading title="Objection Playbook" />
        {sections.objectionPlaybook.map((item, i) => (
          <View key={i} style={s.objectionBlock}>
            <Text style={s.objectionQ}>&ldquo;{item.objection}&rdquo;</Text>
            <Text style={s.objectionA}>{item.response}</Text>
          </View>
        ))}

        {/* Previous Interactions */}
        {sections.previousInteractions && (
          <>
            <SectionHeading title="Previous Interactions" />
            {sections.previousInteractions.lastCallSummary && (
              <>
                <Text style={[s.qualLabel, { marginBottom: 1 }]}>
                  Last call
                </Text>
                <Text style={[s.body, { marginBottom: 6 }]}>
                  {sections.previousInteractions.lastCallSummary}
                </Text>
              </>
            )}
            {sections.previousInteractions.promisesMade.length > 0 && (
              <>
                <Text style={[s.qualLabel, { marginBottom: 2 }]}>
                  Commitments
                </Text>
                {sections.previousInteractions.promisesMade.map((p, i) => (
                  <Text key={i} style={[s.body, { marginBottom: 2 }]}>
                    • {p}
                  </Text>
                ))}
              </>
            )}
          </>
        )}

        {/* Demo Status */}
        {sections.demoStatus && (
          <>
            <SectionHeading title="Demo Status" />
            <Text style={s.body}>{sections.demoStatus.status}</Text>
          </>
        )}

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>Kracked Sales</Text>
          <Text style={s.footerText}>Confidential</Text>
        </View>
      </Page>
    </Document>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.sectionDivider} />
    </View>
  );
}

// ─── Client-side download trigger ────────────────────────────────────────────

export async function generateCallPrepPdf(props: PdfProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await pdf(
    React.createElement(CallPrepPdfDocument, props) as any
  ).toBlob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  const safeName = props.contactName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  const date = format(new Date(), "yyyy-MM-dd");
  a.download = `call-prep-${safeName}-${date}.pdf`;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
