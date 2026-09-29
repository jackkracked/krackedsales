import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposalInstalments, proposals } from "@/lib/db/schema";

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

export async function runBulk(
  actor: { id: string; name: string; role: string },
  action: BulkAction,
  ids: string[],
  reason?: string,
): Promise<BulkResult[]> {
  if (actor.role !== "admin") throw Object.assign(new Error("Only an admin can do that"), { status: 403 });
  const clean = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
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
      if (action === "unarchive") {
        if (p.status !== "void") { results.push({ proposalId: id, name, ok: false, reason: "it is not archived" }); continue; }
        // Back to exactly what it was. Older archives predate the record, so rebuild it from dates.
        const restored = p.statusBeforeArchive ?? (p.lostAt ? "lost" : p.sentAt ? "sent" : "draft");
        await db().update(proposals).set({ status: restored, statusBeforeArchive: null, updatedAt: now }).where(eq(proposals.id, id));
        results.push({ proposalId: id, name, ok: true });
        continue;
      }
      if (money) { results.push({ proposalId: id, name, ok: false, reason: money }); continue; }

      if (action === "archive") {
        if (p.status === "void") { results.push({ proposalId: id, name, ok: false, reason: "it is already archived" }); continue; }
        await db().update(proposals).set({ status: "void", statusBeforeArchive: p.status, updatedAt: now }).where(eq(proposals.id, id));
      } else if (action === "lost") {
        if (p.status === "lost") { results.push({ proposalId: id, name, ok: false, reason: "it is already lost" }); continue; }
        await db().update(proposals).set({ status: "lost", lostAt: now, lostReason, lostBy: actor.name, updatedAt: now }).where(eq(proposals.id, id));
      } else if (action === "delete") {
        if (!["draft", "lost", "void"].includes(p.status)) {
          results.push({ proposalId: id, name, ok: false, reason: "only drafts, lost or archived proposals can be deleted" });
          continue;
        }
        await db().delete(proposals).where(eq(proposals.id, id));
      }
      results.push({ proposalId: id, name, ok: true });
    } catch (err) {
      console.error(`[proposals/bulk] ${action} ${id}`, err);
      results.push({ proposalId: id, name, ok: false, reason: "the save failed" });
    }
  }
  return results;
}
