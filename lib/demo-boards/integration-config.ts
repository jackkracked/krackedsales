/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO BOARDS — INTEGRATION SEAM  ("the Gage seam")  ·  ALIGNED to gage-Kracked/kracked-demos
 * ════════════════════════════════════════════════════════════════════════════
 *
 * EVERY external-integration specific lives here so feature code never hard-codes a
 * ClickUp field id, a Slack channel, a message template, or a naming rule. The
 * values below are now ALIGNED to Gage's `kracked-demos` repo so our boards land in
 * the SAME ClickUp DEMOS pipeline he watches, with the same conventions. Every value
 * stays env-overridable; the defaults match his repo exactly.
 *
 * Search for `// GAGE:` to see each value and its source in his repo.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ─── ClickUp ────────────────────────────────────────────────────────────────

export const clickupConfig = {
  /** The DEMOS list. GAGE: poll.js LIST_ID = 901702473428 (same list our app already uses). */
  demoListId: () => process.env.CLICKUP_DEMO_LIST_ID || "901702473428",

  /** Workspace/team id (for building task links). GAGE: tally.js links use 25582702. */
  workspaceId: () => process.env.CLICKUP_WORKSPACE_ID || "25582702",

  /**
   * The custom field that holds the board's live URL on the demo task.
   * GAGE: poll.js PSD_FIELD_ID — the "page url" field we write OUR board URL into.
   */
  boardLinkFieldId: () => process.env.CLICKUP_BOARD_LINK_FIELD_ID || "ec707ae9-2bb8-4f7f-afd6-218f188dfbcf",

  /** GAGE: tally.js BRAND_HUB field (used in his "needs attention" check). */
  brandHubFieldId: () => process.env.CLICKUP_BRAND_HUB_FIELD_ID || "9b7ee613-0765-4897-8c28-29bd7efb3cc4",

  /** GAGE: tally.js COPY_DOC field. */
  copyDocFieldId: () => process.env.CLICKUP_COPY_DOC_FIELD_ID || "65a2e565-7550-43d8-92ee-5683621d9a82",

  /**
   * Exact ClickUp status STRINGS (the API matches the lowercase status name).
   * GAGE pipeline: copy → design → (copy/design revision needed) → internal qa review → scheduled/live (+ on hold).
   * Our lifecycle drives: "Send for review" → internal qa review; "Send to client" → scheduled/live.
   */
  stages: {
    newRequest: "copy",
    inDesign: "design",
    inReview: "internal qa review", // "Send for review" lands here
    sentToClient: "scheduled/live", // "Send to client" lands here
    onHold: "on hold",
  },

  /** The demo task is named "{Brand}: Email Demo" (GAGE: poll.js `.includes(': email demo')`). */
  demoTaskMarker: ": email demo",

  /** Whether to mirror prospect comments onto the demo task as ClickUp comments. */
  mirrorCommentsToTask: true,
} as const;

/** Brand name from a demo task title: "{Brand}: Email Demo" → "{Brand}". */
export function brandFromTaskName(taskName: string): string {
  return (taskName.split(":")[0] || "").trim();
}

/**
 * Email type from a sibling task "{Brand}: {Type} Email". GAGE: poll.js derives the
 * type from a sibling task, stripping a trailing "email".
 */
export function emailTypeFromSibling(siblingName: string | undefined): string {
  if (!siblingName) return "Email";
  return (
    siblingName.split(":").slice(1).join(":").trim().replace(/\s*email\s*$/i, "").trim() || "Email"
  );
}

// ─── GHL booking (the shared intro-call calendar) ────────────────────────────
//
// GAGE: poll.js BOOKING_BASE = the shared LeadConnector "email-design-demo-intro-call"
// widget; tally.js counts bookings off GHL calendar M76E0edO2ZfonEXiQ5bf. Our inline
// booking books onto this SAME shared calendar (per Jack: his calendar, inline + branded).

