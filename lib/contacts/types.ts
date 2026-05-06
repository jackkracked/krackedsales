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
  awaitingReply: boolean;
  lastChannel: string | null;
  daysSinceLastTouch: number;
  lastActivityAt: string;
  createdAt: string;
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
    | "contacted";
  title: string;
  body?: string;
  occurredAt: string;
}
