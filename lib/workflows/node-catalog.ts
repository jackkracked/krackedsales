export interface NodeDef {
  type: string;
  label: string;
  description: string;
  category: "trigger" | "action" | "control";
  icon: string; // emoji
  color: string; // tailwind bg class for the top border
  configFields: ConfigField[];
}

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "code" | "pairs";
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  description?: string;
}

export const NODE_CATALOG: NodeDef[] = [
  // ─── TRIGGERS ───────────────────────────────────────────────────────────────
  {
    type: "trigger.proposal.paid",
    label: "Proposal Paid",
    description: "When a client pays a proposal",
    category: "trigger",
    icon: "💳",
    color: "bg-violet-500",
    configFields: [],
  },
  {
    type: "trigger.proposal.signed",
    label: "Proposal Signed",
    description: "When a client signs an agreement",
    category: "trigger",
    icon: "✍️",
    color: "bg-violet-500",
    configFields: [],
  },
  {
    type: "trigger.proposal.sent",
    label: "Proposal Sent",
    description: "When a proposal is sent to a client",
    category: "trigger",
    icon: "📤",
    color: "bg-violet-500",
    configFields: [],
  },
  {
    type: "trigger.proposal.created",
    label: "Proposal Created",
    description: "When a new proposal is created",
    category: "trigger",
    icon: "📝",
    color: "bg-violet-500",
    configFields: [],
  },
  {
    type: "trigger.opportunity.created",
    label: "New Opportunity",
    description: "When a new GHL opportunity is created",
    category: "trigger",
    icon: "⚡",
    color: "bg-violet-500",
    configFields: [],
  },
  {
    type: "trigger.opportunity.stage_changed",
    label: "Stage Changed",
    description: "When an opportunity moves to a new stage",
    category: "trigger",
    icon: "🔄",
    color: "bg-violet-500",
    configFields: [],
  },
  {
    type: "trigger.opportunity.won",
    label: "Opportunity Won",
    description: "When an opportunity is marked as Won",
    category: "trigger",
    icon: "🏆",
    color: "bg-violet-500",
    configFields: [],
  },
  {
    type: "trigger.webhook",
    label: "Custom Webhook",
    description: "Triggered by an incoming HTTP POST",
    category: "trigger",
    icon: "🔗",
    color: "bg-violet-500",
    configFields: [],
  },
  {
    type: "trigger.schedule",
    label: "Schedule",
    description: "Run on a recurring schedule",
    category: "trigger",
    icon: "🕐",
    color: "bg-violet-500",
    configFields: [
      {
        key: "cronExpression",
        label: "Cron Expression",
        type: "text",
        placeholder: "0 9 * * 1-5",
        description: "Standard cron syntax (±5 min precision)",
      },
    ],
  },

  // ─── ACTIONS — COMMUNICATION ─────────────────────────────────────────────────
  {
    type: "action.send_email",
    label: "Send Email",
    description: "Send an email via Resend",
    category: "action",
    icon: "✉️",
    color: "bg-blue-500",
    configFields: [
      { key: "to", label: "To", type: "text", placeholder: "{{trigger.contactEmail}}", required: true },
      { key: "subject", label: "Subject", type: "text", placeholder: "Subject line", required: true },
      { key: "body", label: "Body (HTML or plain text)", type: "textarea", placeholder: "<p>Hi {{trigger.contactName}},</p>", required: true },
      { key: "fromName", label: "From Name", type: "text", placeholder: "Kracked Retention" },
      { key: "replyTo", label: "Reply-To", type: "text", placeholder: "gage@krackedretention.com" },
    ],
  },
  {
    type: "action.send_sms",
    label: "Send SMS",
    description: "Send an SMS via GHL",
    category: "action",
    icon: "💬",
    color: "bg-blue-500",
    configFields: [
      { key: "contactId", label: "GHL Contact ID", type: "text", placeholder: "{{trigger.contactId}}" },
      { key: "contactEmail", label: "Contact Email (fallback lookup)", type: "text", placeholder: "{{trigger.contactEmail}}" },
      { key: "message", label: "Message", type: "textarea", placeholder: "Hi {{trigger.contactName}}!", required: true },
    ],
  },
  {
    type: "action.slack_message",
    label: "Slack Message",
    description: "Post a message to Slack",
    category: "action",
    icon: "💼",
    color: "bg-blue-500",
    configFields: [
      { key: "webhookUrl", label: "Webhook URL (optional override)", type: "text", placeholder: "Uses default from Settings" },
      { key: "message", label: "Message", type: "textarea", placeholder: "{{trigger.contactName}} just paid!", required: true },
    ],
  },
  {
    type: "action.slack_create_channel",
    label: "Create Slack Channel",
    description: "Create a new Slack channel",
    category: "action",
    icon: "📢",
    color: "bg-blue-500",
    configFields: [
      { key: "channelName", label: "Channel Name", type: "text", placeholder: "#{{trigger.contactName}}-project", required: true },
      { key: "isPrivate", label: "Visibility", type: "select", options: [{ label: "Public", value: "false" }, { label: "Private", value: "true" }], required: false },
      { key: "members", label: "Invite Members", type: "text", placeholder: "U1234567, john@example.com, {{trigger.contactEmail}}", required: false },
      { key: "guestEmail", label: "Invite Guest (External)", type: "text", placeholder: "{{contactEmail}}", required: false, description: "Sends a Slack Connect invite — client joins as an external guest, never added to your workspace." },
    ],
  },
  {
    type: "action.http_request",
    label: "HTTP Request",
    description: "Make an arbitrary HTTP call",
    category: "action",
    icon: "🌐",
    color: "bg-blue-500",
    configFields: [
      {
        key: "method",
        label: "Method",
        type: "select",
        options: [
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
          { value: "PATCH", label: "PATCH" },
          { value: "DELETE", label: "DELETE" },
        ],
        required: true,
      },
      { key: "url", label: "URL", type: "text", placeholder: "https://api.example.com/endpoint", required: true },
      { key: "body", label: "Body (JSON)", type: "textarea", placeholder: '{"key": "{{trigger.value}}"}' },
      { key: "timeout", label: "Timeout (seconds)", type: "number", placeholder: "30" },
    ],
  },

  // ─── ACTIONS — DATA ──────────────────────────────────────────────────────────
  {
    type: "action.create_task",
    label: "Create Task",
    description: "Create an internal task",
    category: "action",
    icon: "✅",
    color: "bg-green-500",
    configFields: [
      { key: "title", label: "Title", type: "text", placeholder: "{{trigger.contactName}} — onboarding", required: true },
      { key: "notes", label: "Notes", type: "textarea", placeholder: "Optional notes" },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "urgent", label: "Urgent" },
        ],
      },
      { key: "contactName", label: "Contact Name", type: "text", placeholder: "{{trigger.contactName}}" },
    ],
  },
  {
    type: "action.set",
    label: "Set Variable",
    description: "Define variables for downstream nodes",
    category: "action",
    icon: "🔧",
    color: "bg-green-500",
    configFields: [
      { key: "pairs", label: "Variables", type: "pairs" },
    ],
  },
  {
    type: "action.wait",
    label: "Wait",
    description: "Pause execution (max 240s)",
    category: "action",
    icon: "⏳",
    color: "bg-green-500",
    configFields: [
      { key: "seconds", label: "Seconds", type: "number", placeholder: "5", required: true },
    ],
  },
  {
    type: "action.code",
    label: "Code",
    description: "Run custom JavaScript",
    category: "action",
    icon: "💻",
    color: "bg-green-500",
    configFields: [
      {
        key: "code",
        label: "JavaScript",
        type: "code",
        placeholder: "// $input = upstream node output\n// $context = full run context\nreturn { result: $input };",
      },
    ],
  },

  // ─── CONTROL ─────────────────────────────────────────────────────────────────
  {
    type: "control.if",
    label: "If",
    description: "Branch on a condition",
    category: "control",
    icon: "⑂",
    color: "bg-amber-500",
    configFields: [
      {
        key: "condition",
        label: "Condition",
        type: "text",
        placeholder: "{{trigger.amount}} > 1000",
        required: true,
        description: "Supports: ==, !=, >, <, >=, <=, contains, exists",
      },
    ],
  },
  {
    type: "control.switch",
    label: "Switch",
    description: "Multi-way branch",
    category: "control",
    icon: "🔀",
    color: "bg-amber-500",
    configFields: [
      { key: "value", label: "Value to match", type: "text", placeholder: "{{trigger.status}}", required: true },
    ],
  },

  // ─── SYSTEM ──────────────────────────────────────────────────────────────────
  {
    type: "action.ghl_update_opportunity",
    label: "Move Opportunity Stage",
    description: "Move a GHL opportunity to a new stage",
    category: "action",
    icon: "🎯",
    color: "bg-slate-500",
    configFields: [
      { key: "opportunityId", label: "Opportunity ID", type: "text", placeholder: "{{trigger.opportunityId}}", required: true },
      { key: "stageId", label: "Stage ID", type: "text", placeholder: "GHL stage UUID", required: true },
      { key: "pipelineId", label: "Pipeline ID (optional)", type: "text" },
    ],
  },
  {
    type: "action.ghl_add_note",
    label: "Add GHL Note",
    description: "Add a note to a GHL contact",
    category: "action",
    icon: "📋",
    color: "bg-slate-500",
    configFields: [
      { key: "contactId", label: "Contact ID", type: "text", placeholder: "{{trigger.contactId}}", required: true },
      { key: "body", label: "Note body", type: "textarea", placeholder: "{{trigger.contactName}} signed on {{trigger.signedAt}}", required: true },
    ],
  },
  {
    type: "action.http_response",
    label: "HTTP Response",
    description: "Return a response (webhook-triggered workflows only)",
    category: "action",
    icon: "↩️",
    color: "bg-slate-500",
    configFields: [
      { key: "status", label: "Status code", type: "number", placeholder: "200" },
      { key: "body", label: "Response body", type: "textarea", placeholder: '{"ok": true}' },
    ],
  },
];

export const CATEGORY_LABELS: Record<string, string> = {
  trigger: "Triggers",
  action: "Actions",
  control: "Control Flow",
};

export const CATEGORY_ORDER = ["trigger", "action", "control"];
