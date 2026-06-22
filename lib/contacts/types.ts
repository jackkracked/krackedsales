export interface UnifiedContact {
  uid: string; // "ghl_{contactId}" | "cl_{uuid}"
  source: "ghl" | "comment_lead";
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  platform: "lead_form" | "facebook" | "instagram" | "tiktok" | null;
  ghlContactId: string | null;
  opportunityId: string | null;
  stage: string | null;
  stageId: string | null;
  pipelineId: string | null;
  opportunityStatus: "open" | "won" | "lost" | "abandoned" | null;
  monetaryValue: number | null;
  tags: string[];
  commentLeadId: string | null;
  commentText: string | null;
  brandCategory: "ecommerce" | "service" | "local" | "b2b" | "other" | null;
  hasDemo: boolean;
  hasProposal: boolean;
  proposalStatus: string | null; // "draft" | "sent" | "signed" | "paid" etc.
  hasAudit: boolean;
  auditStatus: string | null; // "requested" | "delivered"
  awaitingReply: boolean;
  lastChannel: string | null;
  daysSinceLastTouch: number;
  daysInCurrentStage: number | null;
  lastActivityAt: string;
  createdAt: string;
  assignedTo: string | null; // GHL user ID
  dnd: boolean;
  responseStatus: "awaiting_reply" | "no_response" | "replied" | null;
  reachableChannels: string[]; // ["email", "sms", "instagram", etc.]
}

export interface TimelineEvent {
  id: string;
  type:
    | "lead_captured"
    | "stage_change"
    | "message_sent"
    | "message_received"
    | "note_added"
    | "demo_created"
    | "email_sent"
    | "email_received"
    | "contacted"
    | "proposal_sent"
    | "proposal_signed"
    | "proposal_paid"
    | "call_outcome";
  title: string;
  body?: string;
  occurredAt: string;
  outcome?: string; // raw disposition key, set on call_outcome events for tone/icon
}
