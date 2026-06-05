import { db } from "@/lib/db";
import { activityEvents } from "@/lib/db/schema";

export type ActivityAction =
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
  | "follow_up.sent"
  | "lead.added"
  | "proposal.deposit_override";

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
