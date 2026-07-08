/**
 * Internal Slack notification types (the Notifications control center). Each is a row in
 * notification_rules — toggleable, with an editable Slack-mrkdwn message. New types are
 * just new entries here. Variables are per-rule (a proposal alert and a call alert have
 * different context), shown in the editor and resolved by the dispatcher.
 */
export type Recipients = "rep" | "gage" | "both";

export interface NotifVar {
  token: string;
  label: string;
  sample: string;
}

export interface NotifRuleDef {
  key: string;
  name: string;
  description: string;
  defaultRecipients: Recipients;
  defaultEnabled: boolean;
  defaultTemplate: string; // Slack mrkdwn with {{tokens}}
  variables: NotifVar[];
}

export const NOTIF_RULES: NotifRuleDef[] = [
  {
    key: "proposal_stalling",
    name: "Proposal stalling",
    description: "When a proposal reminder goes to a client who still hasn't signed, alert the team so they can follow up personally.",
    defaultRecipients: "both",
    defaultEnabled: true,
    defaultTemplate:
      "*{{client.name}}* still hasn't signed — reminder {{reminder.step}} just went out ({{proposal.value}}).\nMight be worth a personal follow-up.\n{{proposal.link}}",
    variables: [
      { token: "client.name", label: "Client name", sample: "Blake Brossman" },
      { token: "rep.name", label: "Rep name", sample: "Alice Galperin" },
      { token: "proposal.package", label: "Package", sample: "Monthly Retainer" },
      { token: "proposal.value", label: "Deal value", sample: "$4,500/mo" },
      { token: "reminder.step", label: "Which reminder", sample: "2" },
      { token: "proposal.link", label: "Proposal link", sample: "https://kracked-sales.vercel.app/p/…" },
    ],
  },
  {
    key: "call_outcome_missing",
    name: "Call outcome not set",
    description: "A call has happened but the rep hasn't logged its outcome yet. Nudge them with a link to set it.",
    defaultRecipients: "rep",
    defaultEnabled: true,
    defaultTemplate:
      "You haven't set the outcome for your call with *{{contact.name}}* ({{call.when}}).\nPlease set it here: {{call.link}}",
    variables: [
      { token: "contact.name", label: "Contact name", sample: "Youssef Essam" },
      { token: "rep.name", label: "Rep name", sample: "Alice Galperin" },
      { token: "call.when", label: "When the call was", sample: "yesterday 2:00pm" },
      { token: "call.link", label: "Set-outcome link", sample: "https://kracked-sales.vercel.app/calls" },
    ],
  },
  {
    key: "call_upcoming",
    name: "Call coming up",
    description: "Remind the rep shortly before a booked call.",
    defaultRecipients: "rep",
    defaultEnabled: true,
    defaultTemplate:
      "Upcoming call with *{{contact.name}}* {{call.when}}.\n{{call.link}}",
    variables: [
      { token: "contact.name", label: "Contact name", sample: "Youssef Essam" },
      { token: "rep.name", label: "Rep name", sample: "Alice Galperin" },
      { token: "call.when", label: "When", sample: "in 1 hour (3:00pm)" },
      { token: "call.link", label: "Call link", sample: "https://kracked-sales.vercel.app/calls" },
    ],
  },
  {
    key: "task_due",
    name: "Task due or overdue",
    description: "Slack-nudge the rep about a task due today or overdue.",
    defaultRecipients: "rep",
    defaultEnabled: true,
    defaultTemplate:
      "Task {{task.state}}: *{{task.title}}* ({{task.due}}).\n{{task.link}}",
    variables: [
      { token: "task.title", label: "Task title", sample: "Follow up with Laisha Vega" },
      { token: "rep.name", label: "Rep name", sample: "Alice Galperin" },
      { token: "task.due", label: "Due", sample: "today" },
      { token: "task.state", label: "Due or overdue", sample: "due today" },
      { token: "task.link", label: "Task link", sample: "https://kracked-sales.vercel.app/tasks" },
    ],
  },
];

export function getRuleDef(key: string): NotifRuleDef | undefined {
  return NOTIF_RULES.find((r) => r.key === key);
}
