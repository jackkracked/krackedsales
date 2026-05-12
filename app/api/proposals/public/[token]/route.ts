import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, agreementTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

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

- **Notice Requirement:** If the Client wishes to pause or suspend services, a minimum of 30 days' written notice must be provided to admin@krackedretention.com. This allows Kracked Retention to adjust campaign schedules, production timelines, and resources accordingly.
- **Work Completed in Advance:** Because Kracked Retention begins preparing campaigns and creative assets ahead of schedule, any work already completed or in progress at the time of notice will remain billable and will be invoiced in full.
- **Final Closeout:** Once all in-progress work has been completed and implemented, Kracked Retention will consider the client's account closed and inactive until a written request to resume services is made and mutually agreed upon.
- **No Immediate Termination:** Pausing or canceling services without providing the required notice may result in outstanding invoices for work already planned or completed under the 30-day lookahead schedule.

---

**Privacy & Confidentiality**

Both parties agree to maintain the confidentiality of all business information, data, and assets shared throughout the partnership. You agree that:

- Kracked Retention and Client agree to keep all confidential business information private and not disclose it to any third party.
- The final email assets, including copy and design, will be owned by the Client upon full payment.
- Kracked Retention will maintain necessary access to each brand's ESP and SMS platforms in addition to Shopify until all deliverables and payments are completed.
- If either party violates or shows intent to violate any agreements within this section, the non-violating party shall be entitled to injunctive relief to prevent further harm.
- You further agree that your participation is subject to our Privacy Policy and Terms of Use.

---

**Terms of Sale**

- You acknowledge that all sales are final and non-refundable. You waive any rights to charge back your purchase with your credit card processor, provided that services are delivered in a timely manner as agreed upon by both parties.
- If the Client wishes to cancel the services, they must provide written notice via email to admin@krackedretention.com or via Slack. Any outstanding balance for work completed up to the cancellation date remains due.
- Deliverables are measured by work planned and created, not by final deployment. Any campaign, message, or asset that is strategized, written, designed, or prepared during the billing period will be counted toward deliverable limits and billed accordingly, regardless of whether the Client elects to send, delay, or cancel deployment.
- This agreement applies only to the baseline services outlined in the scope of work. Any additional services will require mutual written agreement and will be invoiced separately.
- The Client retains sole ownership of all **Customer Materials**, including final assets created under this agreement, upon full payment.

---

**Governing Law**

- This Agreement is governed by the laws of the **State of Tennessee**. All parties consent to the jurisdiction of Tennessee courts for dispute resolution and waive the right to a jury trial to the full extent allowable.
- This Agreement constitutes the entire understanding between the parties and supersedes all prior agreements, whether written or verbal.
- In the event any provision of this Agreement is held invalid or unenforceable, the remaining provisions shall remain in full force and effect.
- **Time is of the essence** in fulfilling all obligations under this Agreement.`;

const DEFAULT_PROJECT_TERMS = `**Additional Scope Pricing**

Any services outside the agreed scope will require a separate agreement mutually approved by both parties. If additional items are requested after the kick-off call, they will be pro-rated and invoiced separately.

| Additional Scope | Cost |
|---|---|
| Flow Emails | $300 per email |
| SMS | $100 per SMS/MMS |
| Pop-Up | $150 per Pop-Up |
| Flow Email Edits | $100 per email |

---

**Service Collaboration & Cooperation**

In order to maintain a fair and healthy long-term relationship, we reserve the right to temporarily pause our services if you become uncooperative to the extent that it hampers our ability to provide effective service. This pause will remain in effect until we reach a mutual agreement on how to proceed. Additionally, if payment for our services is not made, we may also suspend all services until the agreed-upon payment is completed. Our goal is to maintain a **positive, collaborative, and results-driven partnership** to ensure a successful outcome for both parties.

---

**Privacy & Confidentiality**

We respect your privacy and must insist that you respect the privacy of team members involved. Video calls and phone calls may be recorded for quality and training purposes.

