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
  date,
  uniqueIndex,
  index,
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
  costPerAudit: doublePrecision("cost_per_audit").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Sales team members — each has their own login */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"), // "admin" | "rep"
  isActive: boolean("is_active").notNull().default(true),
  ghlUserId: text("ghl_user_id"), // links to GHL user for pipeline/calendar filtering
  commissionPct: doublePrecision("commission_pct").notNull().default(0), // % of proposal value earned as commission
  fathomApiKey: text("fathom_api_key"),  // user's Fathom API key for meeting sync
  timezone: text("timezone"), // IANA timezone e.g. "America/Los_Angeles"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Global commission settings — single row, upserted on save.
 * payoutTiming controls when a rep's commission is earned:
 *   "full_paid"       — once the full proposal amount is paid
 *   "first_instalment" — full commission on the first instalment payment
 *   "split"           — commission split pro-rata across each instalment paid
 */
export const commissionSettings = pgTable("commission_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  payoutTiming: text("payout_timing").notNull().default("full_paid"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Default permission presets per role — editable in Settings › Team.
 * One row per role × featureKey. Seeded on first migration.
 */
export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: text("role").notNull(),           // "admin" | "rep"
  featureKey: text("feature_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

/**
 * Per-user permission overrides — take precedence over role presets.
 * Only exists when a user's permission differs from their role default.
 */
export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  featureKey: text("feature_key").notNull(),
  enabled: boolean("enabled").notNull(),
});

/**
 * Monthly performance targets per sales rep — set by admin in Settings › Team.
 */
