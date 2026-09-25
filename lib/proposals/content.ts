// Shared proposal deliverables + editable-copy types, and the DEFAULT copy for
// Management and Project proposals, extracted verbatim from the current hardcoded
// copy in:
//   - components/proposals/public/proposal-signing-page.tsx
//   - app/api/proposals/[id]/pdf/route.ts (DEFAULT_MANAGEMENT_TERMS / DEFAULT_PROJECT_TERMS)
//
// Copy is stored as markdown: bold-JSX headings become `**Heading**`, bullet lists
// become `- item` lines, paragraph breaks are blank lines. Where the client's name
// is interpolated, the literal token {{client}} is used.

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DeliverableGroup = "included" | "exclusive" | "custom";

export interface DeliverableItem {
  id: string;
  label: string;
  detail?: string;
  group: DeliverableGroup;
  order: number;
}

export interface Deliverables {
  packageId: string | null;
  packageName: string | null;
  emails: number | null; // total campaigns+flows over the term (null if n/a)
  popUps: number | null; // total pop-up redesigns over the term (null if n/a)
  items: DeliverableItem[];
}

export interface AdditionalRate {
  item: string;
  cost: string;
}

export interface SignatureBlock {
  company: string;
  title: string;
  name: string;
  email: string;
}

export interface ProposalContent {
  docTitle: string; // "Service Agreement and Statement of Work"
  serviceLabel: string; // pricing-table service label
  intro: string; // markdown preamble; use the token {{client}} where the client's name is interpolated
  scopeIntro: string; // markdown; the "Kracked Retention will fully manage and deliver the following..." line
  defaultScope: string; // markdown bullet list — the default deliverable bullets, used ONLY when a proposal has no structured deliverables
  additionalScopeIntro: string; // markdown paragraph above the additional-rates table
  additionalRates: AdditionalRate[];
  acceptance: string; // markdown acceptance/authorization text
  terms: string; // markdown legal terms (verbatim from DEFAULT_*_TERMS)
  signature: SignatureBlock;
}

// ─── Verbatim legal terms (from app/api/proposals/[id]/pdf/route.ts) ───────────

const DEFAULT_MANAGEMENT_TERMS = `**Service Collaboration & Cooperation**

To maintain a fair and healthy long-term relationship, Kracked Retention reserves the right to temporarily **pause services** if cooperation or communication from the Client prevents effective service delivery.

This pause will remain in effect until both parties reach a mutual resolution on how to proceed. Additionally, if payment for services is not made, Kracked Retention may suspend all active services until the agreed-upon payment is completed.

Our goal is to maintain a **positive, collaborative, and results-driven partnership** to ensure successful outcomes across all managed brands.

---

**Term & Renewal**

This Agreement operates on a **month-to-month basis** and will automatically renew unless terminated in accordance with the Pause & Termination Policy.

Services and billing will **automatically renew monthly** (every 30 days) per the terms of this agreement.

If the Client wishes to initiate any additional services during a billing month, a separate invoice will be issued based on the additional scope pricing as mutually agreed upon by both parties.

---

**Pause & Termination Policy**

Kracked Retention's production cycle requires strategic planning, copywriting, and design to be completed up to **30 days ahead of implementation**.

- **Notice Requirement:** If the Client wishes to pause or suspend services, a minimum of 30 days' written notice must be provided to admin@krackedretention.com.
- **Work Completed in Advance:** Any work already completed or in progress at the time of notice will remain billable and will be invoiced in full.
- **Final Closeout:** Once all in-progress work has been completed and implemented, Kracked Retention will consider the client's account closed and inactive until a written request to resume services is made.
- **No Immediate Termination:** Pausing or canceling services without providing the required notice may result in outstanding invoices for work already planned or completed.

---

**Privacy & Confidentiality**

Both parties agree to maintain the confidentiality of all business information, data, and assets shared throughout the partnership.

- Kracked Retention and Client agree to keep all confidential business information private and not disclose it to any third party.
- The final email assets, including copy and design, will be owned by the Client upon full payment.
- Kracked Retention will maintain necessary access to each brand's ESP and SMS platforms in addition to Shopify until all deliverables and payments are completed.
- If either party violates or shows intent to violate any agreements within this section, the non-violating party shall be entitled to injunctive relief to prevent further harm.

---

**Terms of Sale**

- You acknowledge that all sales are final and non-refundable. You waive any rights to charge back your purchase with your credit card processor, provided that services are delivered in a timely manner.
- If the Client wishes to cancel the services, they must provide written notice via email to admin@krackedretention.com or via Slack.
- Deliverables are measured by work planned and created, not by final deployment.
- The Client retains sole ownership of all Customer Materials, including final assets created under this agreement, upon full payment.

---

**Governing Law**

- This Agreement is governed by the laws of the State of Tennessee. All parties consent to the jurisdiction of Tennessee courts for dispute resolution and waive the right to a jury trial to the full extent allowable.
- This Agreement constitutes the entire understanding between the parties and supersedes all prior agreements, whether written or verbal.
- Time is of the essence in fulfilling all obligations under this Agreement.`;

