import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { sendProposalLinkEmail, sendRenderedEmail } from "@/lib/email/resend";
import { renderTransactional } from "@/lib/reminders/transactional";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const recipientEmail: string | undefined = body?.recipientEmail;

    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (proposal.status === "draft") {
      return NextResponse.json({ error: "Proposal has not been sent yet" }, { status: 400 });
    }

    const effectiveEmail = recipientEmail || proposal.contactEmail;

    try {
      const templated = effectiveEmail ? await renderTransactional("proposal_sent", { ...proposal, contactEmail: effectiveEmail }) : null;
      if (templated && effectiveEmail) {
        await sendRenderedEmail(effectiveEmail, templated.subject, templated.html);
      } else {
        await sendProposalLinkEmail({
          contactName: proposal.contactName,
          contactEmail: effectiveEmail,
          title: proposal.title,
          totalAmount: proposal.totalAmount,
          currency: proposal.currency,
          serviceDescription: proposal.serviceDescription,
          token: proposal.token,
          type: proposal.type,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[resend-email] Failed:", msg);
      return NextResponse.json({ error: `Email failed: ${msg}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/proposals/[id]/resend-email]", err);
    return NextResponse.json({ error: "Failed to resend email" }, { status: 500 });
  }
}
