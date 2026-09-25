import { ghl } from "@/lib/ghl/client";

// Map our read-format channel types to GHL's send API enum.
// GHL send API valid values: SMS | Email | WhatsApp | IG | FB | Custom | Live_Chat | TikTok
// https://highlevel.stoplight.io/docs/integrations/0a75571b8b3bf-send-a-new-message
const SEND_TYPE_MAP: Record<string, string> = {
  TYPE_SMS: "SMS", TYPE_EMAIL: "Email", TYPE_INSTAGRAM: "IG", TYPE_FB: "FB",
  TYPE_WHATSAPP: "WhatsApp", TYPE_TIKTOK: "TikTok",
  SMS: "SMS", Email: "Email", IG: "IG", FB: "FB", WhatsApp: "WhatsApp",
  TikTok: "TikTok", Custom: "Custom", Live_Chat: "Live_Chat",
};

export function toGHLSendType(type: string): string {
  return SEND_TYPE_MAP[type] ?? "SMS";
}

/** The channels a rep can compose on, in display order. */
export const SENDABLE_CHANNELS = ["TYPE_SMS", "TYPE_EMAIL", "TYPE_INSTAGRAM", "TYPE_FB", "TYPE_TIKTOK"] as const;
export type SendableChannel = (typeof SENDABLE_CHANNELS)[number];

export interface SendMessageOpts {
  type: string;                 // read-format (TYPE_*) or send-format
  contactId: string;
  message?: string;
  /** Pass ONLY when it's the conversation for this exact channel; omit for cross-channel so GHL
   *  finds-or-creates the right conversation for contactId + type. */
  conversationId?: string;
  subject?: string;
  html?: string;
  cc?: string;
  bcc?: string;
  /** Public URLs (e.g. Vercel Blob) of files to attach — sent to GHL's `attachments`. */
  attachments?: string[];
}

/**
 * Single source of truth for sending a GHL message on a channel. Used by the per-conversation
 * reply route AND the cross-channel send route so both behave identically. GHL routes by
 * contactId + type (creating the channel conversation if needed), which is what makes
 * "reply on Instagram / SMS / Email / FB / TikTok" work flawlessly and cross-channel send possible.
 */
export async function sendGhlMessage(opts: SendMessageOpts): Promise<unknown> {
  const sendType = toGHLSendType(opts.type);
  const attachments = (opts.attachments ?? []).filter((u) => typeof u === "string" && u.trim());
  const payload: Record<string, unknown> = {
    type: sendType,
    contactId: opts.contactId,
    message: (opts.message ?? "").trim(),
  };
  if (opts.conversationId) payload.conversationId = opts.conversationId;
  if (attachments.length) payload.attachments = attachments;
  if (sendType === "Email") {
    if (opts.html?.trim()) payload.html = opts.html.trim();
    if (opts.subject?.trim()) payload.subject = opts.subject.trim();
    if (opts.cc?.trim()) payload.emailTo = opts.cc.trim(); // GHL uses emailTo for CC-style addressing
    if (opts.bcc?.trim()) payload.bcc = opts.bcc.trim();
  }
  return ghl.post(`/conversations/messages`, payload);
}