const DEFAULT_PROJECT_TERMS = `**Service Collaboration & Cooperation**

In order to maintain a fair and healthy long-term relationship, we reserve the right to temporarily pause our services if you become uncooperative to the extent that it hampers our ability to provide effective service.

---

**Privacy & Confidentiality**

We respect your privacy and must insist that you respect the privacy of team members involved.

- Kracked Retention and Client agree to keep all confidential business information private and not disclose it to any third party.
- The final email assets, including copy and design, will be owned by the Client upon full payment.
- Kracked Retention must be granted access to the ESP (e.g., Klaviyo) until the project is completed and all outstanding payments are settled.

---

**Terms of Sale**

- You acknowledge that all sales are final and non-refundable. You waive any rights to charge back your purchase with your credit card processor, provided that the project is completed in a timely manner.
- If the Client wishes to cancel the project before completion, they must provide written notice via email to admin@krackedretention.com.
- Unlimited revisions apply only to refinements within the brand direction and strategy approved at kickoff.
- The Client retains sole ownership of all Customer Materials, including final email assets created under this agreement, upon full payment.
- This Agreement is governed by the laws of the State of Tennessee.
- Time is of the essence in fulfilling all obligations under this Agreement.`;

// ─── Shared, type-agnostic copy (identical in both source branches) ────────────

const DOC_TITLE = "Service Agreement and Statement of Work";

// From the "Project Scope" heading label in the signing page.
const SCOPE_HEADING = "Project Scope";

// ─── Management defaults ───────────────────────────────────────────────────────

