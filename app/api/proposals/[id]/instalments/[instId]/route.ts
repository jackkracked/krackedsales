import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { issueNextInstalmentInvoice } from "@/lib/proposals/instalment-billing";
import { stripe } from "@/lib/stripe/client";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; instId: string }> }
) {
  try {
    // ADMIN ONLY. This route now moves money: marking an instalment paid raises the NEXT
    // instalment's invoice, which for a client with a card on file is a real debit. A session
    // alone was enough before, when all it did was colour a badge.
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can change a payment" }, { status: 403 });
    }

    const { id: proposalId, instId } = await params;
    const body = await req.json() as { status?: string; paidAt?: string };

    // Validated at RUNTIME, not just in the type. An unrecognised status written here would
    // pause that client's billing entirely (see SETTLED/OWED in lib/proposals/instalment-billing).
    const ALLOWED = ["paid", "pending", "cancelled"];
    if (!body.status || !ALLOWED.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of ${ALLOWED.join(", ")}` },
        { status: 400 },
      );
    }

    const paidAt = body.status === "paid"
      ? (body.paidAt ? new Date(body.paidAt) : new Date())
      : null;

    // SCOPED TO THE PROPOSAL IN THE URL. Without this, any instalment id could be updated
    // through any proposal's path, and the caller could move money on a record they were not
    // even looking at.
    const [target] = await db()
      .select()
      .from(proposalInstalments)
      .where(and(eq(proposalInstalments.id, instId), eq(proposalInstalments.proposalId, proposalId)))
      .limit(1);
    if (!target) {
      return NextResponse.json({ error: "No such instalment on this proposal" }, { status: 404 });
    }

    // If Stripe is still holding an invoice for this instalment, it will happily collect it as
    // well. Marking it paid by hand means the money arrived another way, so that invoice has to
    // die, or the client pays twice.
    if (body.status === "paid" && target.stripeInvoiceId) {
      try {
        const inv = await stripe().invoices.retrieve(target.stripeInvoiceId);
        if (inv.status === "draft") await stripe().invoices.del(target.stripeInvoiceId);
        else if (inv.status === "open") await stripe().invoices.voidInvoice(target.stripeInvoiceId);
      } catch (e) {
        console.error("[instalments] could not retire the superseded invoice:", e);
        return NextResponse.json({
          error: "Could not cancel the existing Stripe invoice for this instalment. " +
                 "Nothing was changed, because leaving it live would charge the client twice.",
        }, { status: 502 });
      }
    }

    await db()
      .update(proposalInstalments)
      .set({
        status: body.status,
        // Clearing it on the way back to pending matters: the catch-up derives "last paid"
        // from this column, and a stale value there moves future due dates.
        paidAt: body.status === "paid" ? paidAt : null,
      })
      .where(eq(proposalInstalments.id, instId));

    // A payment is a payment, however it arrived.
    //
    // Marking an instalment paid by hand (a bank transfer, say) used to stop the plan dead:
    // nothing raised the NEXT instalment, because only the Stripe webhook did that. The client
    // would simply never be billed again, silently. Bank transfers are exactly the clients who
    // have no card on file, so this was the quietest possible way to lose money.
    if (body.status === "paid") {
      try {
        await issueNextInstalmentInvoice(proposalId);
      } catch (e) {
        console.error("[instalments] could not raise the next instalment:", e);
      }
    }

    // Recompute parent proposal status
    const allInstalments = await db()
      .select()
      .from(proposalInstalments)
      .where(eq(proposalInstalments.proposalId, proposalId));

    const settled = (st: string | null) =>
      st === "paid" || st === "superseded_by_subscription" || st === "cancelled";
    const allPaid = allInstalments.every((i) => settled(i.status));
    const anyPaid = allInstalments.some((i) => i.status === "paid");

    const newStatus = allPaid ? "paid" : anyPaid ? "partial" : "signed";
    const paidAtUpdate = allPaid ? new Date() : null;

    await db()
      .update(proposals)
      .set({
        status: newStatus,
        ...(paidAtUpdate ? { paidAt: paidAtUpdate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, proposalId));

    return NextResponse.json({ ok: true, proposalStatus: newStatus });
  } catch (err) {
    console.error("[PATCH /api/proposals/[id]/instalments/[instId]]", err);
    return NextResponse.json({ error: "Failed to update instalment" }, { status: 500 });
  }
}
