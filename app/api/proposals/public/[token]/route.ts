import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logProposalEvent } from "@/lib/proposals/track";
import { resolveProposalContent } from "@/lib/proposals/templates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const preview = req.nextUrl.searchParams.get("preview") === "1";

    const [proposal] = await db()
      .select()
      .from(proposals)
      .where(eq(proposals.token, token))
      .limit(1);

    if (!proposal) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // Log a reliable "viewed" event — the prospect actually loaded the proposal page.
    // Skip previews and any request carrying a staff session cookie (internal views).
    const isStaff = !!req.cookies.get("kracked_session");
    if (!preview && !isStaff) {
      // Dedupe: one "viewed" per device per 30 min (a single open triggers several fetches).
      logProposalEvent(proposal.id, token, "viewed", req, { dedupMs: 30 * 60_000 }).catch(() => {});
    }

    // Return status info for non-sent proposals (unless preview mode)
    if (proposal.status !== "sent" && !preview) {
      return NextResponse.json({ status: proposal.status, title: proposal.title });
    }

    // Fetch instalments if applicable (regular or deposit)
    const instalments =
      proposal.paymentStructure === "instalment" || proposal.hasDeposit
        ? await db()
            .select()
            .from(proposalInstalments)
            .where(eq(proposalInstalments.proposalId, proposal.id))
        : [];

    // Resolve the editable copy through the single source of truth:
    // per-proposal snapshot -> proposal_templates -> hardcoded defaults.
    const content = await resolveProposalContent(proposal);
    const agreementTerms = content.terms; // back-compat field; the page prefers `content`

    return NextResponse.json({
      preview,
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
        autoRenew: proposal.autoRenew,
        listAmount: proposal.listAmount,
        discountType: proposal.discountType,
        discountValue: proposal.discountValue,
        discountScope: proposal.discountScope,
        startDate: proposal.startDate,
        // 90-Day Management billing display fields (drive the full-term total + schedule wording).
        managementOption: proposal.managementOption,
        autoRebillMode: proposal.autoRebillMode,
        firstPaymentSplit: proposal.firstPaymentSplit,
        contractStartAt: proposal.contractStartAt,
        scheduleSnapshot: proposal.scheduleSnapshot,
        endDate: proposal.endDate,
        expiresAt: proposal.expiresAt,
        status: proposal.status,
        additionalRates: proposal.additionalRates,
        hasDeposit: proposal.hasDeposit,
        depositTotal: proposal.depositTotal,
        depositsPaidTotal: proposal.depositsPaidTotal,
        instalments,
        agreementTerms,
        deliverables: proposal.deliverables,
        content,
      },
    });
  } catch (err) {
    console.error("[GET /api/proposals/public/[token]]", err);
    return NextResponse.json({ error: "Failed to fetch proposal" }, { status: 500 });
  }
}
