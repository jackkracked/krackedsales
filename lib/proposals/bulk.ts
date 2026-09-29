import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, proposalInstalments, proposals } from "@/lib/db/schema";

/**
 * Bulk actions on proposals, from the list's multi-select bar. Plan: tasks/proposal-roles-plan.md.
 *
 * THE ONE RULE: bulk never touches money. A proposal with any money attached (signed, paid, an
 * invoice, a subscription, a paid instalment) is SKIPPED by archive, mark-lost and delete, and the
 * result says so by name. Those need a person looking at one deal at a time, where the single
 * actions already exist with their Stripe handling. Bulk is for tidying the pipeline, never for
 * rewriting revenue.
 */

export type BulkAction = "archive" | "unarchive" | "lost" | "delete";

export interface BulkResult { proposalId: string; name: string; ok: boolean; reason?: string }

type Row = typeof proposals.$inferSelect;

/** Why a proposal must not be changed in bulk, or null when it is safe. */
export function moneyFootprint(p: Row, paidInstalment: boolean, anyInvoice: boolean): string | null {
  if (p.paidAt) return "it has been paid";
  if (paidInstalment) return "it has a paid instalment";
  if (p.stripeSubscriptionId) return "it has a Stripe subscription";
  if (p.signedAt) return "it has been signed";
  if (p.stripeInvoiceId || anyInvoice) return "it has a Stripe invoice";
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The write only lands if the deal still has no money on it at the moment of writing. Checked
 *  in the WHERE, so a signature or payment arriving between the read and the write can never be
 *  archived, lost or deleted (security review M1). */
function stillNoMoney(id: string, status: string) {
  return and(
    eq(proposals.id, id), eq(proposals.status, status),
    isNull(proposals.signedAt), isNull(proposals.paidAt),
    isNull(proposals.stripeInvoiceId), isNull(proposals.stripeSubscriptionId),
  );
}

export async function runBulk(
  actor: { id: string; name: string; email: string; role: string },
  action: BulkAction,
  ids: string[],
  reason?: string,
): Promise<BulkResult[]> {
  if (actor.role !== "admin") throw Object.assign(new Error("Only an admin can do that"), { status: 403 });
  if (ids.length > 500) throw Object.assign(new Error("Up to 500 proposals at a time"), { status: 400 });
  const clean = [...new Set(ids)].filter((id) => UUID_RE.test(id));
  if (clean.length === 0) throw Object.assign(new Error("Pick at least one proposal"), { status: 400 });
  if (clean.length > 500) throw Object.assign(new Error("Up to 500 proposals at a time"), { status: 400 });
  const lostReason = (reason ?? "").trim().slice(0, 500);
  if (action === "lost" && !lostReason) throw Object.assign(new Error("A reason is required to mark proposals lost"), { status: 400 });

  const rows = await db().select().from(proposals).where(inArray(proposals.id, clean));
  const insts = await db().select({ proposalId: proposalInstalments.proposalId, status: proposalInstalments.status, invoice: proposalInstalments.stripeInvoiceId, paidAt: proposalInstalments.paidAt })
    .from(proposalInstalments).where(inArray(proposalInstalments.proposalId, clean));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const results: BulkResult[] = [];
  const now = new Date();

  // One at a time: each result is known exactly, and one failure never hides the rest.
  for (const id of clean) {
    const p = byId.get(id);
    if (!p) { results.push({ proposalId: id, name: "Unknown", ok: false, reason: "not found" }); continue; }
    const name = p.contactName || p.title || "Proposal";
    const mine = insts.filter((i) => i.proposalId === id);
    const money = moneyFootprint(p, mine.some((i) => i.status === "paid" || !!i.paidAt), mine.some((i) => !!i.invoice));

    try {
      // Every change leaves a record of who did it, awaited, and only once the write landed
      // (security review M2): a bulk delete must never leave nothing behind.
      const audit = (extra: Record<string, unknown> = {}) => db().insert(activityEvents).values({
        userId: actor.id, userName: actor.name, userEmail: actor.email,
        action: `proposal.bulk_${action}`, entityType: "proposal", entityId: id, entityName: name,
        metadata: { fromStatus: p.status, ...extra },
      });

      if (action === "unarchive") {
        if (p.status !== "void") { results.push({ proposalId: id, name, ok: false, reason: "it is not archived" }); continue; }
        // Back to exactly what it was. Older archives predate the record, so rebuild it from its
        // dates, money first, so a paid deal never comes back as signable (review L3).
        const restored = p.statusBeforeArchive
          ?? (p.paidAt ? "paid" : p.signedAt ? "signed" : p.lostAt ? "lost" : p.sentAt ? "sent" : "draft");
        const done = await db().update(proposals).set({ status: restored, statusBeforeArchive: null, updatedAt: now })
          .where(and(eq(proposals.id, id), eq(proposals.status, "void"))).returning({ id: proposals.id });
        if (!done.length) { results.push({ proposalId: id, name, ok: false, reason: "it changed while this ran" }); continue; }
        await audit({ toStatus: restored });
        results.push({ proposalId: id, name, ok: true });
        continue;
      }
      if (money) { results.push({ proposalId: id, name, ok: false, reason: money }); continue; }

      let done: Array<{ id: string }> = [];
      if (action === "archive") {
        if (p.status === "void") { results.push({ proposalId: id, name, ok: false, reason: "it is already archived" }); continue; }
        done = await db().update(proposals).set({ status: "void", statusBeforeArchive: p.status, updatedAt: now })
          .where(stillNoMoney(id, p.status)).returning({ id: proposals.id });
      } else if (action === "lost") {
        if (p.status === "lost") { results.push({ proposalId: id, name, ok: false, reason: "it is already lost" }); continue; }
        done = await db().update(proposals).set({ status: "lost", lostAt: now, lostReason, lostBy: actor.name, updatedAt: now })
          .where(stillNoMoney(id, p.status)).returning({ id: proposals.id });
      } else if (action === "delete") {
        if (!["draft", "lost", "void"].includes(p.status)) {
          results.push({ proposalId: id, name, ok: false, reason: "only drafts, lost or archived proposals can be deleted" });
          continue;
        }
        done = await db().delete(proposals).where(stillNoMoney(id, p.status)).returning({ id: proposals.id });
      }
      if (!done.length) { results.push({ proposalId: id, name, ok: false, reason: "it changed while this ran" }); continue; }
      await audit(action === "lost" ? { reason: lostReason } : {});
      results.push({ proposalId: id, name, ok: true });
    } catch (err) {
      console.error(`[proposals/bulk] ${action} ${id}`, err);
      results.push({ proposalId: id, name, ok: false, reason: "the save failed" });
    }
  }
  return results;
}
