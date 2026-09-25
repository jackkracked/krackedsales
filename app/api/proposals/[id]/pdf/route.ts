import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateAgreementPdf } from "@/lib/pdf/render";
import { resolveProposalContent } from "@/lib/proposals/templates";
import sharp from "sharp";

export const dynamic = "force-dynamic";

/**
 * Re-encode a signature PNG so @react-pdf renders it reliably. Its bundled PNG decoder
 * silently drops some canvas-produced RGBA data URIs (the smaller ones), leaving the
 * signature blank. Flattening onto white + re-encoding normalises every one.
 */
async function normalizeSignature(dataUri: string | null): Promise<string | null> {
  if (!dataUri || !dataUri.startsWith("data:image")) return dataUri;
  try {
    const buf = Buffer.from(dataUri.split(",")[1] ?? "", "base64");
    const out = await sharp(buf).flatten({ background: "#ffffff" }).png().toBuffer();
    return "data:image/png;base64," + out.toString("base64");
  } catch (e) {
    console.error("[pdf] signature normalize failed", e);
    return dataUri; // fall back to the original rather than lose it
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const instalments =
      proposal.paymentStructure === "instalment"
        ? await db()
            .select()
            .from(proposalInstalments)
            .where(eq(proposalInstalments.proposalId, id))
        : [];

    // Terms + acceptance come from the effective per-proposal content
    // (snapshot -> template -> defaults), the single source of truth shared with the web page.
    const content = await resolveProposalContent(proposal);

    const pdfBuffer = await generateAgreementPdf({
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
      // 90-Day Management billing display fields.
      managementOption: proposal.managementOption,
      autoRebillMode: proposal.autoRebillMode,
      firstPaymentSplit: proposal.firstPaymentSplit as Array<{ amount: number; offsetDays?: number }> | null,
      contractStartAt: proposal.contractStartAt,
      scheduleSnapshot: proposal.scheduleSnapshot,
      endDate: proposal.endDate,
      signedAt: proposal.signedAt,
      instalments,
      agreementTerms: content.terms,
      acceptance: content.acceptance,
      deliverables: proposal.deliverables,
      scopeIntro: content.scopeIntro,
      serviceLabel: content.serviceLabel,
      signatureData: await normalizeSignature(proposal.signatureData),
    });

    const filename = `kracked-retention-agreement-${proposal.contactName.toLowerCase().replace(/\s+/g, "-")}.pdf`;

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[GET /api/proposals/[id]/pdf]", err);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
