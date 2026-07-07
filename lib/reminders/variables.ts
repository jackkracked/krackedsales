/**
 * The dynamic variables an admin can drop into a client email, in plain language.
 *
 * Each variable is a {{token}} in the stored template. The editor shows the friendly
 * `label` as a pill; the engine resolves the token to a REAL value at send time, or a
 * `sample` value in the live preview. Every resolved value is HTML-escaped by the
 * renderer before it touches the email body, so a client name like `A & B <co>` can
 * never break or inject markup.
 *
 * Links (pay / sign) are deliberately NOT variables: the call-to-action button is a
 * structural part of every email (URL wired automatically, label editable), so a
 * client can never receive a reminder with a missing or broken action.
 */
import { fmtMoney, amountBlockLabel, priceSuffix, fmtDay } from "@/lib/proposals/billing";
import type { proposals, proposalInstalments } from "@/lib/db/schema";

type ProposalRow = typeof proposals.$inferSelect;
type InstalmentRow = typeof proposalInstalments.$inferSelect;

export interface VarDef {
  token: string; // "client.name"
  label: string; // "Client name"
  group: "Client" | "Proposal" | "Invoice" | "Rep";
  sample: string; // shown in the preview
  /** Only relevant to invoice reminders (needs an instalment in context). */
  invoiceOnly?: boolean;
}

export const VAR_CATALOG: VarDef[] = [
  { token: "client.firstName", label: "First name", group: "Client", sample: "Blake" },
  { token: "client.name", label: "Client name", group: "Client", sample: "Blake Brossman" },
  { token: "proposal.package", label: "Package", group: "Proposal", sample: "Monthly Retainer" },
  { token: "proposal.value", label: "Deal value", group: "Proposal", sample: "$4,500/mo" },
  { token: "invoice.amount", label: "Amount due", group: "Invoice", sample: "$1,500", invoiceOnly: true },
  { token: "invoice.dueDate", label: "Due date", group: "Invoice", sample: "16 Jul 2026", invoiceOnly: true },
  { token: "rep.name", label: "Your name", group: "Rep", sample: "Gage" },
];

/** HTML-escape a resolved value before it's placed into the email body. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function proposalValue(p: ProposalRow): string {
  return `${fmtMoney(p.totalAmount, p.currency)}${priceSuffix(p)}`;
}

export interface ResolveContext {
  proposal: ProposalRow;
  instalment?: InstalmentRow | null;
  repName?: string | null;
}

/**
 * Resolve every variable token to its real (un-escaped) string value for a given
 * proposal/instalment. Missing values resolve to "" so a send never ships a raw
 * `{{token}}` to a client. Escaping happens later, in the renderer.
 */
export function resolveVars(ctx: ResolveContext): Record<string, string> {
  const { proposal: p, instalment, repName } = ctx;
  return {
    "client.firstName": firstName(p.contactName),
    "client.name": p.contactName,
    "proposal.package": amountBlockLabel(p),
    "proposal.value": proposalValue(p),
    "invoice.amount": instalment ? fmtMoney(instalment.amount, p.currency) : fmtMoney(p.totalAmount, p.currency),
    "invoice.dueDate": instalment?.dueDate ? fmtDay(instalment.dueDate) ?? "" : "",
    "rep.name": repName ? firstName(repName) : "Gage",
  };
}

/** Named preview scenarios for the editor's "Preview as…" switch (sample data only). */
export interface PreviewScenario {
  id: string;
  label: string;
  values: Record<string, string>;
}

export const PREVIEW_SCENARIOS: PreviewScenario[] = [
  {
    id: "retainer",
    label: "Monthly retainer",
    values: {
      "client.firstName": "Blake",
      "client.name": "Blake Brossman",
      "proposal.package": "Monthly Retainer",
      "proposal.value": "$4,500/mo",
      "invoice.amount": "$4,500",
      "invoice.dueDate": "16 Jul 2026",
      "rep.name": "Gage",
    },
  },
  {
    id: "deposit",
    label: "Deposit deal",
    values: {
      "client.firstName": "Ada",
      "client.name": "Ada Fluency",
      "proposal.package": "Monthly Retainer",
      "proposal.value": "$3,000/mo",
      "invoice.amount": "$1,500",
      "invoice.dueDate": "1 Aug 2026",
      "rep.name": "Gage",
    },
  },
  {
    id: "project",
    label: "Project instalment",
    values: {
      "client.firstName": "Meg",
      "client.name": "Meg Handmade",
      "proposal.package": "Project Investment",
      "proposal.value": "$1,500",
      "invoice.amount": "$750",
      "invoice.dueDate": "30 Jun 2026",
      "rep.name": "Gage",
    },
  },
];
