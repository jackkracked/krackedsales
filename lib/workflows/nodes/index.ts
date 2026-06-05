import { interpolateConfig, evaluateCondition } from "../interpolate";
import { db } from "@/lib/db";
import { tasks, slackSettings } from "@/lib/db/schema";
import { Resend } from "resend";
import { ghl, locationId } from "@/lib/ghl/client";

export interface NodeContext {
  config: Record<string, unknown>;
  input: Record<string, unknown>;
  context: Record<string, unknown>;
}

export interface NodeResult {
  output: Record<string, unknown>;
}

type NodeHandler = (ctx: NodeContext) => Promise<NodeResult>;

async function triggerHandler({ input }: NodeContext): Promise<NodeResult> {
  return { output: input };
}

async function sendEmailHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const cfg = interpolateConfig(config, context) as {
    to?: string; subject?: string; body?: string; fromName?: string; replyTo?: string;
  };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  const resend = new Resend(apiKey);
  const to = (cfg.to ?? "").split(",").map((e: string) => e.trim()).filter(Boolean);
  if (to.length === 0) throw new Error("action.send_email: no recipient email configured");
  const html = cfg.body?.includes("<")
    ? cfg.body
    : `<p style="font-family:sans-serif;color:#333;">${(cfg.body ?? "").replace(/\n/g, "<br/>")}</p>`;
  const { error } = await resend.emails.send({
    from: cfg.fromName
      ? `${cfg.fromName} <proposals@krackedretention.com>`
      : "Kracked Retention <proposals@krackedretention.com>",
    to,
    replyTo: cfg.replyTo ?? "gage@krackedretention.com",
    subject: cfg.subject ?? "(no subject)",
    html,
  });
  if (error) throw new Error(`Resend error: ${(error as { message: string }).message}`);
  return { output: { sent: true, to } };
}

async function sendSmsHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const cfg = interpolateConfig(config, context) as {
    contactId?: string; contactEmail?: string; message?: string;
  };
  let contactId = cfg.contactId;
  if (!contactId && cfg.contactEmail) {
    type ContactSearch = { contacts: Array<{ id: string }> };
    const result = await ghl.get<ContactSearch>(
      `/contacts/?locationId=${locationId()}&email=${encodeURIComponent(cfg.contactEmail)}`
    );
    contactId = result.contacts?.[0]?.id;
  }
  if (!contactId) throw new Error("action.send_sms: cannot resolve GHL contactId");
  if (!cfg.message) throw new Error("action.send_sms: message is required");
  type ConvSearch = { conversations: Array<{ id: string }> };
  const convResult = await ghl.get<ConvSearch>(
    `/conversations/search?locationId=${locationId()}&contactId=${contactId}`
  );
  const conversationId = convResult.conversations?.[0]?.id;
  if (!conversationId) throw new Error("action.send_sms: no conversation found for contact");
  await ghl.post(`/conversations/messages`, {
    type: "SMS",
    conversationId,
    message: cfg.message,
  });
  return { output: { sent: true, contactId } };
}

