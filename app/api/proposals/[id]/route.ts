import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { dispatchWorkflowEvent } from "@/lib/workflows/triggers";
import { normalizeDeliverables, normalizeContent } from "@/lib/proposals/normalize";
import { defaultContentFor } from "@/lib/proposals/content";
import { moneyFootprint } from "@/lib/proposals/bulk";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const instalments = await db()
      .select()
      .from(proposalInstalments)
      .where(eq(proposalInstalments.proposalId, id));

    return NextResponse.json({ proposal: { ...proposal, instalments } });
  } catch (err) {
    console.error("[GET /api/proposals/[id]]", err);
    return NextResponse.json({ error: "Failed to fetch proposal" }, { status: 500 });
  }
}

// Allow-list for the generic PATCH. Anything not listed is REJECTED (mass-assignment guard —
// stripe*, token, signatureData, paidAt-without-paid, createdBy, deposit/split sums etc. can NEVER be
// set here). Draft-content fields are accepted ONLY while the proposal is a draft (that's the only
// state the inline editor renders in); the two status transitions are always accepted.
//   - inline document editor (draft only): title, contactName, serviceDescription, additionalRates,
//     notes, contactEmail, billingEmail, ccEmails, start/subscription/end dates, deliverables,
//     content (copy snapshot), and pricing (totalAmount + discount — recomputed server-side).
//   - list "Archive": status:"void" · detail "mark paid": status:"paid" + paidAt
const DRAFT_TEXT_FIELDS = new Set(["title", "contactName", "serviceDescription", "additionalRates", "notes", "contactEmail", "billingEmail"]);
const NULLABLE_TEXT_FIELDS = new Set(["serviceDescription", "additionalRates", "notes", "contactEmail", "billingEmail"]);
const DRAFT_DATE_FIELDS = new Set(["startDate", "subscriptionStartDate", "endDate", "expiresAt"]);
const MONEY_KEYS = ["totalAmount", "listAmount", "discountType", "discountValue", "discountScope"];
const ALLOWED_STATUS_VALUES = new Set(["void", "paid"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toMoney(n: unknown): number | null {
  const v = typeof n === "number" ? n : parseFloat(String(n));
  if (!Number.isFinite(v) || v < 0 || v > 1_000_000) return null;
  return Math.round(v * 100) / 100;
}
function parseNoon(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = v.length <= 10 ? new Date(v + "T12:00:00.000Z") : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json() as Record<string, unknown>;

    const [existing] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Authorization: only an admin or the proposal's own creator may edit it. Prevents one rep
    // re-pricing or marking-paid another rep's proposal via a guessed id (matches the DELETE gate).
    const isAdmin = (user as { role?: string }).role === "admin";
    if (!isAdmin && existing.createdBy !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const isDraft = existing.status === "draft";
    const ptype = existing.type === "project" ? "project" : "management";

    // Build the update from the allow-list only.
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const rejected: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (key === "status") {
        if (typeof value === "string" && ALLOWED_STATUS_VALUES.has(value)) set.status = value;
        else rejected.push(key);
        // ARCHIVING NEVER TOUCHES A DEAL WITH MONEY ON IT. Voiding a paid or signed proposal drops
        // it from revenue figures while commission keeps paying on it (proposal-roles review B4).
        // It also remembers what it was, so Unarchive can put it back exactly.
        if (value === "void" && existing.status !== "void") {
          const insts = await db().select({ status: proposalInstalments.status, paidAt: proposalInstalments.paidAt, invoice: proposalInstalments.stripeInvoiceId })
            .from(proposalInstalments).where(eq(proposalInstalments.proposalId, id));
          const money = moneyFootprint(existing, insts.some((i) => i.status === "paid" || !!i.paidAt), insts.some((i) => !!i.invoice));
          if (money) return NextResponse.json({ error: `Can't archive: ${money}.` }, { status: 409 });
          set.statusBeforeArchive = existing.status;
        }
      } else if (key === "paidAt") {
        // Only alongside a paid transition — never a standalone paid-date stamp.
        if (body.status === "paid") set.paidAt = typeof value === "string" ? new Date(value) : value;
        else rejected.push(key);
      } else if (MONEY_KEYS.includes(key)) {
        continue; // pricing handled as a coherent group after the loop
      } else if (DRAFT_TEXT_FIELDS.has(key)) {
        if (!isDraft) { rejected.push(key); continue; }
        if (value == null || value === "") {
          if (NULLABLE_TEXT_FIELDS.has(key)) set[key] = null; else rejected.push(key);
        } else if (typeof value !== "string") {
          rejected.push(key);
        } else if ((key === "contactEmail" || key === "billingEmail") && !EMAIL_RE.test(value.trim())) {
          rejected.push(key);
        } else {
          set[key] = key === "contactEmail" || key === "billingEmail" ? value.trim() : value;
        }
      } else if (DRAFT_DATE_FIELDS.has(key)) {
        if (!isDraft) { rejected.push(key); continue; }
        set[key] = value == null || value === "" ? null : parseNoon(value);
      } else if (key === "ccEmails") {
        if (!isDraft) { rejected.push(key); continue; }
        const arr = Array.isArray(value)
          ? value.filter((e) => typeof e === "string" && EMAIL_RE.test(e.trim())).map((e) => (e as string).trim())
          : [];
        set.ccEmails = arr.length ? arr : null;
      } else if (key === "deliverables") {
        if (!isDraft) { rejected.push(key); continue; }
        set.deliverables = normalizeDeliverables(value);
      } else if (key === "content") {
        if (!isDraft) { rejected.push(key); continue; }
        set.content = normalizeContent(value, existing.content ?? defaultContentFor(ptype));
      } else {
        rejected.push(key); // not a patchable field (stripe/signature/token/deposit/split/etc.)
      }
    }

    // Pricing group — server controls the total (client value is validated, never trusted blindly)
    // and the discount is only kept when internally coherent (list > total, valid type). Draft only.
    if (MONEY_KEYS.some((k) => k in body)) {
      if (!isDraft) {
        rejected.push("pricing");
      } else {
        const total = "totalAmount" in body ? toMoney(body.totalAmount) : existing.totalAmount;
        if (total == null || total <= 0) {
          return NextResponse.json({ error: "Invalid total amount" }, { status: 400 });
        }
        const la = "listAmount" in body ? toMoney(body.listAmount) : (existing.listAmount ?? null);
        const dv = "discountValue" in body ? toMoney(body.discountValue) : (existing.discountValue ?? null);
        const dtRaw = "discountType" in body ? body.discountType : existing.discountType;
        const dt = dtRaw === "percent" || dtRaw === "fixed" ? dtRaw : null;
        const dsRaw = "discountScope" in body ? body.discountScope : existing.discountScope;
        const ds = dsRaw === "first_payment" || dsRaw === "total" ? dsRaw : "recurring";
        set.totalAmount = total;
        // Coherence differs by scope. A recurring discount is already inside totalAmount, so the
        // list price must be HIGHER. A first-payment discount leaves the price whole, so list and
        // total are EQUAL by design — testing `la > total` there would silently drop the discount
        // on every edit, which is why this is split rather than a single comparison.
        const coherent = ds === "first_payment"
          ? !!(dv && dv > 0 && la && Math.abs(la - total) < 0.01 && dv < total && dt)
          : !!(dv && dv > 0 && la && la > total && dt);
        if (coherent) {
          set.listAmount = la; set.discountType = dt; set.discountValue = dv; set.discountScope = ds;
        } else {
          set.listAmount = null; set.discountType = null; set.discountValue = null; set.discountScope = null;
        }
        // Any change to the discount invalidates a coupon already minted for the old amount.
        // Sign reuses a stored coupon so a resumed checkout cannot stack two discounts — which
        // would otherwise mean an edited discount silently charges the SUPERSEDED amount. Dropping
        // the id here makes the next sign mint a coupon matching what the proposal now says.
        const discountChanged =
          set.listAmount !== existing.listAmount ||
          set.discountValue !== existing.discountValue ||
          set.discountType !== existing.discountType ||
          set.discountScope !== existing.discountScope;
        if (discountChanged && existing.stripeDiscountCouponId) set.stripeDiscountCouponId = null;
      }
    }

    if (rejected.length) {
      console.warn(`[PATCH /api/proposals/${id}] rejected non-permitted fields: ${rejected.join(", ")}`);
    }
    // Nothing but updatedAt survived the allow-list → the caller sent only forbidden fields.
    if (Object.keys(set).length === 1) {
      return NextResponse.json({ error: "No permitted fields to update", rejected }, { status: 400 });
    }

    const [updated] = await db()
      .update(proposals)
      .set(set)
      .where(eq(proposals.id, id))
      .returning();

    // Fire workflow trigger when manually marked as paid
    if (body.status === "paid") {
      dispatchWorkflowEvent("proposal.paid", {
        proposalId: updated.id,
        manuallyMarkedPaid: true,
        contactName: updated.contactName,
        contactEmail: updated.contactEmail ?? null,
        contactId: updated.ghlContactId,
        opportunityId: updated.opportunityId ?? null,
        proposalTitle: updated.title,
        proposalType: updated.type,
        totalAmount: updated.totalAmount,
        currency: updated.currency,
        serviceDescription: updated.serviceDescription ?? null,
        paymentStructure: updated.paymentStructure,
        signerTitle: updated.signerTitle ?? null,
        paidAt: updated.paidAt?.toISOString() ?? new Date().toISOString(),
        signedAt: updated.signedAt?.toISOString() ?? null,
        stripeCustomerId: updated.stripeCustomerId ?? null,
        stripeSubscriptionId: updated.stripeSubscriptionId ?? null,
      }).catch(() => {});
    }

    return NextResponse.json({ proposal: updated });
  } catch (err) {
    console.error("[PATCH /api/proposals/[id]]", err);
    return NextResponse.json({ error: "Failed to update proposal" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    // proposalInstalments cascade-deletes automatically (FK onDelete: cascade)
    await db().delete(proposals).where(eq(proposals.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/proposals/[id]]", err);
    return NextResponse.json({ error: "Failed to delete proposal" }, { status: 500 });
  }
}
