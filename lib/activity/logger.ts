import { db } from "@/lib/db";
import { activityEvents } from "@/lib/db/schema";

export type ActivityAction =
  /** A tracked booking link was delivered to a prospect. This is the record that credits a
   *  setter with the booked call that follows, so it must only be logged after a successful
   *  send, never on intent. */
  | "booking_link.sent"
  /** The rep took the link to paste elsewhere. Attributes a booking, but is NOT outreach and
   *  must never be counted in a "links sent" funnel. */
  | "booking_link.copied"
  /** The rep booked the appointment themselves, typically while on the phone. The strongest
   *  attribution there is: we created it, so there is nothing to infer. */
  | "booking.created"
  | "opportunity.created"
  | "opportunity.stage_changed"
  | "note.created"
  | "note.updated"
  | "call.dispositioned"
  | "proposal.created"
  | "proposal.sent"
  | "proposal.signed"
  | "message.sent"
  | "template.sent"
  | "task.created"
  | "task.completed"
  | "task.updated"
  | "demo.started"
  // The DEMO CREATION event, per rep. Kelsey works the unresponsive list and creates demos;
  // this is the only record of who submitted one. Logged here rather than relying on
  // demo_boards alone, because board creation is deliberately non-fatal — a board that fails
  // to build must not silently erase the rep's credit for the demo.
  | "demo.created"
  | "follow_up.sent"
  | "lead.added"
  | "proposal.deposit_override"
  | "proposal.deposit_reconcile"
  | "contact.assigned"
  // Leads Centre: the Meta stage change that drives ad optimisation. Logged because it is
  // the only audit trail of what we told Facebook about a lead, and when.
  | "lead.stage_changed";

export interface LogActivityParams {
  userId: string;
  userName: string;
  userEmail: string;
  action: ActivityAction;
  entityType: string;
  entityId: string;
  entityName?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget activity logger.
 * Never throws — a logging failure never blocks the user action.
 */
export function logActivity(params: LogActivityParams): void {
  db()
    .insert(activityEvents)
    .values({
      userId: params.userId,
      userName: params.userName,
      userEmail: params.userEmail,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      entityName: params.entityName ?? null,
      metadata: params.metadata ?? null,
    })
    .catch((err) => console.error("[activity]", params.action, err));
}