async function slackMessageHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const cfg = interpolateConfig(config, context) as {
    webhookUrl?: string; message?: string; channel?: string;
  };
  let webhookUrl = cfg.webhookUrl;
  if (!webhookUrl) {
    const [settings] = await db()
      .select({ demoWebhookUrl: slackSettings.demoWebhookUrl })
      .from(slackSettings)
      .limit(1);
    webhookUrl = settings?.demoWebhookUrl ?? undefined;
  }
  if (!webhookUrl) throw new Error("action.slack_message: no Slack webhook URL configured");
  if (!cfg.message) throw new Error("action.slack_message: message is required");
  const payload: Record<string, unknown> = { text: cfg.message };
  if (cfg.channel) payload.channel = cfg.channel;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Slack webhook failed: ${res.status}`);
  return { output: { sent: true } };
}

async function slackCreateChannelHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const cfg = interpolateConfig(config, context) as { channelName?: string; isPrivate?: string; members?: string; guestEmail?: string };
  const [settings] = await db()
    .select({ botToken: slackSettings.botToken })
    .from(slackSettings)
    .limit(1);
  const token = settings?.botToken;
  if (!token) throw new Error("action.slack_create_channel: no Slack bot token configured");
  if (!cfg.channelName) throw new Error("action.slack_create_channel: channelName is required");
  const name = cfg.channelName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  const createRes = await fetch("https://slack.com/api/conversations.create", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, is_private: cfg.isPrivate === "true" }),
  });
  const createData = (await createRes.json()) as {
    ok: boolean; channel?: { id: string; name: string }; error?: string;
  };
  if (!createData.ok && createData.error !== "name_taken") {
    throw new Error(`Slack create channel error: ${createData.error}`);
  }
  let channelId = createData.channel?.id;
  let channelName = createData.channel?.name ?? name;
  if (!channelId) {
    const listRes = await fetch(
      "https://slack.com/api/conversations.list?types=public_channel&limit=1000",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const listData = (await listRes.json()) as {
      channels?: Array<{ id: string; name: string }>;
    };
    const found = listData.channels?.find((c) => c.name === name);
    channelId = found?.id;
    channelName = found?.name ?? name;
  }
  // Invite members if specified
  if (channelId && cfg.members) {
    const entries = cfg.members.split(",").map((s) => s.trim()).filter(Boolean);
    const userIds: string[] = [];
    for (const entry of entries) {
      if (entry.includes("@")) {
        // Email — look up Slack user ID
        const lookupRes = await fetch(
          `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(entry)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const lookupData = (await lookupRes.json()) as { ok: boolean; user?: { id: string } };
        if (lookupData.ok && lookupData.user?.id) userIds.push(lookupData.user.id);
      } else if (entry.startsWith("U") || entry.startsWith("W")) {
        // Already a Slack user ID
        userIds.push(entry);
      }
    }
    if (userIds.length > 0) {
      await fetch("https://slack.com/api/conversations.invite", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channelId, users: userIds.join(",") }),
      });
    }
  }

  // Invite external guest(s) via Slack Connect — strictly guest, never added to workspace
  let guestInviteStatus: string | undefined;
  if (channelId && cfg.guestEmail) {
    const guestEmails = cfg.guestEmail
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.includes("@"));

    if (guestEmails.length > 0) {
      const guestRes = await fetch("https://slack.com/api/conversations.inviteShared", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channelId, emails: guestEmails }),
      });
      const guestData = (await guestRes.json()) as { ok: boolean; error?: string };
      if (guestData.ok) {
        guestInviteStatus = `invite_sent:${guestEmails.join(",")}`;
      } else {
        // Non-fatal — channel was created, log the reason
        console.warn(`[slack_create_channel] Guest invite failed: ${guestData.error}`);
        guestInviteStatus = `failed:${guestData.error}`;
      }
    }
  }

  // Leave the channel — bot joined automatically on creation, but we don't want it to be a visible member
  if (channelId) {
    await fetch("https://slack.com/api/conversations.leave", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: channelId }),
    });
  }

  return { output: { channelId, channelName, ...(guestInviteStatus ? { guestInviteStatus } : {}) } };
}

async function httpRequestHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const cfg = interpolateConfig(config, context) as {
    method?: string; url?: string; headers?: Record<string, string>; body?: string; timeout?: number;
  };
  if (!cfg.url) throw new Error("action.http_request: url is required");
  const controller = new AbortController();
  const timeoutMs = Math.min((cfg.timeout ?? 30) * 1000, 60000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.url, {
      method: cfg.method ?? "GET",
      headers: cfg.headers ?? {},
      body: cfg.body && cfg.method !== "GET" ? cfg.body : undefined,
      signal: controller.signal,
    });
    const responseText = await res.text();
    let responseBody: unknown = responseText;
    try { responseBody = JSON.parse(responseText); } catch { /* keep as text */ }
    return { output: { status: res.status, ok: res.ok, body: responseBody } };
  } finally {
    clearTimeout(timer);
  }
}

async function createTaskHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const cfg = interpolateConfig(config, context) as {
    title?: string; notes?: string; priority?: string; dueDate?: string;
    contactId?: string; contactName?: string; userId?: string; userName?: string;
  };
  if (!cfg.title) throw new Error("action.create_task: title is required");
  const [task] = await db()
    .insert(tasks)
    .values({
      title: cfg.title,
      notes: cfg.notes ?? null,
      priority: (cfg.priority as "low" | "medium" | "high" | "urgent") ?? "medium",
      dueDate: cfg.dueDate ? new Date(cfg.dueDate) : null,
      contactId: cfg.contactId ?? null,
      contactName: cfg.contactName ?? null,
      userId: cfg.userId ?? null,
      userName: cfg.userName ?? null,
    })
    .returning({ id: tasks.id });
  return { output: { taskId: task.id, title: cfg.title } };
}

