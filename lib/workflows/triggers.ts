import { db } from "@/lib/db";
import { workflows, proposals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { executeWorkflow, type FlowNode, type FlowEdge } from "./executor";

/** Fetch a proposal and return a rich payload for workflow trigger events */
export async function buildProposalPayload(
  proposalId: string,
  extras: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const [p] = await db().select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
  if (!p) return { proposalId, ...extras };
  return {
    proposalId: p.id,
    contactName: p.contactName,
    contactEmail: p.contactEmail ?? null,
    contactId: p.ghlContactId,
    opportunityId: p.opportunityId ?? null,
    proposalTitle: p.title,
    proposalType: p.type,
    totalAmount: p.totalAmount,
    currency: p.currency,
    serviceDescription: p.serviceDescription ?? null,
    paymentStructure: p.paymentStructure,
    signerTitle: p.signerTitle ?? null,
    paidAt: p.paidAt?.toISOString() ?? null,
    signedAt: p.signedAt?.toISOString() ?? null,
    stripeCustomerId: p.stripeCustomerId ?? null,
    stripeSubscriptionId: p.stripeSubscriptionId ?? null,
    stripeInvoiceId: p.stripeInvoiceId ?? null,
    ...extras,
  };
}

export async function dispatchWorkflowEvent(
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const all = await db()
      .select()
      .from(workflows)
      .where(eq(workflows.enabled, true));

    for (const workflow of all) {
      const nodes = (Array.isArray(workflow.nodes) ? workflow.nodes : []) as FlowNode[];
      const edges = (Array.isArray(workflow.edges) ? workflow.edges : []) as FlowEdge[];
      const triggerNodes = nodes.filter(
        (n) =>
          n.type === `trigger.${event}` ||
          n.data?.triggerEvent === event
      );
      if (triggerNodes.length === 0) continue;

      const triggerOnly = workflow.listenMode === true;

      executeWorkflow(
        { id: workflow.id, nodes, edges },
        triggerNodes,
        data,
        { triggerOnly }
      ).catch((err) =>
        console.error(`[dispatchWorkflowEvent] wf=${workflow.id} event=${event}:`, err)
      );

      // Clear listen mode after the first captured event so the next real trigger runs normally
      if (triggerOnly) {
        db()
          .update(workflows)
          .set({ listenMode: false })
          .where(eq(workflows.id, workflow.id))
          .catch((err) => console.error(`[dispatchWorkflowEvent] clearListenMode wf=${workflow.id}:`, err));
      }
    }
  } catch (err) {
    console.error("[dispatchWorkflowEvent] Failed:", err);
  }
}
