# ★ TASK (2026-07-07): Branded reminder + client-email system (bridge until Workflows is ready)

Big one. Client-facing money comms. Must be phenomenally beautiful, on-brand (logo), 100% flawless.

## Locked requirements (grill ✓ 2026-07-07)
- SEND MODE: automatic, on a daily schedule (Vercel Hobby = daily cron granularity; timing is day-based).
- CADENCE: fully EDITABLE in-tool. Frequency (how many reminder steps) + delay (days) per step, per type.
  Ship a sensible default schedule, Jack edits freely, live, no code.
- EDIT SCOPE: reminders AND all client emails, editable in ONE place with dynamic-variable drag-in +
  live interpolation preview. Covers: proposal reminders, invoice reminders, the proposal-sent email,
  the payment receipt. (Signed-agreement email optional add.)
- STRIPE DUNNING: REPLACE Stripe's generic unpaid-invoice reminders with ours. Verify + turn OFF
  Stripe's account-level "Send reminders for unpaid invoices" so clients never get duplicate emails.
- REP NUDGE: when a client keeps ignoring reminders (after last step), post to #kracked-ai-sales and
  @-mention Gage Flesher (need his Slack member ID for a real <@ID> tag).
- FUTURE: this is a BRIDGE. When the Workflows page is fully functional, reminders migrate to a workflow
  action node. Build standalone now, keep the send/interpolate logic reusable so it can be lifted later.

## What already exists to build on (recon done)
- Email: lib/email/resend.ts — Resend, branded emailShell() (cream/white + logo), FROM
  proposals@krackedretention.com, LOGO_URL hosted. Existing: sendProposalLinkEmail, sendSignedAgreementEmail,
  sendPaymentReceiptEmail. Reuse the shell; make the bodies template-driven.