async function setHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const cfg = interpolateConfig(config, context) as {
    pairs?: Array<{ key: string; value: string }>;
  };
  const output: Record<string, unknown> = {};
  for (const pair of cfg.pairs ?? []) {
    if (pair.key) output[pair.key] = pair.value;
  }
  return { output };
}

async function waitHandler({ config }: NodeContext): Promise<NodeResult> {
  const seconds = Math.min(Number(config.seconds ?? 5), 240);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  return { output: { waited: seconds } };
}

async function codeHandler({ config, input, context }: NodeContext): Promise<NodeResult> {
  const code = String(config.code ?? "return {};");
  // eslint-disable-next-line no-new-func
  const fn = new Function("$input", "$context", code) as (
    $input: unknown,
    $context: unknown
  ) => unknown;
  const result = await fn(input, context);
  return {
    output:
      result != null && typeof result === "object"
        ? (result as Record<string, unknown>)
        : { result },
  };
}

async function ifHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const condition = String(config.condition ?? "false");
  const result = evaluateCondition(condition, context);
  return { output: { result, branch: result ? "true" : "false" } };
}

async function switchHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const { interpolate } = await import("../interpolate");
  const value = interpolate(String(config.value ?? ""), context);
  return { output: { value, matched: value } };
}

async function ghlUpdateOpportunityHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const cfg = interpolateConfig(config, context) as {
    opportunityId?: string; pipelineId?: string; stageId?: string;
  };
  if (!cfg.opportunityId) throw new Error("action.ghl_update_opportunity: opportunityId is required");
  if (!cfg.stageId) throw new Error("action.ghl_update_opportunity: stageId is required");
  await ghl.patch(`/opportunities/${cfg.opportunityId}`, {
    pipelineStageId: cfg.stageId,
    ...(cfg.pipelineId ? { pipelineId: cfg.pipelineId } : {}),
  });
  return { output: { updated: true, opportunityId: cfg.opportunityId, stageId: cfg.stageId } };
}

async function ghlAddNoteHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const cfg = interpolateConfig(config, context) as { contactId?: string; body?: string };
  if (!cfg.contactId) throw new Error("action.ghl_add_note: contactId is required");
  if (!cfg.body) throw new Error("action.ghl_add_note: body is required");
  type NoteRes = { note: { id: string } };
  const result = await ghl.post<NoteRes>(`/contacts/${cfg.contactId}/notes`, {
    body: cfg.body,
    locationId: locationId(),
  });
  return { output: { noteId: result.note?.id, added: true } };
}

async function httpResponseHandler({ config, context }: NodeContext): Promise<NodeResult> {
  const cfg = interpolateConfig(config, context) as { status?: number; body?: string };
  return { output: { _httpResponse: true, status: cfg.status ?? 200, body: cfg.body ?? "" } };
}

export const NODE_HANDLERS: Record<string, NodeHandler> = {
  "trigger.proposal.paid":           triggerHandler,
  "trigger.proposal.signed":         triggerHandler,
  "trigger.proposal.sent":           triggerHandler,
  "trigger.proposal.created":        triggerHandler,
  "trigger.opportunity.created":     triggerHandler,
  "trigger.opportunity.stage_changed": triggerHandler,
  "trigger.opportunity.won":         triggerHandler,
  "trigger.webhook":                 triggerHandler,
  "trigger.schedule":                triggerHandler,
  "action.send_email":               sendEmailHandler,
  "action.send_sms":                 sendSmsHandler,
  "action.slack_message":            slackMessageHandler,
  "action.slack_create_channel":     slackCreateChannelHandler,
  "action.http_request":             httpRequestHandler,
  "action.create_task":              createTaskHandler,
  "action.set":                      setHandler,
  "action.wait":                     waitHandler,
  "action.code":                     codeHandler,
  "action.ghl_update_opportunity":   ghlUpdateOpportunityHandler,
  "action.ghl_add_note":             ghlAddNoteHandler,
  "action.http_response":            httpResponseHandler,
  "control.if":                      ifHandler,
  "control.switch":                  switchHandler,
};
