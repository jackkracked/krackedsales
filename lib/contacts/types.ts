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
  /** Every opportunity this contact has (a contact can sit in several pipelines/stages).
   *  Pipeline/stage filters match against ALL of these, not just the primary one shown. */
  oppRefs?: { pipelineId: string | null; stageId: string | null; stage: string | null }[];
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
  /** Server-side search haystack: company name, tags, and every custom-field value
   *  (alternate URLs, handles). Populated by /api/contacts and used only for filtering —
   *  it exists so a contact is findable by any detail they gave us, not just the rendered
   *  columns. Gage could not find brands whose URL was submitted in a custom field. */
  extraSearch?: string;
  dnd: boolean;
  responseStatus: "awaiting_reply" | "no_response" | "replied" | null;
  reachableChannels: string[]; // ["email", "sms", "instagram", etc.]
  autoSequence: boolean;       // GHL automation sent the last outbound recently (≤14d)
  autoSequenceAt: string | null;   // ISO of that last automated message (tooltip)
  followupScheduledAt: string | null; // ISO of our next queued follow-up send (tooltip)
  isCustomer?: boolean;        // has ever paid (from the customers table, denormalized)
  customerStatus?: string | null; // 'active' | 'inactive' | null
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
