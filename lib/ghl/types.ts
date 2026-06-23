export type GHLChannelType =
  | "TYPE_SMS"
  | "TYPE_EMAIL"
  | "TYPE_INSTAGRAM"
  | "TYPE_FB"
  | "TYPE_WHATSAPP"
  | "TYPE_CALL"
  | "TYPE_TIKTOK"
  | string;

export interface GHLConversation {
  id: string;
  contactId: string;
  locationId?: string;
  lastMessageBody?: string;
  lastMessageDate?: string;
  lastMessageDirection?: "inbound" | "outbound";
  lastMessageType?: string;
  type: GHLChannelType;
  unreadCount: number;
  fullName?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  assignedTo?: string;
  contact?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
}

export interface GHLMessage {
  id: string;
  conversationId?: string;
  emailMessageId?: string; // email-layer ID for GET /conversations/messages/email/{id}
  body: string;
  // Email metadata — present when messageType === TYPE_EMAIL
  meta?: {
    email?: {
      subject?: string;
      direction?: "inbound" | "outbound";
      messageIds?: string[];
    };
  };
  direction?: "inbound" | "outbound";
  messageType?: string; // TYPE_SMS, TYPE_EMAIL, TYPE_ACTIVITY_OPPORTUNITY, etc.
  dateAdded: string;
  status?: string;
  attachments?: string[];
}

// v1 opportunity structure
export interface GHLOpportunity {
  id: string;
  name: string;
  monetaryValue?: number;
  pipelineId: string;
  pipelineStageId: string;
  pipelineStageUId?: string;
  assignedTo?: string;
  status: "open" | "won" | "lost" | "abandoned";
  source?: string;
  lastStatusChangeAt?: string;
  createdAt: string;
  updatedAt: string;
  contact?: {
    id: string;
    name: string;
    companyName?: string;
    email?: string;
    phone?: string;
    website?: string;
    tags?: string[];
    dateAdded?: string; // contact creation date — more accurate than opp.createdAt
  };
  // Computed — stage name looked up from pipeline
  pipelineStageId_name?: string;
}

export interface GHLPipeline {
  id: string;
  name: string;
  stages: Array<{
    id: string;
    name: string;
    position?: number;
  }>;
  locationId: string;
}

export interface GHLCalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  contactId?: string;
  contactName?: string;
  status: string;
  calendarId: string;
  address?: string; // Google Meet/Zoom link
}

export interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  source?: string;
  tags?: string[];
  createdAt: string;
}
