/**
 * New-client counting for Realized CAC — the spec's §6.3 rule, the single most error-prone
 * number in the whole model (counting one offer type understated volume ~6× in the real
 * business). The rule, disambiguated with the review panel:
 *
 *   A "new client relationship" = a distinct client (ghlContactId), counted ONCE, at the
 *   EARLIEST moment money ever landed from them (MIN paidAt), across BOTH management and
 *   project. A client who paid a Project in March then Management in June is ONE client,
 *   acquired in MARCH. Refunded/void first payments don't count as an acquisition.
 *
 * Returns the actual client list (not just a count) so the UI can make the number clickable
 * and a sceptical founder can verify it — the panel's #1 trust requirement.
 */
import { db } from "@/lib/db";
import { proposals } from "@/lib/db/schema";
import { and, isNotNull, inArray } from "drizzle-orm";

export interface NewClient {
  ghlContactId: string;
  contactName: string | null;
  acquiredAt: Date; // first-ever paid moment
  firstType: string; // "management" | "project" — how they first came in
  firstAmount: number; // the first paid proposal's total
}

/** Each distinct client's first-ever acquisition (MIN paidAt across mgmt + project, ex-void). */
export async function firstAcquisitions(): Promise<Map<string, NewClient>> {
  const rows = await db()
    .select({
      ghlContactId: proposals.ghlContactId,
      contactName: proposals.contactName,
      paidAt: proposals.paidAt,
      type: proposals.type,
      status: proposals.status,
      totalAmount: proposals.totalAmount,
    })
    .from(proposals)
    .where(and(isNotNull(proposals.paidAt), isNotNull(proposals.ghlContactId), inArray(proposals.type, ["management", "project"])));

  const byContact = new Map<string, NewClient>();
  for (const r of rows) {
    const id = (r.ghlContactId ?? "").trim();
    if (!id || !r.paidAt) continue;
    if ((r.status ?? "").toLowerCase() === "void") continue; // a refunded/void first payment is not an acquisition
    const at = new Date(r.paidAt);
    const existing = byContact.get(id);
    if (!existing || at < existing.acquiredAt) {
      byContact.set(id, {
        ghlContactId: id,
        contactName: r.contactName ?? null,
        acquiredAt: at,
        firstType: r.type ?? "",
        firstAmount: Number(r.totalAmount ?? 0),
      });
    }
  }
  return byContact;
}

/** Clients whose FIRST acquisition falls in [start, end). Half-open, newest first. */
export async function newClientsInWindow(start: Date, end: Date): Promise<NewClient[]> {
  const first = await firstAcquisitions();
  return [...first.values()]
    .filter((c) => c.acquiredAt >= start && c.acquiredAt < end)
    .sort((a, b) => b.acquiredAt.getTime() - a.acquiredAt.getTime());
}

export async function countNewClients(start: Date, end: Date): Promise<number> {
  return (await newClientsInWindow(start, end)).length;
}