- Interpolation: lib/workflows/interpolate.ts — {{path.to.value}} resolver (reuse for variables).
- Cron: app/api/cron/* (GET + CRON_SECRET). vercel.json crons (daily). task-reminders is the closest pattern (dedup via notifications.entityId).
- Data: proposals (status/sentAt/signedAt/paidAt/token/contactEmail/stripeHostedUrl/totalAmount),
  proposal_instalments (amount/dueDate/status/paidAt/stripeHostedUrl/isDeposit).
- Invoices: collection_method send_invoice, days_until_due 7, auto_advance false → app must send its own.
- Settings pattern: app/(app)/settings/* + a single-row settings table + GET/POST (Slack settings is the template).
- Slack: slackSettings has botToken/channelId (#kracked-ai-sales). Reuse postToSalesChannel().

## SHAPE ✓ APPROVED (2026-07-07): own nav item "Reminders" (under AUTOMATE); styled pills (TipTap
## pill<->{{token}}); 3-zone split editor (left rail list · center subject+body+variable palette ·
## right LIVE branded preview via emailShell + sample data + "Send me a test"); reminder items also get
## a schedule strip (editable steps: frequency + delay, add/remove/reorder) + timeline + @Gage nudge
## toggle; explicit Save (no autosave) + navigate-away guard; BLOCK-SAVE guardrail (proposal reminder
## must keep Sign link, invoice reminder must keep Pay link); skeleton load; paused state.

## STRIPE DECISION (Jack, 2026-07-07): DO NOT touch Stripe at all right now. Verified live: open invoices
## have auto_advance=TRUE + recent invoice.sent events → Stripe IS currently emailing clients its own
## invoice reminders. Jack will confirm with Gage (meeting in ~1hr) because Gage may send invoices
## OUTSIDE the system + existing management clients predate it → turning off Stripe's ACCOUNT-WIDE
## reminder toggle would break those. So:
##  - Build invoice reminders FULLY but ship them PAUSED (master enabled=false); one toggle turns on later.
##  - Proposal reminders ship ON (no Stripe interaction, safe).
##  - Do NOT flip the Stripe account toggle. Do NOT change auto_advance on any invoice now (leave current
##    Stripe reminder behavior 100% intact). The invoice-reminders ON toggle shows a "Stripe may still be
##    sending its own — turn those off first" warning so Jack/Gage enable deliberately (accepts temp dupes).

## BUILD ORDER
## 1. Data model (migration 0028): email_templates (key, subject, body_template, schedule jsonb,
##    notify_rep bool, enabled bool, updated_by/at) + sent_reminders (dedup: unique(entity_id,
##    template_key, step_number) + sentAt/recipient) . Additive + idempotent.
## 2. Engine (lib/reminders/): variable catalog (plain-name -> resolver + sample), pill<->token map,
##    render.ts (interpolate + emailShell wrap), engine.ts (find-due -> render -> send -> log -> @Gage).
##    Reuse lib/email/resend.ts (emailShell) + lib/workflows/interpolate.ts + slack postToSalesChannel.
## 3. Cron app/api/cron/reminders (GET + CRON_SECRET) daily; vercel.json daily schedule. Invoice branch
##    gated on the master enabled flag. Dedup via sent_reminders.
## 4. Editor APIs: GET/PUT /api/reminders/templates (admin, whitelisted), POST /api/reminders/test (admin).
## 5. UI craft: app/(app)/reminders + components/reminders/* (the approved shape) + nav item.
## 6. SWEEP (Jack demanded): /impeccable critique -> audit -> polish -> harden.
## 7. Gate 5 (template-injection sanitize + auth) + Gate 6 (dedup/no-double-send/additive) + code review -> deploy.
## Need: Gage Flesher's Slack member ID for a real <@ID> mention (fetch via Slack users.lookupByEmail).

# ★ TASK (2026-07-08): Rep/Gage Slack reminders + proposal tracking + call-outcome reminders (PLAN)
Research done (Resend has built-in open/click tracking; email-OPEN is ~80% false positives via Apple MPP
so page-view is the reliable signal). Deliverable = plan for Jack approval, THEN build + GIFs to #kracked-software.

## F1 — Slack reminders to the REP + Gage (alongside customer reminders)
- When a reminder sends, ALSO post to #kracked-ai-sales @-mentioning the proposal's REP (createdBy->users.email->
  slackMentionForEmail) AND @Gage. Add slackMentionForRep(name,email): email lookup, fallback to users.list name
  match (reps named same in Slack). email_templates.notifyRep already exists; reword UI toggle.
- CADENCE DECISION (ask): per-send vs first+last escalation vs daily digest. (noise control)

## F2 — Proposal tracking (VIEW/CLICK reliable; email-open noisy)
- NEW table proposal_events (proposalId, token, type: sent|viewed|clicked|email_opened|signed|paid, ip, ua, meta, at).
- VIEWED (star, reliable): log server-side in app/api/proposals/public/[token] GET on page load.
- CLICKED (reliable): email CTA -> /api/proposals/track/[token] (logs clicked) -> 302 to /p/{token}.
- EMAIL_OPENED (approximate, optional): Resend webhook /api/webhooks/resend (svix-verified) + tag emails w/ proposal_id;
  label "approx" in UI (Apple MPP). ASK: include it or skip.
- UI: (a) proposals list = compact engagement indicator per row (Sent->Viewed->Signed + last-seen); (b) detail
  slide-over = per-prospect ACTIVITY TIMELINE (sent/viewed×N/clicked/signed/paid w/ timestamps); (c) optional recent-activity feed.

## F3 — Call-outcome + task reminders to the rep (Slack)
- NEW cron /api/cron/rep-reminders (daily, or 2×): find TAKEN calls (isTakenCall) >2h ago w/ NO disposition
  (LEFT JOIN call_dispositions IS NULL) -> Slack @rep "set the outcome for {contact}" + dashboard link. Dedup via a
  ledger (reuse sent_reminders idiom or notifications entityId). ASK scope: just outcome-missing vs + due-soon/task-due.

## DECISIONS (Jack, 2026-07-08): F1 cadence = PER-SEND (rep+Gage each reminder). Email-open = YES but
## ACCURATE (research done): pixel logs IP+UA+timing -> CLASSIFY prefetch (Apple 17.0.0.0/8 ASN, <Ns after
## send, generic Mozilla UA => "inbox-delivered", NOT open) vs GENUINE (later / non-Apple IP / real UA /
## repeat => real open); page-view + click are certain ground truth that trump the pixel. F3 = all 3 triggers
## (outcome-missing, call-soon, task-due) + a NOTIFICATIONS CONTROL CENTER in Settings.

## NOTIFICATIONS FRAMEWORK (new, reuses reminders template/interpolate/preview engine):
## - table notification_rules: key, name, enabled, channel('slack'), recipients('rep'|'gage'|'both'),
##   message_template (Slack mrkdwn + {{vars}}), updated_by/at. Seed 4 rules (proposal_stalling,
##   call_outcome_missing, call_upcoming, task_due). Extensible (add rows).
## - Settings -> Notifications page: per-rule toggle + editable message (vars + live Slack preview) + recipients.
## - lib/notifications/: dispatch(ruleKey, ctx) -> resolve recipients (slackMentionForRep name/email fallback +
##   Gage) -> interpolate -> postToSalesChannel. Dedup where needed.

## BUILD ORDER: 1 notif framework+settings page · 2 F1 rep+Gage per-send · 3 F2 tracking backend
## (proposal_events + viewed/clicked/classified-pixel + Resend tag/webhook optional) · 4 F2 tracking UI
## (list engagement indicator + per-prospect timeline) · 5 F3 rep reminders crons · 6 sweep+gates+deploy+GIFs.
## GATES: /impeccable shape both UIs (notifications center + tracking timeline) before JSX -> craft -> polish
## -> harden -> Gate5(pixel/webhook auth, no open-redirect on track link) + Gate6 -> code review -> deploy.

## STATUS 2026-07-07: v1 SHIPPED + swept + deployed. Engine (dedup/floor/no-Stripe/escaping) + 3-zone
## editor + daily cron LIVE. Proposal reminders ON (floor verified: 0 blast of 12 sent-unsigned).
## Invoice PAUSED. Reviews passed (staff-eng plan + security SHIP-WITH-FIXES all applied incl. lost/void
## exclusion, stale-claim retry, url hardening; UX audit tokens/a11y all applied).

## v2 REQUESTS (Jack, 2026-07-07) — building next:
## A. PER-STEP MESSAGING: each reminder step = its own editable email (subject/body/cta + delay). Model:
##    repurpose email_templates.schedule jsonb -> [{delayDays,anchor,subject,bodyTemplate,ctaLabel}];
##    backfill existing reminder rows from top-level msg. Engine: step i uses steps[i]. Editor: step tabs
##    (1st/2nd/3rd/+) within a selected reminder. Validate tokens across ALL steps at save.
## B. STOP-IF-SIGNED/PAID: ALREADY DONE + verified (engine re-checks live status each run; lost/void now
##    excluded). No new work; confirm in v2 testing.
## C. DRIP/SENT VIEW: per-step "N recipients + who" from sent_reminders. GET /api/reminders/activity?key=
##    (grouped by step: counts + recipients + status) + a UI funnel panel in the editor.
## Then: re-sweep (audit/harden) + Gate 5/6 + code review -> deploy.

---

# TASK (2026-07-05): KPI + Slack round — 4 fixes, each with its own #kracked-software GIF

Four fixes from Jack (screenshots), done fix-by-fix, each shipped then demoed with a SEPARATE
headless-rendered GIF to #kracked-software (standard broadcaster practice; open clip for Jack first).

STATUS 2026-07-05: DEPLOYED to prod (dpl_EuA4frs26aX59kyFoWPjgdeEcrv9, READY, kracked-sales.vercel.app,
commit 58e14ae). Migration 0027 applied (facebook_leads exists, 0 rows, verified queryable). Smoke:
root 307, webhook 403, subscribe-page 307 (gated), login 200. Fixes 2/3/4 LIVE. Fix 1 Facebook code
DORMANT + SAFE: New Leads config still = meta.leads (verified, unchanged); leadgen webhook gated on
verified signature so comment/DM flow untouched. Push to GitHub NOT done (local commit only; avoids the
jackkracked account dance — do later if wanted).
DEFERRED until Jack does the Facebook/Meta side (his timeline): reconnect FB (OAuth new scope
auto-subscribes leadgen) → Settings "Import recent leads" → run scripts/repoint-new-leads-config.mjs LAST.
Then New Leads shows names. GIFs: fix2/3/4 headless-rendered (web-to-video, R10N brand) + POSTED to
#kracked-software (C0AADG61BE2) via Kracked bot files.completeUploadExternal, Jack-approved. New Leads
clip (fix1-new-leads.gif) rendered + HELD at /tmp/kg until Facebook is connected (avoid showing the team
a feature that isn't live yet); post it as the launch clip then. Scenes saved at /tmp/kg/scene-*.html.

## Fix 1 — "New Leads" drawer shows lead NAMES, not campaign names
Problem: New Leads detail drawer lists rows grouped by campaign (big "DTC | FREE DEMO OFFER | Round 2 |
Max Leads", small "N leads · date"). Jack wants each row = a lead NAME (big) + the campaign it came
from (small), like the Calls Logged drawer.
Root cause: `leads` metric catalog default IS individual GHL opps (`o.name || o.contact?.name`), but
it's DB-wired to Meta `meta.leads` (per-campaign aggregate, no names). The "43" = Meta ad-reported count.
GHL opps carry `source` (funnel/campaign) -> name-big + source-small is exactly achievable (types.ts:64).
DECISION NEEDED (see check-in): switch to GHL opps (names, count may differ from Meta 43) vs keep Meta.
- [ ] (Option A) Un-wire the `leads` DB override so card + drawer use catalog `opps` (mode created)
- [ ] `app/api/kpis/detail/route.ts` case "opps": sublabel = `o.source` for created mode (name + campaign)
- [ ] Verify dashboard card + /kpis card + drawer agree on the count
Files: app/api/kpis/detail/route.ts:310-338, lib/kpi/metric-catalog.ts:152-156, KPI engine DB config.

## Fix 2 — "Calls Logged" counts only calls TAKEN, not upcoming
Problem: counts every `calls` row with `startedAt` in range incl. FUTURE booked meet calls (drawer
showed Jul 13/14/15 vs today Jul 5). Want: past meet calls that happened + dialer (in/out) connected.
Predicate (shared across all 3 loaders so card == drawer):
  meet: startedAt <= now AND status NOT IN ('noshow','cancelled')
  dialer: startedAt <= now, exclude Twilio in_progress/no-answer/busy/failed/queued/ringing; GHL dialer (past, null status) include
- [ ] app/api/dashboard/kpis/route.ts:146-151 (+ value filters 228-230 / 338-341)
- [ ] lib/kpi/engine/datasets/calls.ts:72
- [ ] app/api/kpis/detail/route.ts:285-296 (+ inPeriod gate)

## Fix 3 — Slack "New signing"/"New payment" shows Name · Package · Payment · Value
Problem: message shows only "Value: $X/mo · Rep". Want Name, Package (e.g. Monthly Retainer), Payment
(cleared now: deposit or first month), total Value. Ex: $3,500/mo retainer + $1,750 deposit -> Payment
$1,750, Value $3,500.
- [ ] Edit ONLY lib/proposals/slack-notify.ts. Package label via `amountBlockLabel(p)`; amountNow =
      hasDeposit ? (depositsPaidTotal>0 ? depositsPaidTotal : depositTotal) : totalAmount. New layout.
- [ ] Keep at-most-once paid guard; no money-movement code touched (display only).
Files: lib/proposals/slack-notify.ts:25-73,112-146; reuse lib/proposals/billing.ts.

## Fix 4 — Daily Summary "Booked Calls" + "No-Shows" stuck at 0
Problem: both use a single-DAY window; No-Shows reads a near-empty pipeline-stage table. Want both for
the MONTH; no-shows by call OUTCOMES.
- [ ] app/api/cron/daily-summary/route.ts: month window for both. Booked Calls via canonical
      `ghl.appointments` multi-calendar (matches /kpis). No-Shows = count call_dispositions where
      outcome='no_show' and dispositionedAt in month. Compute in cron; don't change shared endpoints.
Files: app/api/cron/daily-summary/route.ts:45-46,71-72,98-106; call_dispositions schema 714-725;
lib/kpi/engine/datasets/ghl.ts:177-247.

## Per fix: tsc gate -> batched deploy -> separate #kracked-software GIF (open for Jack, ask before posting).

---

# TASK (2026-07-03): Inbox manual "mark as read" (shared read-state) — replace auto-read-on-click

Trigger: clicking a message currently marks it read (Meta tab only, via localStorage `meta-seen-v2`)
→ un-replied messages vanish from unread and can't be found. Elsewhere NO real read-state exists (GHL
surfaces show GHL's own `unreadCount`; the app never writes read). Build a proper, app-owned, shared
read system. Bar: phenomenally beautiful + flawless.

Grill LOCKED (2026-07-03):
- Q1 Read-state = SHARED across the team (one marks read → read for everyone).
- Q2 Clears on: sending a REPLY (auto) OR explicit "Mark as read". A plain click/open NEVER marks read.
- Q3 App OWNS read-state (single source of truth); do NOT write back to GHL. Unread = "new inbound
  since marked read". GHL's own unread flag ignored.
- Q4 Per-row quick mark-read (hover) + multi-select (checkbox + floating action bar, reuse pipeline
  selection bar) + select-all-of-current-view. NO global "mark all read" nuke.
- Q5 Dashboard "clear" = real mark-read (clears everywhere). No dashboard-only hide.
- Q6 Scope: GHL/SMS/Email, Meta DM, Meta comment, IG-via-GHL, TikTok (build real unread; wire its
  dead toggle), BOTH queues (inbox Queue tab + dashboard Reply Queue widget), dashboard strip.
  Mark-read also DROPS the thread from both awaiting-reply queues. OUT: Follow-ups cadence tool +
  notification bell (separate systems).
- Q7 New inbound re-flags a read thread as unread. Include "Mark as UNREAD" (undo) — safety valve.

Data model (Explore map): no read-state store exists → add one. Natural shape: `readAt` (+ optional
readBy) keyed per conversation id, SHARED (not per-user), covering GHL convo ids AND Meta/TikTok/comment
ids (not all in local_conversations). Reference impl already in app: `notifications.readAt` + PATCH
/api/notifications. Unread rule: unread iff lastInboundAt > readAt (or never read).
Key files: lib/hooks/use-conversations.ts, components/inbox/{conversation-list,meta-conversations,
tiktok-conversations,reply-queue}.tsx, app/api/inbox/queue/route.ts, components/dashboard/
conversations-strip/*, components/dashboard/follow-up-queue.tsx, lib/db/schema.ts (~local_conversations)
+ new write endpoint.

Gates: grill ✓ → impeccable shape ✓ (Jack approved 2026-07-03; unread-only cleared rows ANIMATE OUT +
undo toast). NEXT: craft (staged below) → polish → harden → Gate 6 + code review → 1 batched deploy.

## CRAFT PLAN (staged — build backend first, UI second, one prod deploy at the end)
### Stage 1 — Backend read-state foundation (no UI)
- [ ] Schema: new SHARED `conversation_reads` table keyed by (platform, conversation_id) so it covers
      GHL convo ids + Meta DM/comment ids + TikTok ids uniformly. Cols: id, platform, conversation_id,
      read_at, read_by (userId, audit), created_at/updated_at. UNIQUE(platform, conversation_id).
      Migration additive + idempotent.
- [ ] Endpoint `POST /api/inbox/read` (getSessionUser-gated): body {items:[{platform,conversationId}],
      read:boolean}. Bulk. read=true → upsert read_at=now/read_by; read=false → clear (mark unread).
      Platform whitelist; non-fatal.
- [ ] Shared helper: unread iff lastInboundAt > readAt (or never read). Used by every surface + counts.
- [ ] Gate 6 self-check (additive/idempotent migration; auth-scoped writes; no mass-assign) + tsc.
### Stage 2 — Rewire unread READS to the new store (no new UI)
- [ ] use-conversations.ts (GHL): unread from read-state + lastInbound, not GHL unreadCount.
- [ ] meta-conversations.tsx: replace localStorage seenMap with server read-state; REMOVE auto-seen
      -on-click (handleSelect 1005-1017) + init bulk-seen (983-997).
- [ ] tiktok-conversations.tsx: real unread; wire the dead toggle.
- [ ] app/api/inbox/queue/route.ts: awaiting-reply AND not-read (mark-read drops from both queues).
- [ ] Tab counts + dashboard "N unread" recompute from read-state.
### Stage 3 — UI craft (the shape)
- [ ] Row affordances (conversation-list + meta + tiktok rows): leading unread DOT, hover checkbox
      (leading), mark-read/unread action (trailing, replaces timestamp on hover), tooltips.
- [ ] Multi-select: selectedIds Set + floating bar (reuse pipeline selection bar + data-r10n-
      selectionbar hooks): N selected / Mark read / Mark unread / Clear + select-all-of-view; Esc clears.
- [ ] Reply auto-marks read (send handlers / reply-composer).
- [ ] Dashboard conversations-strip: real mark-read (replace client dismissedIds) + per-row control.
- [ ] Optimistic update + query invalidation; animate cleared rows out (Framer Motion, reduced-motion
      instant); undo toast after bulk ("Marked N as read · Undo").
- [ ] Keyboard: Esc, shift-click range, e/u on focused thread. Both themes (default + R10N).
### Stage 4 — Finish
- [ ] /impeccable polish + /impeccable harden (1000+ rows, optimistic failure, shared-state race,
      empty "No unread", long names, RTL).
- [ ] Gate 6 data review + requesting-code-review (multi-file, fresh subagent) → tsc → ONE batched
      prod deploy (skew discipline) → verify live on all surfaces.

---

# TASK (2026-07-02): Payment links must NOT expire + surface signed-but-unpaid (Epicured/Fumi incident)

Trigger: Epicured (Blake, blake.brossman@gmail.com, $4,500/mo, no-deposit subscription) signed 30 Jun
but the Stripe CHECKOUT SESSION created at sign expired 1 Jul 19:19 (Stripe's 24h cap) with no
payment → 0 subscription, 0 invoice, 0 charge in Stripe (only the customer cus_Ungj8D6S72jbkr).
"Signed" != "paid". Jack: links can't expire once signed (the 24h expiry is just a sign-faster ploy).

DONE 2026-07-02 (by hand): created a durable Stripe PAYMENT LINK for Epicured
(buy.stripe.com/14A28rcTCap94ty7no4ow04, plink_1TomSk..., no expiry, subscription_data.metadata
.proposal_id set so payment reconciles) + repointed proposal.stripe_hosted_url at it. Fumi The Label
($3k, subscription+deposit) is NOT the same: its 2 deposit invoices exist + open (in_1ToCxb.. due
16 Jul, in_1ToCyA.. due 1 Aug); invoices don't expire, no action.

Systemic TODO (money-facing — own grill/plan before code):
- [ ] Sign flow (app/api/proposals/[id]/sign/route.ts ~145-180): no-deposit subscription proposals
      should generate a durable Stripe PAYMENT LINK, not a 24h checkout.sessions.create. Keep
      proposal_id on link.metadata + subscription_data.metadata (webhook reconciles via
      session.metadata AND invoice→subscription.metadata). Decide customer handling (Payment Links
      create a customer by email → dup vs the pre-made stripeCustomerId).
- [ ] Fix the misleading "View Stripe Invoice" button on subscription proposals (no invoice exists
      until they pay; today it points at the dead checkout/session URL).
- [ ] Surface "signed but NOT paid" (status/alert) so a signed client can't silently sit uncollected.

---

# TASK (2026-07-02): Fix "cash collected" KPI — book actual deposit, not full retainer

Problem: a proposal-derived "cash collected" number books proposal `totalAmount` at `paidAt`, which
overstates retainers (books a whole month / the full retainer the instant a deposit completes).
Flexible deposits widen it. GRILLED + DESIGN LOCKED 2026-07-02.

## Decisions (grill 2026-07-02)
- "Cash collected" = BUSINESS cash, not rep-specific.
- Headline "Cash Collected" (metric-catalog cash/cashCollected) = all successful Stripe charges in
  the period. ALREADY CORRECT — unchanged.
- "Revenue this month" (goal-progress) is the SAME concept → rename to "Cash Collected (this month)"
  and source from real Stripe cash for the month. Stop summing proposals.totalAmount.
- Offer funnel "Cash Collected" (kpis/offer) = ACTUAL cash on that offer's proposals: deposits
  genuinely paid + those proposals' real subscription/invoice charges, counted by CHARGE date (not
  totalAmount, not paidAt-booking). Effectively one offer (demo/free-design), so ~all proposals.
- Rep cash cards (dashboard rep-performance) + commission (rep-proposal-commission.ts, payoutTiming)
  = UNTOUCHED. DISPLAY-ONLY fix; do not change any pay logic.
- CLARITY IS A DELIVERABLE (Jack, said 3x): every number carries a plain-language definition where
  it's read (card explanation + drill-down). Exact copy below.
- Restatement accepted: numbers are live-computed, so history restates to the honest value.

## Definition copy (must appear on the cards + drill-downs)
- Headline: "All money that actually hit Stripe this period (deposits, invoices, subscription
  payments). Total business cash, not just from proposals."
- Cash Collected (this month): "Same as Cash Collected: money actually received through Stripe this month."
- Offer funnel: "Cash actually collected from this offer's proposals: deposits paid plus their
  subscription and invoice payments. Only counts money tied to a proposal, so it's usually less than
  total business Cash Collected."

## Build steps (PLAN ONLY — staff-eng plan review before code; Stripe→proposal attribution is the risk area)
- [ ] goal-progress route: replace sum(proposals.totalAmount@paidAt) with Stripe cashInRange for the
      month (reuse lib/kpi/stripe-series.ts). Rename label "Revenue this month" → "Cash Collected
      (this month)" everywhere it renders. Update definition/tooltip.
- [ ] kpis/offer: replace `cashCollected = sum(totalAmount)` with ACTUAL cash on the offer's
      proposals. Attribute succeeded Stripe charges → proposal via proposal_id metadata (deposit
      invoices set invoice.metadata.proposal_id; subscription sets metadata.proposal_id) / the
      proposal's stripeSubscriptionId / stripeCustomerId; scope by the existing contactsInPipelines
      set; sum by charge date in [start,end]. Keep `valueOfProposalsSent` as-is (correctly named).
- [ ] Clarity copy: update metric-catalog explanations + offer + goal-progress card definitions +
      drill-down text to the wording above; offer card states it's proposal-tied and < business total.
- [ ] Verify no double-count (offer cash <= headline; never summed together); check every consumer.
- [ ] Read-only attribution check against a known paid proposal (charges resolve to the right offer).
- [ ] tsc → deploy → confirm on /kpis (offer) + dashboard (Cash Collected this month). Gate 6 light
      (read-only metrics, no writes).

---

# TASK (2026-07-02): Flexible deposits + subscription start date (max flexibility)

Goal: Gage can set, per proposal: any deposit amount (or none) split into any payments/dates,
AND the date the recurring subscription's first charge lands. Deposit + subscription stay
SEPARATE (deposit does not discount the first charge). MUST be proven in Stripe SANDBOX before live.

- [x] schema: proposals.subscription_start_date (additive) + migration 0026 (applied to prod)
- [x] API proposals/route.ts: dropped "deposit must = one cycle"; depositTotal = sum; store subscriptionStartDate; +NaN guard +18-month far-future guard
- [x] deposit-billing.ts: firstChargeDate() (subscriptionStartDate else start+cycle) + clampedTrialEnd() [now+24h, now+700d] so a far-future date can NEVER fail sub creation after a deposit is collected
- [x] sign route no-deposit checkout: subscription_data.trial_end via clampedTrialEnd when set
- [x] SANDBOX HARNESS (sk_test): 61/61 assertions — deposit<month, =month(sequential/legacy), >month, no-deposit+date, far-future-clamp. Verified invoice amounts, due dates, first-charge date, independent depositTotal, recurring amount. Harness deleted from repo (never deploy).
- [x] UI create-modal: free deposit amounts + "First subscription charge" date field (max 18mo) + relaxed validation + payload
- [x] independent money-review: found + FIXED a BLOCKER (far-future date stranding a paid deposit) + should-fixes (NaN, stale comment). Legacy path unchanged (anchor removal is a fix).
- [x] backfill deposit-awareness fix (route deposit invoices through settleDeposits)
- [x] deploy → LIVE on prod (dpl lff5kmwps, Ready 2026-07-02 10:03, production alias points to it; migration 0026 column confirmed on prod DB). Blast radius: 0 real proposals have touched the new path since deploy.
- [x] RE-VERIFIED LIVE 2026-07-02 (post battery-death, fresh session): rebuilt the sandbox harness and ran the REAL settleDeposits/issueNextDepositInvoice against Stripe TEST mode. 76/76 assertions PASS across pure date-logic + 4 integration scenarios (deposit<month legacy, deposit=month legacy, deposit>month + chosen start, far-future clamp). Verified: sequential one-invoice-at-a-time, invoice amounts/currency/collection_method, no sub on partial, sub created only on full collection, trial_end = clampedTrialEnd(firstChargeDate), recurring = retainer independent of deposit. Harness self-cleaned (prod DB sentinel rows deleted, leftover 0); harness file deleted.
- [x] Committed (7e9fdfc) + pushed to origin/main (fully synced). Pushed via jackkracked gh account (default aiposuk has no write); see memory project_github_push_account.
- FLAG (RESOLVED → its own task): proposal-derived "cash collected" KPI books the full retainer at deposit-completion, not the actual deposit. Jack: fix it. Tracked as the "cash collected" KPI task at the top of this file.

---

# TASK (2026-07-02): Fix proposal/Stripe deposit billing (Gage incident)

Verified root causes (prod DB + Stripe API + code + adversarial audit):
- SYSTEMIC: Stripe webhook endpoint is DISABLED in Stripe (0 events ever) → no auto-reconcile → reps forced to use the override → bugs below. FIX: re-enable + correctly configure endpoint, match signing secret, verify.
- Bug 1: send finalizes ALL deposit invoices at once, 7-day due (send/route.ts:126-155). FIX: issue deposits ONE AT A TIME (Jack: keep split, sequential).
- Bug 2: override marks ALL deposits paid + writes full depositsPaidTotal with no Stripe check (deposit-paid/route.ts:40-47,102). FIX: reconcile against real Stripe invoices; only mark what actually cleared.
- Bug 3: trial subscription created on partial deposit (override :93; webhook gate :325 ignores amount). FIX: create sub only when full deposit genuinely collected; dedupe the one subscription builder.
- Data-model gap: instalments only have pending/paid (can't reflect Stripe void/failed). Optional follow-up.

Plan:
- [x] lib/proposals/deposit-billing.ts — one module: issueNextDepositInvoice / reconcileDeposits / createDepositSubscription / settleDeposits
- [x] Rewire send/route.ts (issue first only), webhook deposit branch (mark one + settleDeposits), deposit-paid override (honest reconcile), delete duplicated createSubscriptionForDeposit
- [x] tsc + adversarial money-code review (2 subagents): caught + fixed a double-subscription RACE (create-then-claim-then-cancel-loser), cents comparison, transient-error fallback
- [x] Re-enable Stripe webhook: OLD endpoint was DISABLED. Created new endpoint (5 correct events), rotated STRIPE_WEBHOOK_SECRET, deleted old. Verified: signed event → 200 + stored; bad sig → 400. stripe_events populating.
- [x] Deployed + verified. STILL OPEN (human/money): Lebanta record ($1.5k collected vs $3k shown, open $1.5k inst#2 invoice, trialing sub) needs Gage to reconcile. C&G/TradeFlows Stripe-verification question is separate (my Stripe calls were all read-only, one-key-one-account).

---

# TASK (2026-07-01): Proposal signed / paid → #kracked-ai-sales Slack alert

Goal: when a proposal transitions to SIGNED or PAID, the `kracked_ai` bot posts a celebratory
message to #kracked-ai-sales (channelId already configured in slack_settings). Must not disturb
any working sign/payment code. Test with a clearly-labelled [TEST] message.

Design: hook at the event-dispatch layer (`dispatchWorkflowEvent`), NOT in the Stripe webhook or
sign route → zero edits to money/sign code. Both events already dispatch there. Duplicate guard =
additive `proposals.slack_paid_notified_at` + race-safe update (paid can fire from >1 Stripe event).

- [x] Add `slackPaidNotifiedAt` column to `proposals` (schema.ts)
- [x] Migration 0025 (additive, idempotent) + applied to prod (verified column exists)
- [x] `lib/proposals/slack-notify.ts` — notifier + pure message builder (celebratory, no em dashes)
- [x] Hook `notifyProposalSlack` into `dispatchWorkflowEvent` (triggers.ts)
- [x] tsc gate (exit 0) → deployed to prod → [TEST] message landed in #kracked-ai-sales (2026-07-01)

DONE. Signed rides the existing `proposal.signed` dispatch, paid rides all 5 paid paths via
`proposal.paid`. Zero edits to the Stripe webhook / sign route. Existing demoWebhookUrl
"New client signed!" message left untouched (separate destination).

---

# ★ INITIATIVE (2026-06-27): R10N rebrand — non-destructive, toggleable, "most beautiful UI"

**Goal:** Reskin the entire app to the R10N "Brand Lab" design system, beautifully + flawlessly, WITHOUT
risk to the live app. Jack's hard constraint: current app must keep working + looking exactly as-is; the
rebrand must be instantly reversible.

**Decisions (Jack, 2026-06-27):** theme switch = ADMIN-ONLY preview · first flagship surface = DASHBOARD/HOME.

**Safety architecture:** R10N is a SECOND theme under `[data-theme="r10n"]`. Current theme stays the DEFAULT,
never edited. Admin-only switch flips it for previewers; toggle off = instant total revert. Build + perfect
behind the switch on prod, zero team disruption; flip the default only on Jack's word.

**R10N brand (from the Brand Lab PDF — token-driven, "never hardcode"):**
- Neutrals: Obsidian #000000, Graphite #1C1C21, Steel #6E7179, Mist #E9EAEE, Paper #F4F4F5, White #FFFFFF.
- Accent (signature): Signal #C7FF41, Signal-dim #A8DD30 (the one electric accent, used with discipline).
- Semantic: Positive #1FA463, Negative #D7263D, Warning #E08B00, Info #2A6FDB.
- Charts: 6-slot ordered series ramp [#000000, #A8DD30, #6E7179, #2A6FD8, #B3B5BA, #D7263D] (slot # = meaning);
  9-step neutral seq ramp (paper→obsidian) `--seq-0..8`; 7-step divergent red→green `--div-n3..p3`.
- Type: Space Grotesk (display), Inter (body), JetBrains Mono (uppercase tracked labels). Token names `--r10n-*`,
  `--chart-*`, `--positive/--negative/--warning/--info`, `--seq-*`, `--div-*`, `--shadow-flat` (hairline), radii
  SM 3.6 / MD 4.8 / LG 6 (base) / XL 8.4px. Flat shadows, dark sidebar + light content, data-dense, premium.
- Source files: ~/Downloads/r10n branding.pdf (+ .png 3456x29892) + "R10N — Master Product Document.pdf".

**Phases:** P0 Foundation (theme switch + token audit, INVISIBLE/safe) → P1 R10N token layer (full Brand Lab as
the r10n theme) → P2 surface-by-surface craft (Dashboard first; each = shape→craft→polish→harden) → P3 QA +
optional default flip. **Team (agents):** Creative Director, Design Systems Architect, Staff Design Eng x3-4,
Data-Viz Lead, Motion, A11y/Contrast Lead, QA/Release, Brand/Asset Lead.

## P0 — Foundation ✅ SHIPPED (2026-06-27, invisible by default)
- [x] Audited theming: Tailwind v4 `@theme inline` reads one `:root` in app/globals.css → a `[data-theme="r10n"]`
      override block re-skins all chrome + var()-driven charts with NO component edits. No prior theme system.
- [x] Hardcoded-colour audit: ~938 raw Tailwind status/stage utilities (amber/emerald/red/blue) bypass tokens →
      won't re-skin; many centralized in maps (lib/contacts/stage-colors.ts, lib/deal-health.ts, *_COLORS consts).
      = the Phase-2 migration, done per surface. Channel-brand marks + PDF + global-error stay literal (correct).
- [x] Admin-only theme switch SHIPPED + deployed. Fonts (Space Grotesk + JetBrains Mono) added; `[data-theme="r10n"]`
      block with full first-pass token mapping (obsidian primary, paper bg, Signal lime accent, chart/seq/div ramps,
      flat shadow, tighter radii, Space Grotesk/Inter/JetBrains fonts). Cookie `r10n_theme` + SSR on <html> (no FOUC).
      Admin-only pill bottom-left → POST /api/theme (403 for non-admins). `--font-mono-stack` indirection keeps the
      DEFAULT theme's mono unchanged. tsc clean; default :root byte-for-byte unchanged; verified before deploy.
- DEFERRED to P2 (intentional): dramatic dark/obsidian sidebar (first pass = light sidebar for legibility); wiring
  the signal/chart/seq/div tokens into components; migrating the 938 status colours. First flagship surface = Dashboard.

## P2 — Surface craft (Dashboard first; wordmark = keep "Kracked" + R10N styling, Jack 2026-06-27)
- [x] Piece 1: GLOBAL CHROME shipped (deployed). Obsidian sidebar (--sidebar #0A0A0B / fg Mist under r10n), mono
      uppercase section headers, lime active-item accent + left marker, "Kracked Sales" wordmark + lime "." dot,
      light-on-dark nav, mobile header too. Scoped via [data-theme="r10n"] + inert data-r10n-* hooks; default
      untouched (verified: :root --sidebar still #F3F0ED, all rules r10n-gated, tsc clean).
- [x] Piece 2: DASHBOARD CONTENT shipped (deployed). 16 files. Mono uppercase steel labels, big Space Grotesk
      metric numbers, flat hairline cards + more whitespace, calmed status (loud red/amber pills → restrained
      hairline chips with a single semantic accent only for real alerts), sparklines/bars → obsidian + lime ramp.
      Scoped via [data-theme="r10n"] + data-r10n-* hooks + var(--r10n-…, <original>) inline fallbacks; default
      byte-for-byte unchanged (verified: :root intact, all rules gated, tsc clean). Jack approved Piece 1 chrome.
- [x] Surface 2: PIPELINE shipped (deployed). 6 files. Board lanes flat + mono stage headers, opportunity/lead
      cards flat with Space Grotesk identity, stage/status pills calmed (data-status → lime won/open, red lost,
      amber attention; never a fill), R10N table (mono headers, hairline rows, tabular nums), obsidian selector +
      toolbar. Scoped via "R10N PIPELINE" CSS section + data-r10n-* hooks; default unchanged; tsc clean. Jack approved dashboard.
- [x] PIPELINE revision (Jack feedback: too flat, headers hard to read, wanted the deal-health glows back):
      added R10N health glows on cards (green/lime healthy+won, amber at-risk, red cold/lost/no-response — soft
      colored box-shadow + left accent, driven by the same deal-health tier the default uses), graphite legible
      mono stage headers + stronger count chips, semantic-colored status pills (tinted, not loud). Scoped, deployed.
- [x] FIX: r10n theme toggle now INSTANT (flips data-theme on <html> client-side, persists cookie in background,
      no reload). FIX: timezone-detector popup no longer nags every refresh — dismissal persists in localStorage
      keyed to the exact mismatch (resurfaces only if the mismatch changes; TZ still editable in Settings).
- [x] Surface 3: INBOX shipped (deployed). 9 files + "R10N INBOX" CSS section (105 gated blocks). Flat conversation
      rows + lime selected marker + calmed unread badges, obsidian/white message bubbles, the detect/attach chips
      restyled with the Signal lime accent (Saved=green) [chips shared w/ default modals → r10n-scoped so modals
      unaffected], flat reply composer w/ obsidian send + lime hover, both sidebars (lead + Meta) mono labels +
      flat cards + obsidian quick-action tiles. Scoped; default unchanged; tsc clean. DEFERRED: tiktok-conversations
      + reply-queue (out of brief) + channel-filter-pills (styled, not wired) — sweep on request.
- DASHBOARD + PIPELINE approved by Jack. Pattern proven; surfaces one at a time per Jack.
- [x] Surface 4: CONTACTS shipped (deployed). 5 files + "R10N CONTACTS" CSS (119 gated rules). R10N table (mono
      headers, hairline rows, Space Grotesk identity, lime selected), loud 8-color STAGE_COLORS collapsed to the
      calm data-status pill idiom, header/toolbar/filter-sheet flat+mono+lime, contact modal flat shell + calmed
      timeline/status. Added pure `stageStatus()` export in lib/contacts/stage-colors.ts (additive, inert default).
- [x] FAN-OUT BATCH 1 (parallel, merged + deployed): PROPOSALS (status badges, list table, detail slide-over,
      create wizard), CALLS (table, call-detail modal, transcript drawer), TASKS (cards/table, priority+due pills,
      checkboxes), ANALYTICS (5 Recharts cards → obsidian bars + lime line via var(--r10n-chart-*) ramp, mono axes).
      Each agent edited only its own folder + staged CSS to /tmp/r10n-parts/<surface>.css (namespaced/reused hooks);
      I brace-checked + gated-checked all 4, merged into globals.css ("R10N FAN-OUT BATCH 1"), tsc clean, deployed.
- [x] FAN-OUT BATCH 2 (parallel, merged + deployed): KPIs (configurator, health rows, funnel, detail sheet;
      shared metric-cell/section already done), DEMO-TRACKER (kpi strip + sparkline ramp, buckets, heatmap, risk
      alerts), CALENDAR (grid/day cells, event tiles + status, event panel, book-call drawer), SETTINGS (tabs,
      cards, toggles lime-on, integrations). Merged "R10N FAN-OUT BATCH 2", tsc clean, deployed. globals.css ~6030 lines.
- [x] FAN-OUT BATCH 3 (merged + deployed): ACTIVITY (feed + in-modal timeline, semantic event dots), FOLLOW-UPS
      (queue, urgency dots, recommendation cards, history), TEMPLATES (cards, A/B leaderboard, editor, flow-edge
      legend via var fallback). "R10N FAN-OUT BATCH 3", tsc clean.
- [x] FAN-OUT BATCH 4 (merged + deployed): WORKFLOWS (node canvas, BaseNode/NodePanel recolored, lime selected),
      BOARDS (demo-boards admin list + cockpit; public/* skipped), MISC (copilot FAB, fathom card, flow nodes
      var-wrapped, inbox tiktok + reply-queue tabs). "R10N FAN-OUT BATCH 4", tsc clean. globals.css ~8464 lines.
- ✅ ALL SURFACES R10N (behind the admin toggle, default untouched throughout): chrome, dashboard, pipeline,
  inbox, contacts, proposals, calls, tasks, analytics, kpis, demo-tracker, calendar, settings, activity,
  follow-ups, templates, workflows, boards + copilot/flow/tiktok/reply-queue.
- [x] FULL QA SWEEP DONE (3 senior design-QA agents, parallel): each rendered its surface group LIVE under r10n
      (admin cookie + r10n_theme=on, Playwright 1440x900) + screenshot-reviewed + fixed. Verdict: app was already
      largely clean; real leaks FIXED + deployed: KPIs pace meters (loud red/green fill → calm), demo-tracker 14d+
      late bar (saturated red → desaturated), analytics headline numbers (emerald/olive → obsidian), calls status
      pills (leftover Tailwind ring sky/emerald/rose → neutralized), flow-canvas minimap (raw blue/amber/green →
      r10n tokens), board cockpit disabled CTA (washed lime → neutral). Default intact, tsc clean.
- ONLY deliberate item left: inbox conversation avatars use the shared components/ui/avatar pastel name-hash
  colors (app-wide identity system, slightly more saturated than r10n's tints) — left as-is; calm under r10n on request.
- Public client-facing pages (proposal signing, demo-boards/public) intentionally NOT themed (external = default).
- [x] BRAND REFRESH (2026-06-28, new R10N PDF): accent LIME → BLUE. Swapped --r10n-signal #C7FF41→#2563EB,
      --r10n-signal-dim #A8DD30→#1D4ED8, --chart-2 (winner) →#1D4ED8, --chart-1 #000→#0B0B0D; all ~28 lime
      literals in globals.css → blue (components use the token, ~443 var() refs auto-updated). CONTRAST pass for the
      light→dark luminance flip: solid blue accent fills (K-mark, NEXT badge, active filter/channel pills, board +
      proposal CTAs, settings primary, comment pin) → WHITE glyph/text; blue text on the obsidian sidebar (active
      nav, wordmark dot) → lighter #5B8DEF for AA. Tints kept dark text (verified legible). Deployed; default safe; tsc clean.
- FINAL STEP (Jack's word only): flip r10n to the default theme (or keep it the admin/per-user toggle).
- DONE SURFACES: chrome, dashboard, pipeline, inbox, contacts, proposals, calls, tasks, analytics. REMAINING: KPIs,
  analytics, demo-tracker, boards, workflows, follow-ups, templates, calendar, settings. (deal-health.ts loud
  tiers now also calmed under r10n via pipeline/contacts hooks.)
- [x] FIX (Jack: stages all gray, should be distinct colors): `r10nStageColor()` gives each stage a DISTINCT R10N
      hue by family (blue/indigo/violet→info, green/teal→positive, won/proposal/sale→lime, amber→warning,
      red→negative, gray→steel) via inline `--r10n-stage` var consumed only under r10n. Applied IDENTICALLY across
      contacts table + summary bar + contact modal + pipeline list + the Move Stage modal (now R10N-themed). Default safe.
- Reference shots (Jack): real R10N Home + Campaigns (dark sidebar, mono labels, black+lime charts, flat cards).

---

# ▶ NEXT (2026-06-26): Meta inbox sidebar + demo-makes-a-lead + comment-lead gating

**Gates:** grill ✓ (4 decisions). Locked: demo from a Meta/TikTok convo → REAL GHL lead + mirrored
locally, source-tagged FB/IG/TikTok · trigger-word comments stay in inbox but NOT counted as leads
until a demo is submitted · ALL Meta convos (DM + comment, IG+FB) + TikTok get the Task/Demo/Audit
sidebar. PENDING: pipeline routing decision + shape confirm + green light.

## Reuse found
- `lib/ghl/client.ts` (Bearer GHL_PRIVATE_TOKEN, locationId from env).
- `/api/ghl/contacts/create` ALREADY creates GHL contact (+ optional opportunity w/ source/pipeline/stage). REUSE.
- `commentLeads.demoStartedAt` = the gate flag. Set today by demo-in-progress route Path B.
- Comment leads surface as pipeline leads ONLY via `/api/contacts` merge (435-484) — single gate point.
  Meta inbox uses `/api/comment-leads/inbox` (keeps showing all). `/api/comment-leads/count` also reads all.
- Demo modal: props contactId/Name/Email/Phone/opportunityId/commentLeadId/opportunitySource; infers
  Lead Source from platform string. POSTs JSON to `/api/webhooks/demo`.
- Pipelines (DEMO_IN_PROGRESS_STAGE map): AD funnel · ORGANIC funnel · Main website · Taylor's TikTok.

## Build steps (proposed — confirm first)
- [ ] 1. Schema: add `ghlContactId`, `ghlOpportunityId` to `commentLeads` (+ migration, additive). DM persistence row.
- [ ] 2. GATE: `/api/contacts/route.ts` — surface comment leads ONLY when `demoStartedAt` is set (exclude
       un-demoed from leads/pipeline/counts). Audit `/api/comment-leads/count` consumers. Inbox unchanged.
- [ ] 3. Demo→lead: on demo submit from a Meta/TikTok convo (commentLeadId OR DM identity, no existing opp),
       create GHL contact+opportunity (source=platform, pipeline per routing, stage=Demo In Progress) +
       set `demoStartedAt` + store ghlContactId/oppId on the commentLead. Mirror locally.
- [ ] 4. DM path: when a demo is submitted from a DM (no commentLeadId), persist a commentLeads row from the
       DM identity (platform + participantId + name), then same flow.
- [ ] 5. UI: Meta sidebar (adapt LeadDetailsSidebar) on ALL Meta convo types — Quick Actions Task/Demo/Audit
       always; stage/value once it's a lead. Wire modals with platform/commentLeadId/participant props.
       /impeccable shape → craft → polish → harden.
- [x] 6. Gates: SECURITY (Gate 5) — found `/api/webhooks/demo` is public (Meta webhooks share the prefix);
       gated the GHL promotion behind getSessionUser() so it can't be spammed anonymously. DATA (Gate 6) —
       migration additive+idempotent; gate correct; dual-write non-fatal/graceful. tsc CLEAN throughout.

### STATUS 2026-06-27: SHIPPED. Steps 1-6 done + DEPLOYED (migration 0019 applied). 
- [x] BUGFIX (deployed): IG buttons missing. Instagram DMs come via GHL (source "ghl_instagram") → routed to
      LeadDetailsSidebar, whose Quick Actions were gated on `opp`. Fixed: show Quick Actions whenever there's a
      `contactId`; modals fall back to contactId when no opp. FB worked (uses MetaLeadSidebar). tsc clean, deployed.

### NEW REQUESTS (2026-06-27) — need grill/shape, likely a fresh session (this one is very long):
- [ ] A. SMART DETECTION in the inbox (ALL tabs: Meta, GHL, etc.): detect URLs / emails / phone numbers in
      conversation messages and let you CLICK to attach them to that contact. The opportunity + contact MODALS
      already do this — find that detection util (lib/utils/url has cleanUrl/looksLikeUrl; check the modal
      components for the click-to-attach) and bring it to the inbox message thread(s).
- [ ] B. PRE-FILL the Meta demo/audit/task forms from data we already have (website, Instagram/FB social handle,
      email, phone) — no manual typing, no waiting to "generate". The comment_leads row carries email/phone/website;
      the conversation carries the social handle/participant name. Thread these into CreateDemoModal/Audit/Task
      as prefilled defaults (the demo modal already prefills website from a GHL qual note for the GHL flow).
- [ ] C. Demo clip for #kracked-software — FULL inbox scene authored at /tmp/inbox-scene.html (mock IG convo +
      sidebar + demo-makes-a-lead). NOT yet rendered (paused for the bugfix). Render → open for Jack → post.

**ORDER CONFIRMED (2026-06-27): A → B → C.** A captures data onto the contact/lead; B reads it to prefill the
forms; C films it. B-before-A was backwards — B's columns are empty until A writes them. (Jack: "A feeds B.")

**PREREQ SHIPPED (2026-06-27): table `comment_leads` → `social_leads`.** It holds comments AND DMs now, so the
name was misleading. Renamed: Drizzle symbol `commentLeads`→`socialLeads` (61 refs/15 files), physical table
(migration 0020 + transitional auto-updatable view `comment_leads`), `commentLeadId`/`commentLeadCount` left
intact, API routes left as `/api/comment-leads/*` (URLs, not the confusion). tsc clean; migration self-verified
(9 rows preserved); deployed `dpl_gZQYz63bZRvVYWkqGrgVHacpWSVt` READY; inbox+count endpoints 200 on prod.
PENDING: drop the transitional view (`scripts/drop-comment-leads-view.mjs`) right before the Task A deploy.

## TASK A — locked requirements (grill ✓ 2026-06-27, 3 decisions)
Port the EXISTING detect-and-attach (`lib/utils/extract-contact-data.ts` + `components/shared/chat-bubble.tsx`
EnrichChip/SmartBanner — already live in the contact + opportunity modals) into the inbox message threads.
Detect email / phone / website on INBOUND messages; click a chip to attach to that contact/lead.

- **D1 write target = SAVE LOCALLY, DON'T PROMOTE.** GHL-backed convos (GHL inbox + IG-via-GHL, have a
  contactId) → existing `PATCH /api/ghl/contacts/{id}`. Meta convos not in GHL → write the value to their
  `comment_leads` row. NEVER creates a pipeline lead (demo-makes-a-lead gate stays intact).
- **D2 raw DMs = COVERED.** Raw DMs (source "dm", from `/api/meta/conversations`) have no record → on attach,
  upsert a `comment_leads` row by (platform, participantId = commenter_id), no promotion. Attach works on ALL
  tabs. Consistent with the existing DM→comment_leads-at-demo persistence.
- **D3 already-on-file = HIDE IT.** Compare each detected value vs the contact/lead's current email/phone/website;
  only surface chips for data we DON'T already have. Keeps the thread quiet; serves "never re-handle what we know".
- **Constraint:** a DM-origin `comment_leads` row must NOT appear in the comment-leads list as a comment — verify
  `/api/comment-leads/inbox` excludes rows with no commentId/keyword. Check in the data-integrity gate (Gate 6).
- **Write paths collapse to two:** (a) GHL contact PATCH (existing); (b) ONE new "attach to Meta lead by identity"
  endpoint covering comment leads (by row id) + DMs (upsert by platform+commenter_id).
- **UI shape ✓ (impeccable shape, 2026-06-27):** reuse the existing `EnrichChip`+`SmartBanner` verbatim
  (Restrained, matches the contact/opportunity modals). Layout = top "Add all" banner (primary) + inline
  inbound chips (secondary). Quiet by default: D3 hides already-on-file, so nothing renders when all captured.

### TASK A — build plan (shape ✓; craft next)
Backend:
- [ ] A1. New endpoint `app/api/comment-leads/attach/route.ts` (auth/admin via getSessionUser; field whitelist
      email|phone|website; non-fatal). Body `{ field, value, commentLeadId? | (platform + participantId + name) }`.
      commentLeadId → UPDATE social_leads by id. Else upsert by (platform, commenter_id): UPDATE if exists, else
      INSERT a minimal DM-origin row — NO demoStartedAt / ghlContactId (no promotion; gate intact).
- [ ] A2. Data-integrity: ensure DM-origin rows (no commentId/keyword) do NOT surface in `/api/comment-leads/inbox`
      as comments — add/confirm a WHERE filter. (Gate 6.)
Data surfacing (for D3 + later B):
- [ ] A3. `/api/comment-leads/inbox` + CommentLeadRow: return email/phone/website.
- [ ] A4. `/api/meta/conversations` + DmConversation: LEFT JOIN social_leads by (platform, commenter_id) → return
      existing email/phone/website so D3 filters after first attach.
- [ ] A5. GHL inbox + GHL-IG: make the contact's current email/phone/website available to the thread.
Components:
- [ ] A6. `chat-bubble.tsx`: parameterize save target (GHL PATCH vs new social_leads attach) behind one UX; add
      `existing` filtering (D3) in BOTH EnrichChip rendering and SmartBanner. Keep contactId default (modals unchanged).
- [ ] A7. GHL `message-thread.tsx` + `inbox-client.tsx`: thread contactId + existing fields; add banner + inline
      chips; onFieldSaved → invalidate contact query (sidebar reflects, value drops out).
- [ ] A8. `meta-conversations.tsx`: add banner + chips to DM, comment, and GHL-IG threads with the right save target.
Verify + gates:
- [ ] A9. tsc clean → deploy → authed smoke test on prod (detect → attach → written + disappears + sidebar updates).
- [ ] A10. polish → harden → security (Gate 5: new endpoint) → data (Gate 6: upsert + no inbox pollution).
- [ ] A11. Drop the transitional `comment_leads` view (scripts/drop-comment-leads-view.mjs) just before this deploy.

**Staff review (2026-06-27) — must-fix folded in:**
- A1 fix: DM-origin INSERT must set `commentText=""`, `keyword=""`, and require `name` (all NOT NULL). No unique
  index on (platform, commenter_id) → use SELECT-then-INSERT/UPDATE in a txn, NOT onConflict. Gate `/attach` with
  getSessionUser (401). `/attach` is the single canonical chip endpoint; leave `[id]` PATCH for the lead editors.
- A2 must ship WITH A1: `/api/comment-leads/inbox` add `WHERE commentId IS NOT NULL OR keyword <> ''` (else DM rows
  show as fake comments between deploys).
- A6 D3 must NORMALIZE before compare: website via cleanUrl(), email trim+lowercase, phone strip-non-digits
  (helper in extract-contact-data.ts) — else already-saved values still show a chip.
- A5: GHL email/phone from the contact GET; website from `websiteRaw` (a CUSTOM field, id te2hH1PWliUW8R18epQn) —
  GHL website is READ from a custom field but the existing PATCH WRITES top-level `website` (mismatch). See DECISION 1.
- A7: don't refactor message-thread.tsx (bespoke renderer) — add optional props (contactId/existing/onFieldSaved),
  SmartBanner at top + EnrichChip under inbound REGULAR bubbles only. inbox-client already has contactId in scope.
- Invalidation: GHL → ["contact-opportunity", contactId]; Meta → ["comment-leads-inbox"] (+ ["meta-conversations"]).

**DECISIONS RESOLVED (Jack, 2026-06-27):**
- DECISION 1 → FIX PROPERLY. GHL website save writes the custom field (te2hH1PWliUW8R18epQn) so read=write;
  D3 compares vs websiteRaw. Also fixes the modals' website save. Touches the shared PATCH (smoke-test after).
- DECISION 2 → OUT OF SCOPE. Only the new `/attach` endpoint is login-gated; leave the two existing PATCH routes
  unchanged (flag for a later security pass).

**Build order when we proceed:** backend foundation (A1 /attach + A2 inbox filter + extract-contact-data normalize
helper + GHL custom-field write + A3/A4 data surfacing) → tsc → component wiring (A6 chat-bubble, A7 GHL thread,
A8 meta threads) → tsc → deploy + smoke test → polish → harden → security (Gate 5) + data (Gate 6) → drop view (A11).

### BACKEND FOUNDATION — DONE in working tree, tsc CLEAN, NOT yet deployed (2026-06-27)
Deploy is intentionally HELD to batch with the frontend (one deploy, per skew discipline). Done:
- [x] A1. `app/api/comment-leads/attach/route.ts` — POST, getSessionUser-gated (401). field whitelist
      email|phone|website. commentLeadId → UPDATE by id. Else (platform+participantId) → SELECT-then
      UPDATE/INSERT by (platform, commenter_id); DM-origin INSERT sets name(req'd, default "Unknown"),
      commentText="", keyword="" (NOT NULL), NO promotion. (Single canonical chip endpoint for Meta.)
- [x] A2. `/api/comment-leads/inbox` → `WHERE commentId IS NOT NULL OR keyword <> ''` (DM rows excluded).
- [x] A3. inbox already `select()`s all cols → email/phone/website returned (frontend type wiring is in A8).
- [x] A4. `/api/meta/conversations` enriches DMs with social_leads email/phone/website (inArray by commenter_id).
- [x] extract-contact-data.ts: `normalizeForCompare` + `filterAlreadyOnFile` (D3 normalize: cleanUrl/lowercase/digits).
- [x] DECISION 1: GHL PATCH now also writes the website CUSTOM field (isolated try/catch). Verify format on smoke test.
- [x] tsc CLEAN.
FRONTEND — DONE in working tree, tsc CLEAN (2026-06-27):
- [x] A6. chat-bubble.tsx: AttachTarget union + attachField (GHL PATCH vs /attach); D3 filterAlreadyOnFile in
      EnrichChip + SmartBanner; contactId kept for modal back-compat; EnrichChip exported.
- [x] A7. message-thread.tsx: contactId prop + own contact query (email/phone/websiteRaw) → banner above the
      scroll + inline chips on inbound regular bubbles; invalidates ghl-contact-basic + contact-opportunity.
      inbox-client passes contactId.
- [x] A8. meta-conversations.tsx: DM thread (banner + inline chips, social target by platform+participantId) +
      comment thread (banner, social target by commentLeadId); types + mapping carry email/phone/website.
      GHL-IG thread chips DEFERRED (minor; it has a GHL contact + sidebar; main inbox already covers IG-via-GHL).
### TASK A — SHIPPED + VERIFIED ON PROD (2026-06-27)
- [x] A9. Deployed dpl_cEw8LrG67wso1c4EaUpPjQPrcxWa READY. Smoke test PASS: attach gated (307 unauth); inbox still
      lists 9 comment leads; DM attach creates a social_leads row (website set, empty text/keyword,
      demoStarted+ghlContact NULL = no promotion); smoke row NOT leaked into comment inbox; meta/conversations 200.
- [x] A10. Gate 5 (security) + Gate 6 (data) PASS via fresh-subagent review (no blockers; phone-country-code
      normalize fix applied). Polish/harden: reuses the already-hardened EnrichChip/SmartBanner; modal back-compat
      confirmed (contact + opportunity modals pass no `existing` → unchanged behavior).
- [x] A11. Transitional comment_leads view dropped — rename fully complete (only social_leads exists).
OPEN follow-ups (minor): (i) verify GHL website CUSTOM-field write format on a real contact (isolated; no
regression if wrong); (ii) eyeball chips in the live inbox UI (fold into task C clip); (iii) GHL-IG thread chips
deferred; (iv) phone/email detection false-positive noise (cosmetic).
**A FEEDS B:** social_leads email/phone/website now get populated from the thread → task B can read them.

### ⏭ OVERNIGHT AUTONOMOUS RUN (Jack asleep, 2026-06-27 → wants all done + verified by morning)
Order: (1) verify GHL website custom-field format [safe test contact, create+delete]; (2) TASK B build →
review → deploy; (3) verify B + A end-to-end on prod incl. a headless UI capture (screenshots); (4) render
TASK C clip + open it. HARD RULE: do NOT post the clip to Slack — queue it for Jack's approval (lessons 2026-06-24).
B scope (locked earlier "fit data to fields"): Demo modal ← website/brand/handle/email/phone; Audit ← website/brand;
Task ← name only (no change). Source: social_leads (email/phone/website) + conversation (handle=participantName,
IG name IS the @handle; FB name is a person name → handle blank for FB). Thread via MetaLeadSidebar + LeadDetailsSidebar.
Gates: tsc only local gate; fresh-subagent review for security/data; batch one deploy; verify before calling done.

### OVERNIGHT RESULTS (2026-06-27)
- [x] GHL website CUSTOM-field write format VERIFIED ({id,value} works — test contact created+deleted via GHL API).
      So the website-attach shipped with A is correct + live.
- [x] TASK B SHIPPED + VERIFIED. Deployed dpl_NMMPvJmGAQGK2Pvzd7a62mDWZiN3 READY. Demo modal ← website/brand/
      handle/email/phone; Audit ← website/brand; Task unchanged. IG name→@handle, FB/TikTok→blank handle.
      Code review verdict SHIP (back-compat verified across all 5 modal call sites; submit payloads unchanged).
      A→B verified on prod: attach 3 fields to a test comment lead → inbox API surfaces all three (the exact data
      MetaLeadSidebar feeds the modals) → PASS, test row cleaned up. tsc clean.
- [x] TASK C — POSTED to #kracked-software (C0AADG61BE2) 2026-06-27, Jack-approved. Final clip = REAL-APP capture
      (Playwright on live prod + page.route network fixtures, NOT a scene mockup): a raw DM hands over website+email
      → tap each chip INLINE in the thread to save → the Demo form auto-fills. Step-by-step + captions, full page in
      frame (/tmp/clip-detect-to-demo.mp4). First two attempts (authored HTML scene; then a comment-lead) were
      rejected by Jack — see lessons 2026-06-27.
- NOTE: A/B verified at every machine layer; live-pixel screenshot of the rendered chips/prefilled modal NOT
  captured overnight (fragile live-capture; low residual risk — reuses production EnrichChip/SmartBanner +
  trivial state-init prefill). Eyeball on next login or fold into a clip.
- NICE follow-ups (non-blocking): demo-modal exhaustive-deps comment; suppress audit discard-confirm when only
  prefilled; GHL-IG thread chips; phone/email detection false-positive noise.

---

# ▶ IN PROGRESS (2026-06-26): Per-Cadence KPI Targets + Pace-Adjusted On-Track

**Goal:** Kill the target-skew. Set Daily / Weekly / Monthly targets per KPI (set one, auto-derive the
rest, editable). The on-track badge on every KPI cell + dashboard widget reads honestly for whatever
window is selected, by pro-rating the right cadence target to elapsed days.

**Gates:** grill ✓ (3 product decisions) → impeccable shape ✓ (confirmed). Decisions locked:
pace-adjusted math · set-one-auto-derive · existing single target → Monthly slot · cells get smart
chip + hairline pace meter.

## Build steps
- [x] 1. Migration `0018_add_cadence_targets.sql` — add cols + backfill monthly = target. Additive + idempotent.
- [x] 2. `lib/db/schema.ts` — four columns on `kpiTargets`.
- [x] 3. `lib/kpi/pacing.ts` — pure engine. VERIFIED 28/28 against worked examples via tsx harness.
- [x] 4. `app/api/kpis/targets/route.ts` — cadence GET/POST, whitelisted, admin-only, legacy target=monthly.
- [x] 5. `components/kpis/metric-cell.tsx` — pace-aware PaceBadge + hairline PaceMeter; `window` prop.
- [x] 6. Threaded window: `balanced-metric-grid.tsx`, `metric-section.tsx`, ConfigurableRows + FunnelSection.
- [x] 7. `kpis-client.tsx` — passes `dateRange` as the cells' window.
- [x] 8. `kpi-widget.tsx` — passes its window; resolveTarget carries cadence.
- [x] 9. `kpi-configurator.tsx` — 3-cadence setter (anchor/auto, ↺) + live PACE preview (real engine).
- [x] 10. `tsc` gate — CLEAN.
- [x] 11. polish (caption contrast, de-nested pace panel) + harden (edge cases reviewed).
- [x] 12. security + data gates — fresh-subagent review: SHIP-WITH-FIXES. Both gates PASS.
       Fixed: anchor-clear dead state (handleCadence), metricKey length cap, prod-migration apply
       script (no auto-runner — would 500 on deploy without it). P2 pre-existing items left out of scope.
- [x] 13a. Prod migration APPLIED + verified (17 rows backfilled monthly = legacy target). Jack confirmed.
- [x] 13b. DEPLOYED to prod (dpl_GL9xARPRB91ERrV2AcNrLeq8mHkF, READY, kracked-sales.vercel.app).
       Root blocker was TWO env issues: disk 100% full (broke npx) + CLI logged into wrong account
       (`aiposuk`). Fixed: freed npm cache + Jack re-logged-in as `jack-5430` (device-auth). Smoke test:
       /, /kpis, /api/kpis/targets all 307→login (deployed, gated, no 500 on new columns).
- [x] 14. Demo clip POSTED to #kracked-software (C0AADG61BE2): autoplaying GIF + 3-step how-to.
       Built BOTH a polished component scene (web-to-video, lands green "on pace" + struck-out −92%)
       AND a real-app headless capture (Playwright video of live prod /kpis, minted admin session).
       Jack picked the polished component clip. All temp artifacts + minted cookie deleted.

## FEATURE COMPLETE ✅ — shipped, verified, announced (2026-06-26)

## Review outcome
Security (Gate 5): auth admin-only enforced · POST body whitelisted (no mass-assignment) · Drizzle
parameterized (no injection) · targets are global+admin so no IDOR. PASS.
Data (Gate 6): migration additive + idempotent + reversible · backfill monthly=target correct · legacy
`target` kept = monthly so un-migrated readers stay correct. PASS.
CRITICAL deploy order: migration MUST be applied before/with the deploy (GET selects the new columns).

## Notes
- Whole-day proration (today = 1 elapsed day; no intraday). Standard pacing; self-corrects EOD.
- `MetricTarget` keeps legacy `target` = monthly so any missed consumer still renders.
- Auto vs explicit on reopen: a cadence reads "auto" iff stored ≈ derive(anchor). No extra cols.
- Conversions: 30.4375 days/month, 7 days/week.

---

# ✅ SHIPPED 2026-06-24: "Share to Slack" — end-of-feature demo broadcaster

Pilot posted to #kracked-software (message + headless-rendered demo GIF of the
rep-performance click-to-verify feature). **Method changed from screen-recording to
HEADLESS RENDER**: screen capture filmed the wrong window + disrupted Jack, so per his
idea we recreate the feature as a deterministic self-contained HTML scene and render it
off-screen with Python Playwright + ffmpeg. Fully autonomous, no disruption, nothing
saved to disk. Reusable scripts: `scripts/share-to-slack.mjs`, `scripts/demo-director.js`.
Details in memory `project_slack_feature_broadcaster`. Original screen-record plan below
is superseded.

---

# ▶ ORIGINAL PLAN (superseded): "Share to Slack" — end-of-feature demo broadcaster

**Goal:** After a visible feature ships, Claude asks "share this to Slack?". On yes,
it drafts an idiot-proof message, records a short on-brand GIF of the feature in use
(custom cursor moving, clicking, drawer opening), previews both for Jack's approval,
then posts message + GIF to **#kracked-software** where Aaron, Gage, Sway are. Nothing
is saved to Jack's Mac.

## Decisions locked
- Channel: **#kracked-software** (feature/dev updates). Not the configured `kracked-ai-sales`.
- Artifact: **GIF** (recorder-native, autoplays in Slack). Compress to MP4 only if oversized.
- Cursor: injected on-brand overlay (petrol-navy ring + click pulse + optional caption chip),
  NOT the OS pointer, so every clip looks deliberate.
- Never auto-post. Message + GIF always previewed; explicit "yes" required (safety rule too).

## Blockers (Jack-only, one-time)
- [ ] Add `files:write` scope to `kracked_ai` Slack app + Reinstall to Workspace.
- [ ] `/invite @kracked_ai` into #kracked-software.
- [ ] Verify: re-run scope/channel probe → `files.getUploadURLExternal ok: true` and
      bot is a member of #kracked-software.

## Phase 1 — Slack share backend (the post mechanism)
- [ ] `lib/slack/share.ts`: `shareFeatureUpdate({ blocks, text, channelId, file? })`.
      Reads bot token from `slackSettings`. If `file`: `files.getUploadURLExternal` →
      PUT bytes → `files.completeUploadExternal` with `channel_id` + `initial_comment`.
      If no file: `chat.postMessage` with Block Kit blocks. Never throws.
- [ ] `lib/slack/blocks.ts`: `featureUpdateBlocks(...)` → clean Block Kit card: header,
      one-line "what it does", numbered "how to use", "who it's for".
- [ ] `POST /api/slack/share` (admin-only) → used by the preview "Send" button.

## Phase 2 — The recorder ("demo director")
- [ ] `lib/demo/director.ts` (injected via javascript_tool): on-brand cursor + caption chip;
      API `moveTo(selector)`, `click()`, `caption(text)`, `wait(ms)`; eased, reduced-motion safe.
- [ ] Recording runbook (claude-in-chrome): new tab → prod URL → start gif_creator →
      run director steps (extra frames before/after) → stop → GIF in /tmp.
- [ ] Per-feature demo script. Pilot (rep performance): cursor to a number → click →
      drawer slides in → caption → hold. Compress >5MB; delete /tmp after upload.

## Phase 3 — The gate + preview UX
- [ ] Behavioral rule in CLAUDE.md: after a visible feature deploys, ask
      "Share to #kracked-software?" → draft → record → preview → approve → send.
- [ ] Preview: drafted message + GIF inline, Send / Edit / Cancel.

## Phase 4 — Pilot + verify
- [ ] Run the full flow on the rep-performance click-to-verify feature as feature #1.
- [ ] Confirm in #kracked-software, screenshot back to Jack.

---

# ⭐ SESSION HANDOFF (2026-06-22) — read this first

Long session; continuing in a fresh session. Working tree clean except this file + the drafted `audits` table in lib/db/schema.ts (Phase 2 groundwork, committed as WIP).

## Shipped + deployed + verified this session
- Contacts toggle-pill filter sheet (commit 726659b)
- All Create Audit/Demo/Task buttons wired (commit 6f34965)
- Premium Create Audit modal redesign — manual fields, creator defaults, balanced (commit eb2b123). NOTE: creator-default person fields don't pre-fill yet — `/api/me` returns no `name` (fix in B).
- Pre-call prep = icon-only on call tile (commit c7e57d6)
- **A — Calls Logged fix (commit 2775b76):** calls table was empty after 2026-04-09. Now syncs GHL calendar bookings as callType "meet" (dedup meetConferenceId=`ghlappt_<id>`) in runSync. Verified: 306 calls total, **32 this month (was 0)**. Daily cron /api/cron/sync-calls keeps it current.

## REMAINING BACKLOG (Jack wants ALL, "100% accurately + beautifully")
- **B — Audit Phase 2 (tracking): ✅ DONE + DEPLOYED + VERIFIED (commit 048bad8, 2026-06-22).** /api/me name fix · migration 0015 applied to prod · create-audit DB write · contacts hasAudit/auditStatus join · "Audit delivered" filter card enabled · daily /api/cron/sync-audits. Two follow-ups: (1) confirm exact ClickUp "Delivered" status name to tighten isDelivered(); (2) one live end-to-end test (create audit → row → mark delivered → cron → filter). The demo-modal reskin was split out to **Phase 2b** (needs its own /impeccable pass). See the Audit Phase 2 section below.
- **C — Activity tab: show call outcomes. ✅ DONE + DEPLOYED + VERIFIED (commit c8e3032, 2026-06-22).** Used the call_dispositions table (keyed by contactId), not the calendar caveat path. Call outcomes now show in BOTH modals: contact Timeline gets a structured `call_outcome` row ("Call: No-show", toned phone icon, notes; the raw "[Call outcome:]" GHL note is de-duped); opportunity Activity merges dispositions via /api/activity?contactId and renders the existing pill with semantic tones. Single source of truth: lib/activity/outcomes.ts. Verified live on prod for a real no-show (contact eV3...): timeline event + activity merge both correct, no dup note. ALSO shipped the Contact/Opportunity modal identity system (navy round = person, gold square = deal; type chips + header wash + value elevated) — Jack approved the "full identity system" via /impeccable shape; verified beautiful + distinct on prod.
- **D — Call recordings linked per contact.** OPEN QUESTION: recordings source. Google Meet recordings need Workspace (not configured); Fathom needs key (not set). GHL dialer TYPE_CALL messages may carry a recording URL (check meta/attachments). Clarify with Jack where recordings live before building.
- **E — Mark conversation as read.** Inbox: add a way to clear unread so it doesn't persist. Self-contained. Look at components/inbox + the unread source (GHL conversation unreadCount or local state).

## Calls data caveat (affects A polish + C/D)
GHL /calendars/events list returns sparse fields — contactName/contactId/assignedUserId null for many events. The count (A) works, but per-contact linkage (C/D) and rep attribution need a richer fetch.

---

# Audit Request feature — AI auto-fill + tracking + unified modal redesign

**Status:** requirements locked (grill-me done 2026-06-22). Next: /impeccable shape.

## Locked requirements
- **Auto-fill** (Gemini): Brand+Website from data · ESP detected from site · Relevant Details drafted from qual Q&A · both pitch fields AI-suggested · Hiro default No · Strategist/Reviewer/Client Contact default to creator (logged-in user → ClickUp member by name). All editable.
- **AI-fill UX "Live drafting":** open instantly, hard fields filled, AI fields shimmer+sparkle+LOCKED until values animate in (then unlock + "AI" chip); ~8s timeout → unlock empty.
- **Submit:** ClickUp task as today (reuse /api/clickup/create-audit) + write new `audits` DB table (ghlContactId ↔ clickupTaskId + field values, requestedAt, status).
- **Tracking:** daily cron syncs ClickUp task completion → deliveredAt/status=delivered → powers "Audit delivered" filter (Yes=delivered) + KPIs. Add hasAudit/auditStatus to UnifiedContact + contacts route.
- **Beauty:** full unified premium redesign of BOTH audit + demo modals (one shared "request" design language, proposal-wizard/filter-sheet bar). Audit keeps 2-step; demo elevated.

## Done already this session
- [x] Swept + fixed all Create Audit/Demo/Task buttons (wired 2 dead audit buttons, 2 contacts half-baked) — deployed, verified on prod (commit 6f34965)

## REVISED after grill (2026-06-22): NO AI auto-fill
Jack: audits follow a call, so ESP/Details/pitches are entered manually from call info. Dropped Gemini + live-drafting entirely. ESP keeps all 5 ClickUp options. All 3 person fields (Strategist/Reviewer/Client Contact) default to the creator. Hiro default No.

## Phase 1 — premium audit modal — ✅ DONE + DEPLOYED (commit eb2b123, live on prod)
- [x] /impeccable shape (coded mockups, Jack approved direction; AI layer later cut)
- [x] Rebuilt create-audit-modal.tsx: shared "request" primitives, balanced equal-size fields (ESP+Client Contact aligned), step rail, premium shell (blur/ring/scale-in), portal + Esc + reduced-motion
- [x] Brand+Website auto from qual note (✓auto); ESP/Details/pitches manual; Hiro default No
- [x] Verified live on prod (modal opens, both steps balanced, Hiro=No default)

## Phase 1 gap → fold into Phase 2 — ✅ FIXED (commit 048bad8)
- [x] Creator-default person fields: `/api/me` now returns `name`. memberIdForName(me.name) can match a ClickUp member (modal already wired to use me.name). Live test pending (see Phase 2 verify-after).

## Phase 2 — tracking — ✅ DONE + DEPLOYED + VERIFIED (commit 048bad8, 2026-06-22)
- [x] Fix /api/me to return `name` (creator-default) — getSessionUser already had it; added to JSON
- [x] `audits` table migration 0015 (additive/idempotent) — applied to prod, 11 cols verified, 0 rows
- [x] Extend /api/clickup/create-audit to insert audits row (taskId PK + ghlContactId + createdBy from session; non-fatal try/catch; onConflictDoNothing)
- [x] hasAudit/auditStatus on UnifiedContact + contacts route join (auditMap, delivered wins) + applyRule "auditDelivered" case
- [x] Enable "Audit delivered" filter card + ContactFilters.audit Tri + filtersToRules + filtersToParams + parseFilters + countActive (removed Coming-soon Lock)
- [x] Daily delivered-sync cron /api/cron/sync-audits (GET + CRON_SECRET, per-task fetch) → status/deliveredAt; vercel.json 0 10 * * *
- [x] Security/data review (Gates 5+6) passed; tsc clean; deployed READY; cron verified live (401 unauth, {pending:0} authed)

### Self-audit — ✅ data/cron/logic layers PASS (2026-06-22)
- [x] **Exact delivered status CONFIRMED:** Account Audits list real statuses are "audit needed" (open), "ready to send to client" (custom), "client received" (type=done, 86 tasks = the real delivered status), "on hold (missing access)" (open), "Closed" (type=closed). `isDelivered()` classifies ALL FIVE correctly (delivered = client received + Closed, via the type=done/closed check). No change needed; raw name stored in `clickup_status` anyway.
- [x] **Cron flip PROVEN on prod:** inserted 2 sentinel rows (real done-task + real open-task) → ran deployed cron → returned {pending:2,checked:2,delivered:1} → "client received" flipped to delivered (deliveredAt + clickup_status set), "audit needed" stayed requested. contacts auditMap yielded hasAudit/auditStatus/auditDelivered correctly. Sentinel rows deleted; table back to 0 rows. (used SELFTEST ghl ids that match no real contact, zero pollution.)
- [x] Build READY on prod, tsc clean, cron route enforces CRON_SECRET (401 unauth).
- [ ] **Remaining = 2 quick UI eyeball checks (need Jack's session, do together):** (1) open a contact → Create Audit → submit → confirm a row lands in `audits` with the right ghlContactId + the modal's person-fields pre-fill from /api/me name; (2) Contacts → filter sheet → confirm "Audit delivered" card is enabled (no "Coming soon") and toggling Yes/No persists to URL + filters the list. Not done autonomously: submitting creates a real ClickUp task in the live Account Audits list.

## Phase 2b — demo modal reskin (SEPARATE — needs its own impeccable pass)
- [ ] Re-skin demo modal with the shared request-modal primitives. This is a UI feature → run /impeccable shape → craft → polish → harden. NOT part of the tracking spine; deferred so tracking could ship clean.

---

# Contacts Advanced Filters — toggle-sheet rebuild (impeccable craft)

**Status:** in progress · 2026-06-22 · Jack approved direction **B + stage color** (hero live-count, tinted groups, rep avatars, semantic stage pills)

## Plan — ✅ COMPLETE (2026-06-22, deployed to prod)
- [x] `lib/contacts/filters.ts` — FilterRule types, ContactFilters model, pill catalogs, filtersToRules(), URL serialize/parse, countActive, stage tint
- [x] Extend API `app/api/contacts/route.ts` applyRule() — platform, channel, assignedTo, urgency, daysInCurrentStage, hasProposal, reachableChannels
- [x] Build `components/contacts/filter-sheet.tsx` (states, keyboard, reduced-motion, responsive, a11y, hero count-up)
- [x] Rewire `contacts-client.tsx` — ContactFilters state, live filtering, URL persistence, count badge, search + All/Unread/No-response presets, smart lists store ContactFilters
- [x] Delete `advanced-filters-panel.tsx`; add prefers-reduced-motion guard in globals.css
- [x] Verify tsc (clean) + in-browser visual check (clean console, fixed hydration); removed temp mock + reverted proxy.ts
- [x] Polish + harden; security/data review (read-only, passed); deployed `vercel --prod` (commit 726659b)
- [x] Verified LIVE on prod: 3,131 → 1 live filter, count-up, URL persist, emerald stage colour, real GHL stages

## NEXT TASK (Jack: "closed tab") — ✅ DONE (commit 048bad8)
- [x] Wired **Audit delivered** tracking + enabled the filter card in filter-sheet.tsx (see Audit Phase 2 section above)

## Decisions
- Filtering is SERVER-SIDE via existing `rules` engine — sheet emits FilterRule[] (is_any_of = OR within card, and = AND across cards). Minimal-impact reuse.
- Opt-in source: GHL contacts hardcoded platform="lead_form"; only comment leads carry real FB/IG/TikTok. Pills honest to stored data. Flagged to Jack.
- Available channels: only Email/SMS derivable → Email only / SMS only / SMS+Email. IG DM lives under Last contact channel.
- Lead score CUT (opaque). Audit delivered = disabled "coming soon" (wiring is the next task).

---

# Proposal Builder Redesign — Guided Wizard (impeccable craft)

**Status:** in progress · 2026-06-11 · Jack approved the shape brief ("go for it, build it")

## Design (approved)
Guided wizard, one decision per screen, plain-language deal shapes, persistent live "deal line", and a document-grade animated reveal. Reuses the proven billing engine (self-cancelling subscription, discount engine, server guardrails) — re-skin, not a billing rewrite.

## Spine (dynamic steps)
client → work → scope → deal → price → [schedule?] → reveal
- schedule only when: project + split (instalments) OR management retainer + deposit.

## Deal shapes (friendly UI over existing form fields)
- Management: "Auto-renewing retainer" (autoRenew=true + cadence + optional deposit) · "Fixed term, paid once" (autoRenew=false + length months)
- Project: "One payment" (single) · "Split into payments" (instalment)

## Preserve verbatim (revenue-critical)
FormState, billedTotalOf, compileScope, ContactSearch, FlowPill, handleSubmit + the API payload, the discount/billed math. Only the rendering/navigation changes.

## Build steps — ✅ COMPLETE (2026-06-11)
- [x] Rewrote proposal-create-modal.tsx as the guided wizard (motion transitions, AnimatePresence between steps, reveal price count-up + staggered nodes + savings pill; reduced-motion respected via useReducedMotion)
- [x] tsc + eslint clean (0 errors)
- [x] deployed + screenshot-verified all 7 screens on prod (Playwright harness, since removed) — ZERO console errors end-to-end
- [x] polish pass: fixed the reveal "Covers" node (now shows duration "6 months", not a truncated date range)
- [x] harden reasoning: $0 blocked, no-discount gated, long names use firstName, reduced-motion handled, submit shows Sending… + disabled
- [x] cleaned up temp harness + playwright; redeployed READY

Outcome: dead-simple guided wizard. Deal shapes (Auto-renewing retainer / Fixed term paid once · One payment / Split) are a friendly layer over the existing autoRenew + paymentStructure form fields — the proven handleSubmit payload + billing engine are UNCHANGED. Verified beautiful + flawless on prod.

## Visual elevation pass ("The Instrument") — ✅ COMPLETE (2026-06-11)
Jack: "make it magnificently beautiful / outrageously creative / one hell of an experience" + fix the contact dropdown being clipped. Used emil-design-eng (motion) + impeccable craft.
- [x] Contact dropdown CLIPPING FIXED — portaled to document.body (position:fixed, repositions on scroll/resize) so the modal's overflow can't clip it.
- [x] Cinematic shell: richer ink/45 backdrop + blur, paper #FBFBF9 card, premium layered shadow + ring, scale-in entrance (EASE_OUT 0.28s).
- [x] Refined header: `02 / 06` tabular counter + step label + animated filling progress rail.
- [x] Bigger editorial headings (1.6rem, -0.02em, balance).
- [x] ChoiceCard: bold full-navy selected for cards w/o sub-options (work, project-deal); rich navy-tint for cards w/ controls (retainer/fixed-term, legibility); hover lift, press scale, spring-expanding sub-options, inverted icon tile, springing radio.
- [x] Segmented control with "magic" sliding navy pill (layoutId spring) for cadence/length — 4 presets one row + "or set a custom period" link (no wrap).
- [x] Deal line: refined navy strip, updates in place.
- [x] Reveal: soft glow behind a bigger 3.25rem count-up, shimmering green savings pill, nodes with connectors that draw in.
- [x] Footer: primary press scale + arrow nudge on hover; back active-scale.
- [x] All ease-out custom curves, reduced-motion fully handled (useReducedMotion).
- [x] Verified on prod via Playwright screenshots (since removed): all screens render, ZERO console errors. tsc + eslint clean. Engine UNCHANGED.

## Design tokens (real)
paper #FAFAF7 · ink #1C2333 · primary petrol-navy #0F3A5C · forest-green #2D5E3F (savings only) · Plus Jakarta Sans headings · radius 8/10px

## Dashboard KPI per-card settings — parity with /kpis (planned 2026-06-29)
Goal (Jack): hover gear on each dashboard KPI card (admin only) → opens the SAME
KpiConfigurator the /kpis page uses. Everything available on /kpis available on the
dashboard card. Set a target there → it pulls through everywhere (same kpi_targets row).

Mechanism (reuse, don't reinvent — the gear + configurator already exist):
1. Forward `configurable` + `onConfigure` through BalancedMetricGrid → MetricCell (per metric).
2. Dashboard-key → canonical /kpis config key resolver in kpi-widget:
   - business: cash→cashCollected, mrr→(managementMrr|totalMrr per DECISION B),
     proposals_sent→proposals_sent, calls_admin→calls_admin, software_spend→softwareSpend,
     pipeline_value_admin→(catalog key).
   - offer-scoped: leads / ad_spend / roas → offer:{activeFunnelId}:{leads|adSpend|roas}
     (funnelId from /api/kpis/offer-funnels).
3. Admin-gate the gear (reps have no targets/config endpoint).
4. Mount <KpiConfigurator> in the widget: metricKey=canonical, metricLabel, existingConfig
   (from /api/kpis/configs), availableMetrics (catalog), range=dashboard window,
   onSaved → invalidate ["kpi-targets"], ["dashboard-kpis"], ["kpi-configs"].
5. Gear opens configurator (stopPropagation); card body still opens the detail drill-down.
6. tsc → deploy → verify gear shows + a target set on the dashboard mirrors to /kpis.

DECISIONS NEEDED:
A. Full /kpis configurator (rewire source + combine + target) vs a target-only mini panel.
B. MRR card identity: Total MRR vs Management MRR (also fixes the earlier value/target mismatch).

_DONE 2026-06-29: shipped — gear on dashboard cash/mrr/leads/ad_spend/roas → same KpiConfigurator; reviewed SHIP; tsc clean; deployed._