You agree:

- Kracked Retention and Client agree to keep all confidential business information private and not disclose it to any third party.
- The final email assets, including copy and design, will be owned by the Client upon full payment.
- Kracked Retention must be granted access to the ESP (e.g., Klaviyo) until the project is completed and all outstanding payments are settled.
- If either party violates or shows intent to violate any agreements within this section, the non-violating party shall be entitled to injunctive relief to prevent further harm.
- If the Client chooses to cancel services, both parties must return all documents and materials containing Confidential Information, delete all such information from digital systems, and provide written certification of compliance.
- You further agree that your participation is subject to our Privacy Policy and Terms of Use.

---

**Terms of Sale**

- You acknowledge that all sales are final and non-refundable. You waive any rights to charge back your purchase with your credit card processor, provided that the project is completed in a timely manner as deemed by Kracked Retention.
- If the Client wishes to cancel the project before completion, they must provide written notice via email to admin@krackedretention.com. Any outstanding balance for work completed up to the cancellation date remains due.
- Unlimited revisions apply only to refinements within the brand direction and strategy approved at kickoff. Any request that requires reworking or recreating email assets due to a material change in branding, positioning, tone, or creative direction is considered out of scope and will be billed separately.
  - **Revision:** A minor adjustment to an existing email that does not alter the approved strategy, structure, or creative direction.
  - **Substantive Revision:** Any change that materially alters the approved strategy, messaging, structure, or creative direction. Substantive revisions are treated as new scope and billed at $100 per email.
- This agreement applies only to the one-time setup project outlined in the scope of work. Any additional services, including ongoing monthly management, require a separate agreement.
- The Client retains sole ownership of all **Customer Materials**, including final email assets created under this agreement, upon full payment.
- This Agreement is governed by the laws of the **State of Tennessee**. All parties consent to the jurisdiction of Tennessee courts for dispute resolution and waive the right to a jury trial to the full extent allowable.
- This Agreement constitutes the entire understanding between the parties and supersedes all prior agreements, whether written or verbal.
- **Time is of the essence** in fulfilling all obligations under this Agreement.`;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;

    const [proposal] = await db()
      .select()
      .from(proposals)
      .where(eq(proposals.token, token))
      .limit(1);

    if (!proposal) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // Return status info for non-sent proposals
    if (proposal.status !== "sent") {
      return NextResponse.json({ status: proposal.status, title: proposal.title });
    }

    // Fetch instalments if applicable
    const instalments =
      proposal.paymentStructure === "instalment"
        ? await db()
            .select()
            .from(proposalInstalments)
            .where(eq(proposalInstalments.proposalId, proposal.id))
        : [];

    // Fetch agreement terms body
    const [template] = await db()
      .select()
      .from(agreementTemplates)
      .where(eq(agreementTemplates.type, proposal.type))
      .limit(1);

    const agreementTerms =
      template?.body ??
      (proposal.type === "management" ? DEFAULT_MANAGEMENT_TERMS : DEFAULT_PROJECT_TERMS);

    return NextResponse.json({
      proposal: {
        id: proposal.id,
        title: proposal.title,
        type: proposal.type,
        contactName: proposal.contactName,
        contactEmail: proposal.contactEmail,
        totalAmount: proposal.totalAmount,
        currency: proposal.currency,
        serviceDescription: proposal.serviceDescription,
        paymentStructure: proposal.paymentStructure,
        billingInterval: proposal.billingInterval,
        billingIntervalCount: proposal.billingIntervalCount,
        startDate: proposal.startDate,
        endDate: proposal.endDate,
        expiresAt: proposal.expiresAt,
        status: proposal.status,
        instalments,
        agreementTerms,
      },
    });
  } catch (err) {
    console.error("[GET /api/proposals/public/[token]]", err);
    return NextResponse.json({ error: "Failed to fetch proposal" }, { status: 500 });
  }
}