export const MANAGEMENT_DEFAULTS: ProposalContent = {
  docTitle: DOC_TITLE,
  serviceLabel: "Kracked Retention Email + SMS Marketing Management",
  intro: `This Agreement is made between Kracked Retention ("Service Provider") and **{{client}}** ("Client") and becomes effective upon the execution of this document or the commencement of services, whichever occurs first.`,
  scopeIntro: `**${SCOPE_HEADING}**

Kracked Retention will fully manage and deliver the following services for the Client's brand:`,
  defaultScope: `- **Email + SMS Marketing Management** — Strategy, copywriting, design, and implementation of all campaigns, including campaign calendar planning, ideation, scheduling, and execution
- **Optimization & Reporting** — Monthly reporting and quarterly flow deep dive presenting opportunities within your account
- **Creative Delivery** — All designs delivered within Miro for review
- **Creative Assets** — All designs available in Figma for future use
- **Communication** — Dedicated Slack channel and bi-weekly or monthly check-in calls with account strategist`,
  additionalScopeIntro: `If additional services are requested (e.g., extra campaigns, flow build-outs, or any other additional support), Kracked Retention will pro-rate based on the below table. If a service is not listed, a proposal via Slack or email will be sent upon request outlining the additional scope and cost. Upon written acceptance, work will be completed and prorated at the end of the month.`,
  additionalRates: [
    { item: "Campaign Emails", cost: "$200 per email" },
    { item: "Flow Emails", cost: "$200 per email" },
    { item: "Flow Email Edits", cost: "$100 per email" },
    { item: "SMS", cost: "FREE" },
    { item: "Pop-Up", cost: "$150 per Pop-Up" },
  ],
  acceptance: `**Acceptance**

The Client named below acknowledges and agrees to all terms outlined in this Statement of Work. Both parties confirm they have the authority to enter into this Agreement on behalf of their respective companies.

The Client authorizes Kracked Retention to issue invoices and collect payments for all services rendered under this Agreement, including any approved additional work or prorated amounts. The Client certifies that they are an authorized user of the provided payment method and agrees not to dispute charges that align with the terms of this Agreement.

In the event of a failed or delayed payment, Kracked Retention reserves the right to adjust the payment schedule, suspend services, or modify invoice amounts as necessary to recover any outstanding balance.

The Client represents and warrants that they are authorized to execute this Agreement and payment authorization and agrees to indemnify and hold harmless Kracked Retention, its affiliates, the bank, and any payment processors from all claims, damages, or losses arising from authorized transactions made pursuant to this Agreement.`,
  terms: DEFAULT_MANAGEMENT_TERMS,
  signature: {
    company: "KRACKED RETENTION",
    title: "CEO",
    name: "GAGE FLESHER",
    email: "admin@krackedretention.com",
  },
};

// ─── Project defaults ──────────────────────────────────────────────────────────

export const PROJECT_DEFAULTS: ProposalContent = {
  docTitle: DOC_TITLE,
  serviceLabel: "Project Services",
  intro: `This agreement is made between Kracked Retention and **{{client}}** ("Client") and becomes effective upon the execution of this document or the commencement of services, whichever occurs first.`,
  scopeIntro: `**${SCOPE_HEADING}**

Kracked Retention will fully manage and deliver the following:`,
  defaultScope: `- Kick-off call & project completion call
- Strategy, copy, design, and implementation included
- All designs delivered in Miro for review
- All designs available in Figma for future use`,
  additionalScopeIntro: `Any services outside the agreed scope (e.g., Monthly Management, extra flows, or campaigns) will require a separate agreement mutually approved by both parties. If additional items are requested after the kick-off call, they will be pro-rated and invoiced separately per the pricing table below.`,
  additionalRates: [
    { item: "Flow Emails", cost: "$200 per email" },
    { item: "SMS", cost: "FREE" },
    { item: "Pop-Up", cost: "$150 per Pop-Up" },
  ],
  acceptance: `**Acceptance**

The Client named below acknowledges and agrees to the terms outlined in this Statement of Work. Both parties confirm they have the proper authority to enter into this agreement on behalf of their respective companies.

The Client authorizes Kracked Retention to invoice for the agreed-upon purchase and payment plan. The Client certifies that they are an authorized user of the provided payment method and will not dispute the payment, provided it aligns with the terms of this agreement.

In the event of a failed payment, the payment schedule and/or amounts may be adjusted to recover any outstanding balance.

The Client represents and warrants that they are authorized to execute this payment authorization and indemnifies Kracked Retention, the bank, and the payment processor from any claims, damages, or losses arising from authorized transactions under this agreement.`,
  terms: DEFAULT_PROJECT_TERMS,
  signature: {
    company: "KRACKED RETENTION",
    title: "CEO",
    name: "GAGE FLESHER",
    email: "admin@krackedretention.com",
  },
};

export function defaultContentFor(type: "management" | "project"): ProposalContent {
  return type === "management" ? MANAGEMENT_DEFAULTS : PROJECT_DEFAULTS;
}
