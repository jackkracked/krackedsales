/**
 * The default client emails, seeded on first load. Every one is fully editable in the
 * Reminders page; these are just sensible, on-brand starting points in Jack's voice
 * (warm, sharp, no fluff). Body is simple HTML paragraphs with {{variables}}; the
 * call-to-action button is structural (label here, URL wired by the engine).
 *
 * enabled: proposal reminders ship ON; invoice reminders ship PAUSED (Stripe may still
 * be sending its own — see tasks/todo.md). Transactional emails are always on.
 */

/**
 * One step in a reminder sequence. `delayDays` + `anchor` set WHEN it sends; the
 * optional subject/body/cta let EACH step have its own messaging (step 1 gentle,
 * step 4 firmer). When a step's messaging is blank the engine falls back to the
 * template's base subject/body/cta, so a step is never sent empty.
 */
export interface ScheduleStep {
  /** Stable id assigned at creation, never reused. Dedup keys on this, so removing or
   *  reordering a step can never re-email a client who already received it. */
  id: string;
  delayDays: number;
  anchor: "sent" | "due";
  subject?: string;
  bodyTemplate?: string;
  ctaLabel?: string;
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
      {
        id: "pr-1",
        delayDays: 2,
        anchor: "sent",
        subject: "A quick nudge on your proposal, {{client.firstName}}",
        bodyTemplate:
          P("Hi {{client.firstName}},") +
          P("Just circling back on the {{proposal.package}} we put together for you ({{proposal.value}}). It's ready whenever you are, and signing takes about a minute.") +
          P("Any questions at all, just reply to this email."),
        ctaLabel: "Review & sign",
      },
      {
        id: "pr-2",
        delayDays: 5,
        anchor: "sent",
        subject: "Still keen to get you started, {{client.firstName}}",
        bodyTemplate:
          P("Hi {{client.firstName}},") +
          P("Wanted to make sure this didn't slip through. Your {{proposal.package}} ({{proposal.value}}) is ready to sign whenever you're set.") +
          P("If anything's holding you up or you'd like to talk it through, just reply, happy to jump on a quick call."),
        ctaLabel: "Review & sign",
      },
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
      {
        id: "ir-1",
        delayDays: 0,
        anchor: "due",
        subject: "Your invoice for {{invoice.amount}} is due, {{client.firstName}}",
        bodyTemplate:
          P("Hi {{client.firstName}},") +
          P("A quick reminder that your invoice for {{invoice.amount}} is due on {{invoice.dueDate}}. You can settle it in a few seconds using the button below.") +
          P("Thanks so much, and let me know if anything needs sorting."),
        ctaLabel: "Pay invoice",
      },
      {
        id: "ir-2",
        delayDays: 3,
        anchor: "due",
        subject: "Following up on your {{invoice.amount}} invoice",
        bodyTemplate:
          P("Hi {{client.firstName}},") +
          P("Just checking this didn't get missed, your invoice for {{invoice.amount}} was due on {{invoice.dueDate}}.") +
          P("Tap below to take care of it, and if there's any issue with payment just let me know, we'll sort it."),
        ctaLabel: "Pay invoice",
      },
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