export const repTargets = pgTable("rep_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  dealsPerMonth: integer("deals_per_month").notNull().default(5),
  callsPerDay: integer("calls_per_day").notNull().default(15),
  revenueTarget: doublePrecision("revenue_target").notNull().default(0),
  demosPerMonth: integer("demos_per_month").notNull().default(8),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  contactId: text("contact_id"),           // GHL contact ID (optional)
  contactName: text("contact_name"),       // display name
  opportunityId: text("opportunity_id"),
  opportunityName: text("opportunity_name"), // denormalized for display
  userId: uuid("user_id").references(() => users.id), // nullable for backward compat
  userName: text("user_name"),             // denormalized for display
  priority: text("priority").notNull().default("medium"), // "low" | "medium" | "high"
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
  note:      text("note"),
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
 * Audit requests created from the in-app Create Audit modal.
 * Mirrors the ClickUp audit task (clickupTaskId) and links it to a GHL contact
 * so the contacts list can show audit status and the "Audit delivered" filter +
 * KPIs work. `status` starts "requested"; a daily cron flips it to "delivered"
 * when the ClickUp task is complete.
 */
export const audits = pgTable("audits", {
  clickupTaskId: text("clickup_task_id").primaryKey(),
  ghlContactId:  text("ghl_contact_id"),
  brandName:     text("brand_name"),
  website:       text("website"),
  details:       text("details"),
  status:        text("status").notNull().default("requested"), // requested | delivered
  clickupStatus: text("clickup_status"),                          // last-seen ClickUp task status
  requestedAt:   timestamp("requested_at").defaultNow().notNull(),
  deliveredAt:   timestamp("delivered_at"),
  createdBy:     uuid("created_by"),                              // app user id (nullable)
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

/**
 * Social leads captured from Meta — both trigger-word COMMENTS and DM conversations,
 * across Facebook / Instagram / TikTok. Stored in our system only; a row is inbox-only
 * and is NOT a GHL pipeline lead until a demo is submitted (see ghlContactId below).
 * (Physical table renamed comment_leads -> social_leads in migration 0020.)
 */
export const socialLeads = pgTable("social_leads", {
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
  // Set when a demo is submitted and the lead is promoted into GHL (a real pipeline
  // lead). Until demoStartedAt/ghlContactId are set, this row is inbox-only and is NOT
  // counted as a pipeline lead. The platform (facebook/instagram/tiktok) is carried onto
  // the promoted GHL entry so source attribution survives.
  ghlContactId: text("ghl_contact_id"),
  ghlOpportunityId: text("ghl_opportunity_id"),
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
  status: text("status"),                // "booked"|"confirmed"|"showed"|"noshow"|"completed" (scheduled); null for dialer
  meetingUrl: text("meeting_url"),       // Google Meet/Zoom link (GHL event address) — Fathom match key
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
  transcriptText: text("transcript_text"),
  transcriptStoredAt: timestamp("transcript_stored_at"),
  smartNotesUrl: text("smart_notes_url"),
  // Dialer-specific
  ghlMessageId: text("ghl_message_id").unique(),         // dedup key
  ghlConversationId: text("ghl_conversation_id"),
  recordingAvailable: boolean("recording_available").default(false).notNull(),
  // Fathom-specific
  fathomRecordingId: integer("fathom_recording_id").unique(), // dedup key for Fathom meetings
  fathomSummary: text("fathom_summary"),                      // markdown AI summary from Fathom
  fathomSyncedAt: timestamp("fathom_synced_at"),              // when this call was last synced from Fathom
  fathomShareUrl: text("fathom_share_url"),                   // link to view recording in Fathom
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
  conflictCalendarId: text("conflict_calendar_id").default("primary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Tracks when we last replied to a Meta/TikTok conversation.
 * Used by the reply queue to detect which conversations still need a response,
 * since those APIs don't return message direction.
 */
export const platformReplies = pgTable("platform_replies", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull(),    // "facebook" | "instagram" | "tiktok"
  externalId: text("external_id").notNull(), // recipientId or conversationId
  repliedAt: timestamp("replied_at").defaultNow().notNull(),
  responderUserId: text("responder_user_id"), // GHL user id of the rep who last replied (app-side ownership)
});

/**
 * Per-user in-app notifications — bell icon feed.
 * entityId is used for deduplication (same type + entityId won't fire twice while unread).
 */
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'new_lead' | 'call_soon' | 'deal_cold' | 'followup_overdue' | 'ab_winner'
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  entityId: text("entity_id"), // dedup key: lead ID, event ID, etc.
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * A/B test winner log — written by the followup-analyse cron when a test concludes.
 * Referenced by the A/B leaderboard for historical records.
 */
export const abTestResults = pgTable("ab_test_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  abGroup: text("ab_group").notNull(),
  winnerTemplateId: uuid("winner_template_id").references(() => replyTemplates.id),
  loserTemplateId: uuid("loser_template_id").references(() => replyTemplates.id),
  winnerSends: integer("winner_sends").notNull(),
  winnerResponses: integer("winner_responses").notNull(),
  loserSends: integer("loser_sends").notNull(),
  loserResponses: integer("loser_responses").notNull(),
  winnerRate: numeric("winner_rate", { precision: 5, scale: 4 }),
  loserRate: numeric("loser_rate", { precision: 5, scale: 4 }),
  chiSquare: numeric("chi_square", { precision: 8, scale: 4 }),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
});

/**
 * AI-extracted insights from Google Meet call transcripts.
 * Written by the calls sync job after storing transcript text.
 * Surfaced in opportunity modals and injected into follow-up AI prompts.
 */
export const callInsights = pgTable("call_insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  contactId: text("contact_id"),
  wantsText: text("wants_text"),
  objectionsText: text("objections_text"),
  nextStepsText: text("next_steps_text"),
  redFlagsText: text("red_flags_text"),
  sentimentScore: integer("sentiment_score"), // 1–5
  sentimentLabel: text("sentiment_label"),    // "positive" | "neutral" | "negative"
  suggestedOutcome: text("suggested_outcome"), // AI-suggested call disposition
  suggestedNotes: text("suggested_notes"),     // AI-drafted disposition notes
  analyzedAt: timestamp("analyzed_at").defaultNow().notNull(),
});

/**
 * Per-calendar booking automation rules — when a call is booked or confirmed
 * on a specific calendar, automatically move the linked opportunity to a stage.
 */
// ─── Proposals ────────────────────────────────────────────────────────────────

export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  title: text("title").notNull(),
  type: text("type").notNull(), // "management" | "project"
  ghlContactId: text("ghl_contact_id").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email"),
  opportunityId: text("opportunity_id"),
  createdBy: uuid("created_by").references(() => users.id),
  status: text("status").notNull().default("draft"),
    // "draft" | "sent" | "signed" | "paid" | "failed" | "void" | "overdue"
  totalAmount: doublePrecision("total_amount").notNull(), // BILLED amount (what Stripe charges, after discount)
  currency: text("currency").notNull().default("usd"),
  // Discount engine — display only. listAmount is the pre-discount full price (struck-through for the client).
  listAmount: doublePrecision("list_amount"), // null when no discount; > totalAmount when discounted
  discountType: text("discount_type"), // "percent" | "fixed"
  discountValue: doublePrecision("discount_value"),
  serviceDescription: text("service_description"),
  notes: text("notes"),
  paymentStructure: text("payment_structure").notNull(),
    // "subscription" | "single" | "instalment"
  billingInterval: text("billing_interval"),
  billingIntervalCount: integer("billing_interval_count"),
  // Auto-renew: true => recurring subscription (paymentStructure "subscription").
  // false => paid-in-full fixed term (paymentStructure "single"); covers N months, never recurs.
  autoRenew: boolean("auto_renew").notNull().default(true),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  expiresAt: timestamp("expires_at"),
  // Deposit system — for management proposals collecting upfront deposits before subscription starts
  hasDeposit: boolean("has_deposit").notNull().default(false),
  depositTotal: doublePrecision("deposit_total"), // locked to one billing cycle amount
  depositsPaidTotal: doublePrecision("deposits_paid_total").notNull().default(0),
  subscriptionCreatedAt: timestamp("subscription_created_at"),
  stripeInvoiceId: text("stripe_invoice_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeHostedUrl: text("stripe_hosted_url"),
  signedAt: timestamp("signed_at"),
  signedIp: text("signed_ip"),
  signatureData: text("signature_data"),
  signerTitle: text("signer_title"),
  additionalRates: text("additional_rates"), // JSON: [{item: string, cost: string}]
  sentAt: timestamp("sent_at"),
  paidAt: timestamp("paid_at"),
  cancelledAt: timestamp("cancelled_at"),
  lostAt: timestamp("lost_at"),
  lostReason: text("lost_reason"),
  lostBy: text("lost_by"), // user name who marked it lost
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const proposalInstalments = pgTable("proposal_instalments", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  instalmentNumber: integer("instalment_number").notNull(),
  stripeInvoiceId: text("stripe_invoice_id"),
  stripeHostedUrl: text("stripe_hosted_url"),
  amount: doublePrecision("amount").notNull(),
  dueDate: timestamp("due_date").notNull(),
  status: text("status").notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  isDeposit: boolean("is_deposit").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const stripeCustomers = pgTable("stripe_customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  ghlContactId: text("ghl_contact_id").notNull().unique(),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const stripeEvents = pgTable("stripe_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export const agreementTemplates = pgTable("agreement_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull().unique(), // "management" | "project"
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Booking automation ───────────────────────────────────────────────────────

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

/**
 * Call disposition records — reps must set an outcome for every booked
 * GHL calendar event before it clears from their dashboard.
 * Outcomes are stored here; notes are also pushed to GHL contact notes.
 */
export const callDispositions = pgTable("call_dispositions", {
  id: uuid("id").primaryKey().defaultRandom(),
  calendarEventId: text("calendar_event_id").notNull().unique(), // GHL event ID, dedup key
  contactId: text("contact_id"),      // GHL contact ID (used to push notes)
  contactName: text("contact_name"),  // snapshot for display/reporting
  repEmail: text("rep_email"),        // which rep owned this event
  outcome: text("outcome").notNull(), // "no_show" | "closed" | "preparing_proposal" | "rebooked" | "not_interested" | "follow_up"
  notes: text("notes"),              // saved locally + pushed to GHL notes if provided
  dispositionedAt: timestamp("dispositioned_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* ── Power Dialer ────────────────────────────────────────────────────────────
 * Twilio-backed dialer. A campaign holds a queue of contacts; assigned reps work
 * it with an atomic claim + per-contact lock so two reps never dial the same
 * person. Additive + idempotent. Twilio settings/numbers + the `calls`/
 * dispositions extensions land in a later migration when the calling layer is wired.
 */
export const dialerCampaigns = pgTable("dialer_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  ownerScope: text("owner_scope").notNull().default("admin"), // "admin" | "rep"
  maxAttempts: integer("max_attempts").notNull().default(3),
  status: text("status").notNull().default("active"), // "active" | "paused" | "archived"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Reps assigned to a campaign (1..n). A rep-created campaign has just themselves. */
export const dialerCampaignReps = pgTable("dialer_campaign_reps", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => dialerCampaigns.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqRep: uniqueIndex("dialer_campaign_reps_campaign_user_key").on(t.campaignId, t.userId),
}));

/** A contact in a campaign's queue. `position` = FIFO order; `status` drives the
 *  claim-next engine; `lockedBy`/`lockedAt` guarantee no double-dial. */
export const dialerCampaignContacts = pgTable("dialer_campaign_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => dialerCampaigns.id, { onDelete: "cascade" }),
  contactId: text("contact_id").notNull(),   // GHL contact ID
  contactName: text("contact_name"),
  phone: text("phone"),
  position: integer("position").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  status: text("status").notNull().default("queued"), // queued|in_progress|completed|exhausted|suppressed
  lockedByUserId: uuid("locked_by_user_id").references(() => users.id),
  lockedAt: timestamp("locked_at"),
  lastOutcome: text("last_outcome"),
  lastAttemptAt: timestamp("last_attempt_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqContact: uniqueIndex("dialer_campaign_contacts_campaign_contact_key").on(t.campaignId, t.contactId),
  queueIdx: index("dialer_campaign_contacts_queue_idx").on(t.campaignId, t.status, t.position),
}));

/**
 * AI-generated call preparation briefs — cached per calendar event.
 * Generated on-demand or pre-generated via cron for calls within 48 hours.
 * callType is determined by disposition history: "intro" if no prior non-no-show
 * dispositions exist, "follow_up" otherwise.
 */
export const callPreps = pgTable("call_preps", {
  id: uuid("id").primaryKey().defaultRandom(),
  calendarEventId: text("calendar_event_id").notNull().unique(),
  contactId: text("contact_id").notNull(),
  contactName: text("contact_name"),
  callType: text("call_type").notNull(), // "intro" | "follow_up"
  status: text("status").notNull().default("pending"), // "pending" | "generating" | "ready" | "failed"
  sections: jsonb("sections"), // structured JSON with all prep sections
  failedSections: jsonb("failed_sections").default([]), // array of section names that failed
  generatedAt: timestamp("generated_at"),
  expiresAt: timestamp("expires_at"), // prep becomes stale after this
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Full-text message index — powers inbox search across all channels */
export const messageIndex = pgTable("message_index", {
  id: text("id").primaryKey(), // GHL/Meta message ID
  conversationId: text("conversation_id").notNull(),
  contactId: text("contact_id"),
  contactName: text("contact_name"),
  body: text("body").notNull(),
  channel: text("channel").notNull(), // 'ghl' | 'sms' | 'email' | 'tiktok' | 'meta'
  direction: text("direction"), // 'inbound' | 'outbound'
  dateAdded: timestamp("date_added"),
  indexedAt: timestamp("indexed_at").defaultNow(),
});

/**
 * Activity event log — every meaningful user action in the app.
 * Used for per-entity timelines, global activity feed, and future AI/analytics.
 */
export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  userEmail: text("user_email").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  entityName: text("entity_name"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Per-user dashboard KPI selections — which 3 metrics each user has pinned */
export const dashboardKpiPrefs = pgTable("dashboard_kpi_prefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  selectedKeys: text("selected_keys").array().notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Weekly AI Summaries ─────────────────────────────────────────────────────

/** AI-generated weekly summaries — one per user per week, generated Monday 6am */
export const weeklySummaries = pgTable("weekly_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  weekStart: timestamp("week_start").notNull(), // Monday 00:00 of the summarised week
  content: text("content").notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

// ─── KPI Health Log ─────────────────────────────────────────────────────────

/** Tracks the health/status of each KPI data source on every fetch */
export const kpiHealthLog = pgTable("kpi_health_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  metricKey: text("metric_key").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  value: doublePrecision("value"),
  sourceStatus: text("source_status").notNull(), // "healthy" | "degraded" | "error"
  errorMessage: text("error_message"),
  responseTimeMs: integer("response_time_ms"),
  sourceSystem: text("source_system").notNull(), // "stripe" | "ghl" | "meta" | "local_db" | "computed"
});

// ─── Workflow Builder ─────────────────────────────────────────────────────────

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
  listenMode: boolean("listen_mode").notNull().default(false),
  nodes: jsonb("nodes").notNull().default([]),
  edges: jsonb("edges").notNull().default([]),
  viewport: jsonb("viewport"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  triggerEvent: text("trigger_event").notNull(),
  triggerData: jsonb("trigger_data"),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  error: text("error"),
});

export const workflowRunLogs = pgTable("workflow_run_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  nodeName: text("node_name"),
  status: text("status").notNull(),
  inputData: jsonb("input_data"),
  outputData: jsonb("output_data"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
});

export const workflowWebhooks = pgTable("workflow_webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── GHL Data Independence ────────────────────────────────────────────────────

/** Local copy of GHL pipelines — synced via /api/ghl/sync */
export const localPipelines = pgTable("local_pipelines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  stages: jsonb("stages").notNull().default([]),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Local copy of GHL contacts — synced via /api/ghl/sync */
export const localContacts = pgTable("local_contacts", {
  id: text("id").primaryKey(),
  locationId: text("location_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  fullName: text("full_name"),
  email: text("email"),
  phone: text("phone"),
  tags: jsonb("tags").default([]),
  source: text("source"),
  assignedUserId: text("assigned_user_id"),
  customFields: jsonb("custom_fields").default([]),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  companyName: text("company_name"),
  website: text("website"),
  dnd: boolean("dnd").default(false),
  rawData: jsonb("raw_data"),
  createdAtGhl: timestamp("created_at_ghl"),
  updatedAtGhl: timestamp("updated_at_ghl"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Local copy of GHL opportunities — synced via /api/ghl/sync */
export const localOpportunities = pgTable("local_opportunities", {
  id: text("id").primaryKey(),
  contactId: text("contact_id"),
  pipelineId: text("pipeline_id"),
  pipelineStageId: text("pipeline_stage_id"),
  pipelineName: text("pipeline_name"),
  stageName: text("stage_name"),
  name: text("name"),
  status: text("status"),
  monetaryValue: doublePrecision("monetary_value"),
  assignedTo: text("assigned_to"),
  source: text("source"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  contactTags: jsonb("contact_tags").default([]),
  contactCompanyName: text("contact_company_name"),
  contactDateAdded: timestamp("contact_date_added"),
  lastStageChangeAt: timestamp("last_stage_change_at"),
  rawData: jsonb("raw_data"),
  createdAtGhl: timestamp("created_at_ghl"),
  updatedAtGhl: timestamp("updated_at_ghl"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Local copy of GHL conversations — synced via /api/ghl/sync */
export const localConversations = pgTable("local_conversations", {
  id: text("id").primaryKey(),
  contactId: text("contact_id"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  lastMessageBody: text("last_message_body"),
  lastMessageDate: timestamp("last_message_date"),
  unreadCount: integer("unread_count").default(0),
  type: text("type"),
  assignedTo: text("assigned_to"),
  // Last rep to *personally* respond (GHL user id), used to scope each rep's
  // dashboard to their own threads. Set only for human replies (not automation).
  lastResponderUserId: text("last_responder_user_id"),
  lastRespondedAt: timestamp("last_responded_at"),
  lastRespondedSource: text("last_responded_source"),
  inbox: boolean("inbox").default(true),
  starred: boolean("starred").default(false),
  rawData: jsonb("raw_data"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Local copy of GHL messages — synced via /api/ghl/sync */
export const localMessages = pgTable("local_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  contactId: text("contact_id"),
  direction: text("direction"),
  type: text("type"),
  body: text("body"),
  subject: text("subject"),
  status: text("status"),
  source: text("source"),
  sentByUserId: text("sent_by_user_id"), // GHL user id of the sender, when GHL provides it
  attachments: jsonb("attachments").default([]),
  rawData: jsonb("raw_data"),
  messageDate: timestamp("message_date"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

/** Audit log for GHL sync operations — one row per sync run per entity type */
export const ghlSyncLog = pgTable("ghl_sync_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  entity: text("entity").notNull(),
  status: text("status").notNull(),
  totalRecords: integer("total_records"),
  syncedRecords: integer("synced_records"),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// ─── KPI System ──────────────────────────────────────────────────────────────

/**
 * Offer funnels — configurable metric groups mapped to GHL pipelines.
 * Each funnel tracks leads, calls, demos, audits, proposals, and ad spend
 * for its assigned pipelines, filtered by campaign name prefix.
 */
export const offerFunnels = pgTable("offer_funnels", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  pipelineIds: jsonb("pipeline_ids").notNull().default([]), // string[] of GHL pipeline IDs
  campaignFilter: text("campaign_filter"), // e.g. "FDF" — matches Meta/TikTok campaign names
  adPlatform: text("ad_platform").notNull().default("meta"), // "meta" | "tiktok" | "both"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Manual expense entries — name + amount + month.
 * Used for Total Expenses and Net P/L until QuickBooks integration.
 */
export const manualExpenses = pgTable("manual_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  amount: doublePrecision("amount").notNull(),
  month: text("month").notNull(), // "YYYY-MM" period
  category: text("category"), // optional grouping
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * KPI visibility — which metrics are shown/hidden per section.
 * Shared across all users (admin-configured, not per-user).
 */
export const kpiVisibility = pgTable("kpi_visibility", {
  id: uuid("id").primaryKey().defaultRandom(),
  section: text("section").notNull(), // "business" | "management" | "project" | "sales"
  metricKey: text("metric_key").notNull(),
  visible: boolean("visible").notNull().default(true),
  position: integer("position").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Daily snapshots for point-in-time KPIs (e.g. open pipeline value) whose source
 * system keeps no history. Written once a day by /api/cron/snapshots and read
 * back as an as-of trend. Self-created at runtime via CREATE TABLE IF NOT EXISTS
 * (see lib/kpi/snapshots.ts) so deploys need no manual migration.
 */
export const metricSnapshots = pgTable("metric_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  metricKey: text("metric_key").notNull(),
  capturedDate: date("captured_date").notNull(), // one row per metric per day
  value: doublePrecision("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("metric_snapshots_key_date_uq").on(t.metricKey, t.capturedDate),
]);

// ─── Demo Boards ────────────────────────────────────────────────────────────────
// Branded, hosted demo board per prospect (replaces the bare Miro board).

export const demoBoards = pgTable("demo_boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),          // tokenized public link (identifies the prospect)
  slug: text("slug").notNull(),                      // human URL piece, e.g. "drinksteamy"
  referenceCode: text("reference_code").notNull(),   // DEMO-DRINKS-0613
  // Linkage
  clickupTaskId: text("clickup_task_id"),            // the demo task this board belongs to
  ghlContactId: text("ghl_contact_id"),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email"),
  repId: uuid("rep_id").references(() => users.id),         // owning rep (for routing + attribution)
  designerId: uuid("designer_id").references(() => users.id),
  // Presentation
  title: text("title"),                              // e.g. "Welcome" email type
  builtOn: text("built_on"),                         // e.g. "Shopify + Klaviyo"
  // Lifecycle: created | awaiting_design | in_review | sent | opened | engaged | booked | closed
  status: text("status").notNull().default("awaiting_design"),
  // Channel the board was sent on (sms/email/meta/...)
  sentChannel: text("sent_channel"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
  bookedAt: timestamp("booked_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("demo_boards_status_idx").on(t.status),
  index("demo_boards_rep_idx").on(t.repId),
  index("demo_boards_clickup_task_idx").on(t.clickupTaskId),
]);

export const demoBoardDesigns = pgTable("demo_board_designs", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull().references(() => demoBoards.id, { onDelete: "cascade" }),
  blobUrl: text("blob_url").notNull(),               // Vercel Blob public URL
  mimeType: text("mime_type"),
  width: integer("width"),
  height: integer("height"),
  version: integer("version").notNull().default(1),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("demo_board_designs_board_idx").on(t.boardId),
]);

export const demoBoardComments = pgTable("demo_board_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull().references(() => demoBoards.id, { onDelete: "cascade" }),
  designId: uuid("design_id").references(() => demoBoardDesigns.id, { onDelete: "set null" }),
  parentId: uuid("parent_id"),                       // thread root (self-ref; nullable for top-level)
  x: doublePrecision("x"),                           // pin position (0-1 fraction of the design), null = general
  y: doublePrecision("y"),
  body: text("body").notNull(),
  authorType: text("author_type").notNull(),         // "prospect" | "team"
  authorId: uuid("author_id").references(() => users.id), // team author (null for prospect)
  authorName: text("author_name"),
  visibility: text("visibility").notNull().default("shared"), // "internal" | "shared"
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("demo_board_comments_board_idx").on(t.boardId),
]);

export const demoBoardEvents = pgTable("demo_board_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull().references(() => demoBoards.id, { onDelete: "cascade" }),
  // created | design_uploaded | sent | opened | viewed | time_on_design | scrolled_bottom |
  // reopened | forwarded | commented | booked | closed
  type: text("type").notNull(),
  actor: text("actor"),                              // "prospect" | viewer email | team user name
  metadata: jsonb("metadata"),                       // { channel, durationMs, viewerEmail, commentId, ... }
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("demo_board_events_board_idx").on(t.boardId),
  index("demo_board_events_type_idx").on(t.type),
]);

/**
 * KPI configurations — the SOURCE OF TRUTH for what each KPI on /kpis reads.
 * One row per metric key. Unconfigured metrics (no row, or enabled=false) read 0
 * (or, during migration, fall back to the legacy compute). `filters`/`aggregation`
 * are typed at the app layer (lib/kpi/engine/types.ts) and validated against the
 * dataset registry on write, so a stored config can never be malformed. Additive +
 * idempotent — safe for prod-only deploy.
 */
export const kpiConfigs = pgTable("kpi_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  metricKey: text("metric_key").notNull().unique(),
  dataset: text("dataset").notNull(),
  aggregation: jsonb("aggregation").notNull(),
  filters: jsonb("filters").notNull().default([]),
  dateField: text("date_field"),
  unit: text("unit").notNull().default("currency"),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * KPI targets — admin-set goal per metric, with a direction so the card knows
 * whether being ABOVE target is good (revenue: higher is better) or bad (costs:
 * lower is better). Independent of kpi_configs so a target works for any KPI,
 * configured or not. Additive + idempotent.
 */
export const kpiTargets = pgTable("kpi_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  metricKey: text("metric_key").notNull().unique(),
  // Legacy single target — kept and treated as the MONTHLY value for back-compat.
  target: doublePrecision("target").notNull(),
  direction: text("direction").notNull().default("higher"), // "higher" = above is good | "lower" = below is good
  // Per-cadence targets. The user sets ONE (the anchor); the others auto-derive but are
  // editable, so any may carry a bespoke override. Null = not set (engine derives a
  // run-rate when a window needs that cadence). target_monthly is backfilled from `target`.
  targetDaily: doublePrecision("target_daily"),
  targetWeekly: doublePrecision("target_weekly"),
  targetMonthly: doublePrecision("target_monthly"),
  anchorCadence: text("anchor_cadence").notNull().default("monthly"), // "daily" | "weekly" | "monthly"
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * ── CRO / "Constraint" feature (Gage's Book A Call Dashboard, as software) ──────
 *
 * weekly_funnel_log: one frozen row per week (his Tab 3 history). The live current
 * week is computed on the fly from integrations; the Monday cron FREEZES the prior
 * week here so it can never be re-curated ("log it, never curate it"). The 9 auto
 * inputs are snapshotted; `conversations` comes from conversation_events; closed/
 * revenue may carry a manual override (flagged, never silent). Additive + idempotent.
 */
export const weeklyFunnelLog = pgTable("weekly_funnel_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  weekOf: date("week_of").notNull().unique(), // Monday (UTC) the week starts
  adSpend: doublePrecision("ad_spend").notNull().default(0),
  impressions: doublePrecision("impressions").notNull().default(0),
  clicks: doublePrecision("clicks").notNull().default(0),
  leads: doublePrecision("leads").notNull().default(0),
  conversations: doublePrecision("conversations").notNull().default(0),
  callsBooked: doublePrecision("calls_booked").notNull().default(0),
  callsShowed: doublePrecision("calls_showed").notNull().default(0),
  closed: doublePrecision("closed").notNull().default(0),
  revenue: doublePrecision("revenue").notNull().default(0),
  /** Manual overrides applied to auto values, e.g. {closed: 2, revenue: 9000}. */
  overrides: jsonb("overrides").notNull().default({}),
  frozen: boolean("frozen").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * cro_benchmarks: per-stage Conservative / Good / Great ladder (his Funnel
 * Benchmarks tab). Overrides the in-code DEFAULT_BENCHMARKS so Gage can tune them.
 * Stored as fractions (0..1). One row per stage_key.
 */
export const croBenchmarks = pgTable("cro_benchmarks", {
  id: uuid("id").primaryKey().defaultRandom(),
  stageKey: text("stage_key").notNull().unique(),
  conservative: doublePrecision("conservative").notNull(),
  good: doublePrecision("good").notNull(),
  great: doublePrecision("great").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * cro_assumptions: the three blue unit-economics cells (ACV, retention months,
 * gross margin). Singleton row keyed "default". gross_margin stored as 0..1.
 */
export const croAssumptions = pgTable("cro_assumptions", {
  key: text("key").primaryKey().default("default"),
  acv: doublePrecision("acv").notNull().default(3000),
  retentionMonths: doublePrecision("retention_months").notNull().default(4),
  grossMargin: doublePrecision("gross_margin").notNull().default(0.8),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * project_statuses: per-project active/complete state. A project becomes ACTIVE
 * automatically when its project proposal is paid; it stays active until someone
 * MARKS it complete here. # Active Projects = paid project proposals minus the
 * ones marked complete. No row = active (the default for a freshly-paid project).
 */
export const projectStatuses = pgTable("project_statuses", {
  proposalId: uuid("proposal_id").primaryKey().references(() => proposals.id),
  status: text("status").notNull().default("active"), // "active" | "complete"
  completedAt: timestamp("completed_at"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * conversation_events: GHL inbound/outbound message log, the source of truth for
 * "Conversations" (leads who replied). Fed by the GHL InboundMessage webhook and
 * a backfill over /conversations/search. `message_id` is unique so a webhook +
 * backfill can't double-count the same reply. A "conversation" in the funnel =
 * a distinct contact with an INBOUND message in the period.
 */
export const conversationEvents = pgTable("conversation_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: text("message_id").notNull().unique(),
  ghlContactId: text("ghl_contact_id"),
  ghlConversationId: text("ghl_conversation_id"),
  direction: text("direction").notNull(), // "inbound" | "outbound"
  messageType: text("message_type"), // TYPE_SMS / TYPE_INSTAGRAM / ...
  occurredAt: timestamp("occurred_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("conversation_events_occurred_idx").on(t.occurredAt),
  index("conversation_events_contact_idx").on(t.ghlContactId),
]);