export const ghlBookingConfig = {
  locationId: () => process.env.GHL_LOCATION_ID || "qg7S6Yx9XxcRKUYZpjsi",
  sharedCalendarId: () => process.env.GHL_DEMO_CALENDAR_ID || "M76E0edO2ZfonEXiQ5bf",
  widgetSlug: "email-design-demo-intro-call",
} as const;

/** Gage's UTM-tagged booking widget URL (kept for parity / fallback links). */
export function bookingWidgetUrl(slug: string): string {
  const base = `https://api.leadconnectorhq.com/widget/bookings/${ghlBookingConfig.widgetSlug}`;
  return `${base}?utm_source=demo_page&utm_medium=email_demo&utm_campaign=${slug}&utm_content=book_call`;
}

// ─── Slack (two channels via incoming webhooks) ──────────────────────────────
//
// GAGE: poll.js/tally.js post to a DESIGN channel (C069HBWAGAH) and a SALES channel
// (C0AUWSHDGF9) via incoming webhooks, and DM Gage (U013TBC8TFH) on failures.

export const slackConfig = {
  designWebhookUrl: () =>
    process.env.SLACK_WEBHOOK_DESIGN || process.env.SLACK_DEMO_BOARDS_WEBHOOK_URL || "",
  salesWebhookUrl: () => process.env.SLACK_WEBHOOK_SALES || "",
  gageUid: () => process.env.SLACK_GAGE_UID || "U013TBC8TFH",
  channels: { design: "C069HBWAGAH", sales: "C0AUWSHDGF9" },

  messages: {
    newDemoRequest: (brand: string, emailType: string, pageUrl: string, taskUrl: string) =>
      `:new: *New demo request*\n\n*${brand}* — ${emailType} Email\n<${pageUrl}|View demo> · <${taskUrl}|ClickUp task>`,
    readyForReview: (client: string, rep: string, url: string) =>
      `:mag: *Ready for QA review*\n\n*${client}* — ${rep}\n<${url}|View demo>`,
    sentToClient: (client: string, channel: string) =>
      `:incoming_envelope: *Demo sent* to *${client}* via ${channel}.`,
    prospectCommented: (client: string, snippet: string, url: string) =>
      `:speech_balloon: *${client} left a comment* — "${snippet}". <${url}|Open board>`,
    booked: (client: string, rep: string) =>
      `:calendar: *Call booked from a demo board* — ${client} → ${rep}.`,
  },
} as const;

// ─── Google Drive (optional per-brand asset folder, parity with Gage) ────────
// GAGE: poll.js createDriveFolder under GDRIVE_PARENT_ID. Optional — our designs live
// in Blob; the Drive folder is for designers' working files.
export const gdriveConfig = {
  parentFolderId: () => process.env.GDRIVE_PARENT_ID || "1VQ4Q5LJnBTds3MLLzlXmrUf5LptUK0KI",
  enabled: () => !!process.env.GDRIVE_ACCESS_TOKEN,
} as const;

// ─── Naming / copy ──────────────────────────────────────────────────────────

/** Public board URL slug from the client/company name. e.g. "Drink Steamy" → "drinksteamy". */
export function boardSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  return base || "demo";
}

/**
 * Human reference code shown in the board footer + internal lists.
 * GAGE (exact): `DEMO·{slug[:6].UPPER}·{today.replace(/\s/g,'').slice(0,4)}` where today is
 * "DD Mon YYYY" (en-US). e.g. "DEMO·STEAMY·15Ju". Faithful to his output, including his
 * 4-char date slice. (Change the slice to 5 if we ever want the cleaner "·15Jun".)
 */
export function referenceCode(name: string, now: Date = new Date()): string {
  const sl = boardSlug(name);
  const today = now.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
  return "DEMO·" + sl.slice(0, 6).toUpperCase() + "·" + today.replace(/\s/g, "").slice(0, 4);
}

/** Copy shown on the board's design panel until the designer uploads. GAGE: matches his builtin placeholder. */
export const PLACEHOLDER_TITLE = "Design on its way";
export const PLACEHOLDER_BODY = "This email design is being finalized. It will appear here automatically.";

/** The public base path for a board. e.g. /board/<token>. */
export const BOARD_PATH = "/board";
