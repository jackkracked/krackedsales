import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  numeric,
  integer,
  doublePrecision,
} from "drizzle-orm/pg-core";

/** Monthly software subscriptions — summed into the Software Cost KPI */
export const softwareCosts = pgTable("software_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  monthlyCost: doublePrecision("monthly_cost").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Global cost settings — single row, upserted on save */
export const costSettings = pgTable("cost_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  costPerEmail: doublePrecision("cost_per_email").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Sales team members — each has their own login */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Contacts who have received a demo — tracked for follow-up management */
export const followupContacts = pgTable("followup_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ghlContactId: text("ghl_contact_id").notNull().unique(),
  ghlConversationId: text("ghl_conversation_id").notNull(),
  contactName: text("contact_name").notNull(),
  demoName: text("demo_name"), // e.g. "Welcome Email"
  platform: text("platform"), // e.g. "Klaviyo"
  demoSentAt: timestamp("demo_sent_at").notNull(),
  lastResponseAt: timestamp("last_response_at"), // null = no response yet
  isConverted: boolean("is_converted").default(false).notNull(),
  channel: text("channel").notNull(), // SMS | EMAIL | INSTAGRAM | FACEBOOK
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Each follow-up message sent to a contact */
export const followupSends = pgTable("followup_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  followupContactId: uuid("followup_contact_id")
    .references(() => followupContacts.id), // nullable — old system only
  ghlContactId: text("ghl_contact_id").notNull(),
  oppId: text("opp_id"), // pipeline opportunity ID (new pipeline-driven system)
  ghlMessageId: text("ghl_message_id"),
  messageText: text("message_text").notNull(),
  templateHash: text("template_hash"), // nullable — old system only
  channel: text("channel").notNull(),
  stageName: text("stage_name"), // stage at time of send
  angle: text("angle"), // message angle label (e.g. "pattern_interrupt_observation")
  scheduledFor: timestamp("scheduled_for"), // for sequence messages
  sentAtActual: timestamp("sent_at_actual"), // when actually delivered
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  resultedInResponse: boolean("resulted_in_response").default(false).notNull(),
  resultedInConversion: boolean("resulted_in_conversion").default(false).notNull(),
});

/** Saved message templates with performance tracking */
export const messageTemplates = pgTable("message_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  bodyTemplate: text("body_template").notNull(), // e.g. "Hi {contactName}! ..."
  channel: text("channel").notNull(),
  timesSent: integer("times_sent").default(0).notNull(),
  timesResponded: integer("times_responded").default(0).notNull(),
  timesConverted: integer("times_converted").default(0).notNull(),
  responseRate: numeric("response_rate", { precision: 5, scale: 4 }), // 0.0000 to 1.0000
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Internal tasks — created from opportunity quick actions, shown on dashboard */
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  notes: text("notes"),
  dueDate: timestamp("due_date"),
  contactId: text("contact_id"),       // GHL contact ID (optional)
  contactName: text("contact_name"),   // display name
  opportunityId: text("opportunity_id"),
  completed: boolean("completed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Reply templates with conditions, A/B testing, and performance tracking */
export const replyTemplates = pgTable("reply_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  conditions: jsonb("conditions").notNull().default([]),
  abGroup: text("ab_group"),
  weight: integer("weight").notNull().default(100),
  priority: integer("priority").notNull().default(0),
  active: boolean("active").notNull().default(true),
  isWinner: boolean("is_winner").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const templateSends = pgTable("template_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").references(() => replyTemplates.id).notNull(),
  contactId: text("contact_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

export const templateResponses = pgTable("template_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  sendId: uuid("send_id").references(() => templateSends.id).notNull(),
  respondedAt: timestamp("responded_at").defaultNow().notNull(),
});

export const templateConversions = pgTable("template_conversions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sendId: uuid("send_id").references(() => templateSends.id).notNull(),
  stageReached: text("stage_reached"),
  convertedAt: timestamp("converted_at").defaultNow().notNull(),
});

/** Conversation flow — visual canvas nodes */
export const flowNodes = pgTable("flow_nodes", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // trigger | message | condition | action
  positionX: integer("position_x").notNull().default(0),
  positionY: integer("position_y").notNull().default(0),
  data: jsonb("data").notNull().default({}),
  templateId: uuid("template_id").references(() => replyTemplates.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Conversation flow — edges between nodes */
export const flowEdges = pgTable("flow_edges", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  target: text("target").notNull(),
  sourceHandle: text("source_handle"),
  targetHandle: text("target_handle"),
  label: text("label"),
  branchType: text("branch_type"), // positive | negative | followup | immediate
});

/**
 * Pipeline stage entry events — one row per time a lead enters a tracked stage.
 * Populated in two ways:
 *  1. Real-time: GHL OpportunityStageUpdate webhook → /api/webhooks/ghl
 *  2. Historical: backfill endpoint scans conversation activity messages
 *
 * Using this table (not live GHL state) means the count never decreases when a
 * lead is moved OUT of a stage — it's a permanent historical record.
 */
export const pipelineStageEvents = pgTable("pipeline_stage_events", {
  id:             uuid("id").primaryKey().defaultRandom(),
  opportunityId:  text("opportunity_id").notNull(),
  contactId:      text("contact_id"),
  pipelineId:     text("pipeline_id"),
  stageId:        text("stage_id").notNull(),
  stageName:      text("stage_name").notNull(),
  enteredAt:      timestamp("entered_at").notNull(),       // when the lead entered the stage
  source:         text("source").notNull().default("webhook"), // "webhook" | "backfill" | "manual"
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

/** Webhook event audit log — useful for debugging and replay */
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(), // "ghl" | "clickup"
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  processed: boolean("processed").default(false).notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});

/** Keyword triggers — comments containing these words create a lead */
export const keywordTriggers = pgTable("keyword_triggers", {
  id: uuid("id").primaryKey().defaultRandom(),
  keyword: text("keyword").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** KPI card order — persists drag-and-drop reordering per section */
export const kpiCardOrder = pgTable("kpi_card_order", {
  id:        uuid("id").primaryKey().defaultRandom(),
  section:   text("section").notNull(),   // "evergreen" | "northstar"
  cardKey:   text("card_key").notNull(),
  position:  integer("position").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** KPI manual overrides — one row per metric × period when user edits a value */
export const kpiOverrides = pgTable("kpi_overrides", {
  id:        uuid("id").primaryKey().defaultRandom(),
  metricKey: text("metric_key").notNull(),
  period:    text("period").notNull(),    // "2026-04" | "2026-Q1" | "2026-04-W2"
  value:     doublePrecision("value").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Slack integration settings — bot token, signing secret, channel config */
export const slackSettings = pgTable("slack_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  botToken: text("bot_token"),
  signingSecret: text("signing_secret"),
  channelId: text("channel_id"),
  channelName: text("channel_name"),
  botUserId: text("bot_user_id"),
  enabled: boolean("enabled").notNull().default(false),
  demoWebhookUrl: text("demo_webhook_url"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** AI-generated follow-up recommendations — one active record per opportunity */
export const followupRecommendations = pgTable("followup_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ghlContactId: text("ghl_contact_id").notNull(),
  oppId: text("opp_id").notNull(),
  stageName: text("stage_name").notNull(),
  type: text("type").notNull(), // 'single' | 'sequence' | 'wait'
  reasoning: text("reasoning").notNull(),
  messagesJson: jsonb("messages_json").notNull().default([]),
  status: text("status").notNull().default("pending"),
    // 'pending' | 'approved' | 'skipped' | 'dismissed' | 'replaced'
  skippedUntil: timestamp("skipped_until"), // set by skip action — hides until this time
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  actedOnAt: timestamp("acted_on_at"),
});

/** Brand category cache — persists AI-analyzed categories server-side by domain */
export const brandCategories = pgTable("brand_categories", {
  domain:     text("domain").primaryKey(),
  category:   text("category").notNull(), // "ecommerce" | "service" | "local" | "b2b" | "other"
  reason:     text("reason"),
  analyzedAt: timestamp("analyzed_at").defaultNow().notNull(),
});

/** TikTok integration settings — OAuth tokens + Business API credentials */
export const tiktokSettings = pgTable("tiktok_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  openId: text("open_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  businessAccessToken: text("business_access_token"),
  advertiserId: text("advertiser_id"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Connected Facebook Pages (and their linked Instagram accounts) — populated via OAuth */
export const metaPages = pgTable("meta_pages", {
  pageId: text("page_id").primaryKey(),
  pageName: text("page_name").notNull(),
  pageAvatar: text("page_avatar"),
  pageAccessToken: text("page_access_token").notNull(),
  instagramAccountId: text("instagram_account_id"),
  instagramHandle: text("instagram_handle"),
  instagramAvatar: text("instagram_avatar"),
  connectedAt: timestamp("connected_at").defaultNow().notNull(),
});

/**
 * Exact timestamp when each DEMO_SENT task entered "Scheduled/Live".
 * Populated via ClickUp's GET /task/{id}/time_in_status endpoint.
 * date_closed is NOT used — "Scheduled/Live" is a custom status, not a ClickUp "closed" type.
 */
export const demoSentDates = pgTable("demo_sent_dates", {
  clickupTaskId: text("clickup_task_id").primaryKey(),
  sentAt:        timestamp("sent_at").notNull(),
  fetchedAt:     timestamp("fetched_at").defaultNow().notNull(),
});

/**
 * Minutes each task has spent in its CURRENT stage.
 * From current_status.total_time.by_minute in time_in_status.
 * Updated on every backfill pass.
 */
export const demoCurrentStageTimes = pgTable("demo_current_stage_times", {
  clickupTaskId:  text("clickup_task_id").primaryKey(),
  stageName:      text("stage_name").notNull(),
  minutesInStage: integer("minutes_in_stage").notNull(),
  fetchedAt:      timestamp("fetched_at").defaultNow().notNull(),
});

/**
 * Total minutes each task has ever spent in each stage (historical).
 * From status_history[].total_time.by_minute in time_in_status.
 * Used to compute avg time per stage across all completed demos.
 * PK = "${taskId}::${stageName}" to allow simple upserts.
 */
export const demoStageTotals = pgTable("demo_stage_totals", {
  taskStageKey:   text("task_stage_key").primaryKey(), // "${taskId}::${stageName}"
  clickupTaskId:  text("clickup_task_id").notNull(),
  stageName:      text("stage_name").notNull(),
  minutesTotal:   integer("minutes_total").notNull(),
  fetchedAt:      timestamp("fetched_at").defaultNow().notNull(),
});

/**
 * Persistent mapping: ClickUp demo task → GHL contact + first call booked.
 * Populated lazily when the Demo Tracker loads DEMO_SENT tasks.
 * If ghlContactId is null after checkedAt: no GHL contact found for this brand.
 */
export const demoGhlLinks = pgTable("demo_ghl_links", {
  clickupTaskId: text("clickup_task_id").primaryKey(),
  ghlContactId:  text("ghl_contact_id"),           // null = not found in GHL
  dateSentAt:    timestamp("date_sent_at"),          // cached dateSent from ClickUp task
  firstCallAt:   timestamp("first_call_at"),         // first calendar appointment after dateSent
  linkedAt:      timestamp("linked_at").defaultNow().notNull(),
  checkedAt:     timestamp("checked_at").defaultNow().notNull(),
});

/**
 * Demo Tracker target turnaround times — single row, upserted on save.
 * All values are in days. Defaults match the original STAGE_RISK_DAYS constants.
 */
export const demoTargets = pgTable("demo_targets", {
  id:              uuid("id").primaryKey().defaultRandom(),
  copyDays:        integer("copy_days").notNull().default(2),
  designDays:      integer("design_days").notNull().default(5),
  copyRevDays:     integer("copy_rev_days").notNull().default(2),
  designRevDays:   integer("design_rev_days").notNull().default(2),
  internalQaDays:  integer("internal_qa_days").notNull().default(1),
  fulfillmentDays: integer("fulfillment_days").notNull().default(7),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});

/** Per-contact key-value custom fields — keyed by contactUid (ghl_{id} | cl_{uuid}) */
export const contactCustomFields = pgTable("contact_custom_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactUid: text("contact_uid").notNull(),
  fieldName: text("field_name").notNull(),
  fieldValue: text("field_value").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Leads captured from Meta comment trigger words — stored in our system only */
export const commentLeads = pgTable("comment_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  platform: text("platform").notNull(), // "facebook" | "instagram" | "tiktok"
  commentText: text("comment_text").notNull(),
  keyword: text("keyword").notNull(),
  commentId: text("comment_id"),
  postId: text("post_id"),
  commenterId: text("commenter_id"),
  // Editable contact info filled in after lead is captured
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  notes: text("notes"),
  contactedAt: timestamp("contacted_at"),
  demoStartedAt: timestamp("demo_started_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Unified call log — Google Meet sessions and GHL dialer calls (inbound + outbound).
 * Synced via /api/calls/sync or the sync-calls cron job.
 */
export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  callType: text("call_type").notNull(), // "meet" | "dialer"
  direction: text("direction"),          // "inbound" | "outbound" | null (Meet has no direction)
  contactId: text("contact_id"),         // GHL contact ID (may be null for orphaned calls)
  contactName: text("contact_name"),
  repEmail: text("rep_email"),           // Google email (Meet) or GHL user email (Dialer)
  repName: text("rep_name"),
  startedAt: timestamp("started_at").notNull(),
  durationSeconds: integer("duration_seconds"),
  // Meet-specific
  meetConferenceId: text("meet_conference_id").unique(), // dedup key
  meetSpaceId: text("meet_space_id"),
  transcriptAvailable: boolean("transcript_available").default(false).notNull(),
  smartNotesUrl: text("smart_notes_url"),
  // Dialer-specific
  ghlMessageId: text("ghl_message_id").unique(),         // dedup key
  ghlConversationId: text("ghl_conversation_id"),
  recordingAvailable: boolean("recording_available").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Rep calendar configuration — links a team member's Google Workspace email
 * to their GHL calendar and a display color for the calendar view.
 */
export const userCalendars = pgTable("user_calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  repName: text("rep_name").notNull(),
  repEmail: text("rep_email").notNull().unique(), // Google Workspace email
  ghlCalendarId: text("ghl_calendar_id"),
  color: text("color").notNull().default("#6366f1"), // hex color for UI
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Per-calendar booking automation rules — when a call is booked or confirmed
 * on a specific calendar, automatically move the linked opportunity to a stage.
 */
export const bookingAutomationRules = pgTable("booking_automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  ghlCalendarId: text("ghl_calendar_id").notNull(),
  calendarName: text("calendar_name").notNull(),
  trigger: text("trigger").notNull(), // "call_booked" | "call_confirmed"
  pipelineId: text("pipeline_id").notNull(),
  stageId: text("stage_id").notNull(),
  stageName: text("stage_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
