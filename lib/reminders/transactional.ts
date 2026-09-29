/**
 * Render a transactional client email (proposal-sent, payment-receipt) from the
 * EDITABLE template, so Jack's edits in /reminders actually change what clients get.
 *
 * Returns { subject, html } to send, or null when the template is missing/disabled/empty
 * — callers fall back to the previous hardcoded email, so this can never break a send.
 * The caller owns the actual send (and any PDF attachment), which keeps this off the
 * resend.ts <-> render.ts import cycle.
 */
import { db } from "@/lib/db";
import { users, proposals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getTemplate } from "@/lib/reminders/store";
import { resolveVars } from "@/lib/reminders/variables";
import { renderEmail } from "@/lib/reminders/render";
import { routeToCloser } from "@/lib/proposals/credit";

type ProposalRow = typeof proposals.$inferSelect;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://kracked-sales.vercel.app";

export async function renderTransactional(
  key: "proposal_sent" | "payment_receipt",
  proposal: ProposalRow,
): Promise<{ subject: string; html: string } | null> {
  try {
    const template = await getTemplate(key);
    if (!template || !template.enabled) return null;
    if (!template.subject.trim() && !template.bodyTemplate.trim()) return null;

    // The deal's CLOSER names itself to the client (Jack, 2026-09-29), creator if they have left.
    let repName: string | null = null;
    const repId = await routeToCloser(proposal);
    if (repId) {
      const [u] = await db().select({ name: users.name }).from(users).where(eq(users.id, repId)).limit(1);
      repName = u?.name ?? null;
    }

    const values = resolveVars({ proposal, repName });
    // proposal_sent: tracked link + open pixel so first-touch views/clicks/opens are captured.
    const ctaUrl = key === "proposal_sent" ? `${APP_URL}/api/proposals/track/${proposal.token}` : proposal.stripeHostedUrl ?? null;
    const pixelUrl = key === "proposal_sent" ? `${APP_URL}/api/proposals/track/open/${proposal.token}` : null;
    return renderEmail(
      { subject: template.subject, bodyTemplate: template.bodyTemplate, ctaLabel: template.ctaLabel },
      values,
      { ctaUrl, pixelUrl },
    );
  } catch (e) {
    console.error(`[reminders/transactional] render(${key}) failed, falling back:`, e);
    return null;
  }
}
