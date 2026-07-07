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

    let repName: string | null = null;
    if (proposal.createdBy) {
      const [u] = await db().select({ name: users.name }).from(users).where(eq(users.id, proposal.createdBy)).limit(1);
      repName = u?.name ?? null;
    }

    const values = resolveVars({ proposal, repName });
    const ctaUrl = key === "proposal_sent" ? `${APP_URL}/p/${proposal.token}` : proposal.stripeHostedUrl ?? null;
    return renderEmail(
      { subject: template.subject, bodyTemplate: template.bodyTemplate, ctaLabel: template.ctaLabel },
      values,
      { ctaUrl },
    );
  } catch (e) {
    console.error(`[reminders/transactional] render(${key}) failed, falling back:`, e);
    return null;
  }
}
