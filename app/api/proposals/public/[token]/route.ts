import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, agreementTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const DEFAULT_MANAGEMENT_AGREEMENT = `## Management Service Agreement

This Management Service Agreement ("Agreement") is entered into between Kracked Retention ("Agency") and the client identified in the proposal details above ("Client").

**1. Services**
The Agency agrees to provide email marketing management services as described in the proposal, including strategy, copywriting, design, and deployment of email campaigns.

**2. Payment Terms**
Client agrees to pay the retainer amount specified in this proposal on the billing schedule indicated. Payments are due within 7 days of invoice issuance.

**3. Term and Termination**
This agreement continues on a recurring basis as specified. Either party may terminate with 30 days written notice. Upon cancellation, the MRR reduction takes effect on the cancellation date, not the next billing cycle.

**4. Intellectual Property**
All deliverables created by the Agency for the Client become the Client's property upon full payment.

**5. Confidentiality**
Both parties agree to keep confidential all proprietary information shared in the course of this engagement.

**6. Limitation of Liability**
The Agency's total liability is limited to the fees paid in the most recent billing period.

**7. Governing Law**
This agreement is governed by the laws of the applicable jurisdiction.

By signing and paying this invoice, Client acknowledges acceptance of these terms.`;

const DEFAULT_PROJECT_AGREEMENT = `## Project Service Agreement

This Project Service Agreement ("Agreement") is entered into between Kracked Retention ("Agency") and the client identified in the proposal details above ("Client").

**1. Project Scope**
The Agency agrees to deliver the services described in this proposal within the timeframe specified.

**2. Payment Terms**
Client agrees to pay the total project fee as specified. For instalment plans, each instalment is due on the date indicated. Project work commences upon receipt of the first payment.

**3. Revisions**
The project includes a reasonable number of revisions as agreed. Significant scope changes may be subject to additional fees by mutual agreement.

**4. Deliverables**
Final deliverables will be provided upon receipt of full payment.

**5. Intellectual Property**
All deliverables become the Client's property upon full payment of the project fee.

**6. Confidentiality**
Both parties agree to keep confidential all proprietary information shared during this project.

**7. Limitation of Liability**
The Agency's total liability is limited to the total project fee paid.

**8. Governing Law**
This agreement is governed by the laws of the applicable jurisdiction.

By signing and paying this invoice, Client acknowledges acceptance of these terms.`;

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

    // Fetch agreement body
    const [template] = await db()
      .select()
      .from(agreementTemplates)
      .where(eq(agreementTemplates.type, proposal.type))
      .limit(1);

    const agreementBody =
      template?.body ??
      (proposal.type === "management" ? DEFAULT_MANAGEMENT_AGREEMENT : DEFAULT_PROJECT_AGREEMENT);

    return NextResponse.json({
      proposal: {
        id: proposal.id,
        title: proposal.title,
        type: proposal.type,
        contactName: proposal.contactName,
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
        agreementBody,
      },
    });
  } catch (err) {
    console.error("[GET /api/proposals/public/[token]]", err);
    return NextResponse.json({ error: "Failed to fetch proposal" }, { status: 500 });
  }
}
