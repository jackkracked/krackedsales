/**
 * The default client emails, seeded on first load. Every one is fully editable in the
 * Reminders page; these are just sensible, on-brand starting points in Jack's voice
 * (warm, sharp, no fluff). Body is simple HTML paragraphs with {{variables}}; the
 * call-to-action button is structural (label here, URL wired by the engine).
 *
 * enabled: proposal reminders ship ON; invoice reminders ship PAUSED (Stripe may still
 * be sending its own — see tasks/todo.md). Transactional emails are always on.
 */

export interface ScheduleStep {
  delayDays: number;
  anchor: "sent" | "due";
}

export interface DefaultTemplate {
  key: string;
  name: string;
  kind: "reminder" | "transactional";
  subject: string;
  bodyTemplate: string;
  ctaLabel: string;
  schedule: ScheduleStep[];
  notifyRep: boolean;
  enabled: boolean;
}

const P = (html: string) =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#333;">${html}</p>`;

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "proposal_reminder",
    name: "Proposal reminder",
    kind: "reminder",
    subject: "A quick nudge on your proposal, {{client.firstName}}",
    bodyTemplate:
      P("Hi {{client.firstName}},") +
      P("Just circling back on the {{proposal.package}} we put together for you ({{proposal.value}}). It's ready whenever you are, and signing takes about a minute.") +
      P("Any questions at all, just reply to this email, I'm happy to help."),
    ctaLabel: "Review & sign",
    schedule: [
      { delayDays: 2, anchor: "sent" },
      { delayDays: 5, anchor: "sent" },
    ],
    notifyRep: true,
    enabled: true,
  },
  {
    key: "invoice_reminder",
    name: "Invoice reminder",
    kind: "reminder",
    subject: "Your invoice for {{invoice.amount}} is due, {{client.firstName}}",
    bodyTemplate:
      P("Hi {{client.firstName}},") +
      P("A quick reminder that your invoice for {{invoice.amount}} is due on {{invoice.dueDate}}. You can settle it in a few seconds using the button below.") +
      P("Thanks so much, and let me know if anything needs sorting."),
    ctaLabel: "Pay invoice",
    schedule: [
      { delayDays: 0, anchor: "due" },
      { delayDays: 3, anchor: "due" },
    ],
    notifyRep: true,
    enabled: false, // PAUSED until Jack + Gage clear the Stripe overlap
  },
  {
    key: "proposal_sent",
    name: "Proposal sent",
    kind: "transactional",
    subject: "Your proposal from Kracked Retention",
    bodyTemplate:
      P("Hi {{client.firstName}},") +
      P("Thanks for your time. Your {{proposal.package}} is ready to review and sign below ({{proposal.value}}).") +
      P("Once you've signed, we'll get everything moving. Any questions, just reply here."),
    ctaLabel: "Review & sign",
    schedule: [],
    notifyRep: false,
    enabled: true,
  },
  {
    key: "payment_receipt",
    name: "Payment receipt",
    kind: "transactional",
    subject: "Payment received, thank you {{client.firstName}}",
    bodyTemplate:
      P("Hi {{client.firstName}},") +
      P("We've received your payment of {{invoice.amount}}, thank you. Your {{proposal.package}} is now active.") +
      P("Welcome aboard, we're looking forward to getting to work."),
    ctaLabel: "",
    schedule: [],
    notifyRep: false,
    enabled: true,
  },
];
