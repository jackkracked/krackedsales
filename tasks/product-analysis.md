# Kracked Sales — Product Analysis
_2026-05-11_

---

## What the system is today

Kracked Sales is a well-structured GHL wrapper with some genuine differentiation: the Demo Tracker (ClickUp integration), AI follow-up queue, and unified comment-lead capture are genuinely useful and not something GHL gives you out of the box.

The system does a solid job of surfacing *where things are*. The gap is *what to do next, right now, without thinking about it.* That's the 10x opportunity.

Current state by area:

| Area | Status | Honest assessment |
|---|---|---|
| Pipeline visibility | Good | Kanban + webhook sync works. Stage events table is solid foundation. |
| Demo Tracker | Good | Best differentiated feature. ClickUp + GHL link is genuinely useful. |
| AI Follow-up Queue | Partial | Generates messages but requires navigation to a dedicated page. Friction. |
| Inbox | Fragmented | Three separate channel views. No unified "needs reply" concept. |
| Calls | Passive | Logged but not actionable. Transcripts available but unused by AI. |
| KPIs | Solid | Admin strip works. Rep quota ring works. |
| Calendar | Basic | Shows events. Book a call. No intelligence. |
| A/B Testing | Wired but dormant | Schema supports it. Winner detection not implemented. |
| Notifications | None | Zero push/in-app alerts. Everything requires polling manually. |

---

## The core problem to solve

The stated goal: **cut reply time 10x.**

Right now a rep has to:
1. Notice they need to reply (manual polling)
2. Open the right inbox (which channel?)
3. Remember context about the contact
4. Compose a message
5. Send

That's 5 steps, each with friction. The 2035 version does all of that except step 5. The rep only decides *yes or no*.

---

## Priority 1 — Unified Reply Queue (cut reply time 10x)

This is the highest-value feature not built. The inbox exists, but it doesn't answer: *"what should I reply to right now?"*

### What this looks like

A single screen — accessible from anywhere in the app — that shows every conversation needing a reply, ranked by priority, with an AI draft already loaded. The rep opens it, reads the draft, hits Approve, done. No composing. No context-switching between GHL/Meta/TikTok tabs.

**Ranking logic:**
- High-value opportunity (monetaryValue > threshold) + no reply for 2h → top of queue
- New lead from comment + not yet responded → urgent
- Demo confirmed + no confirmation reply → urgent
- Known contact in active stage + message unanswered 24h+ → medium
- Old cold lead → low

**Per-conversation view:**
- Contact name + opportunity stage + deal value
- Full message history (last 3 messages for context)
- AI draft pre-loaded, editable in place
- One button: **Send as written** | **Edit** | **Skip**

**Data needed:** Already exists. GHL conversations, Meta conversations, TikTok DMs, comment leads. The infrastructure is there.

**What's missing to build this:**
- A unified "awaiting reply" query that merges across all three channel sources
- A priority-scoring function (simple enough to implement in a single API route)
- A stripped-down "approve and send" UI — not the full inbox, just the queue

### Why this cuts time 10x

Right now: notice → navigate → context-load → compose → send = ~5 minutes per reply
With this: open queue → read draft → approve = 30 seconds per reply

---

## Priority 2 — Message Approval Workflow

The follow-up queue already generates AI messages. The missing piece is **approval-first sending** — especially important so Jack can review what gets sent before it goes out, or so reps don't accidentally send AI slop.

### Current state

`/api/follow-ups` generates recommendations that can be sent directly. There's no concept of:
- A draft sitting "pending approval by admin"
- Admin seeing what's queued before it goes out
- A rep submitting a message for admin sign-off

### What this should be

Two modes per user role:

**Rep:**
- AI drafts a follow-up → status: `pending_approval`
- Rep can edit before submitting
- Submitted message queued for admin
- Admin approves → auto-sends
- Admin rejects with comment → back to rep

**Admin:**
- Sees all `pending_approval` messages across all reps
- Can approve, reject (with note), or edit before approving
- Optionally: "auto-approve for this rep" toggle per rep (for trusted reps)

**Why this matters operationally:**
- Keeps brand voice consistent
- Prevents reps sending wrong messages to high-value prospects
- Jack gets visibility without being in every conversation

### Schema additions needed

`followupRecommendations` already has a `status` field. Extend:
- `status`: add `pending_approval`, `approved`, `rejected` alongside existing values
- `approvedBy: userId | null`
- `approvedAt: timestamp | null`
- `rejectionNote: text | null`

No new tables needed.

### UI additions needed

- Admin: approval queue panel (same design pattern as follow-up list, different filter)
- Rep: "Awaiting approval" badge count in nav
- Notification: Pusher event when message is approved/rejected

---

## Priority 3 — A/B Testing with Automatic Winner Detection

The schema already has `abGroup`, `weight`, `isWinner` on `replyTemplates`. But winner detection is manual and the knowledge doesn't feed back into AI generation.

### What's missing

1. **Automatic winner detection** — After N sends (configurable, default 10 per variant), compare response rates. If variant A is 1.5x better than B with statistical confidence, mark as winner, pause the losing variant.

2. **Winner application to AI drafts** — When AI generates a follow-up for a contact in stage X, look at winning templates for that stage context. Use the winner's structure/angle as a style guide for the draft.

3. **Winner surfacing in UI** — Templates page shows: active tests, sample sizes, current leaders, projected winner. Not just a list of templates — a live leaderboard.

### Implementation outline

**Winner detection (can run in existing `/api/cron/followup-analyse`):**
```
for each active A/B test (templates with same name + different abGroup):
  if both variants have >= 10 sends:
    chi-square test on (sent, responded) pairs
    if p < 0.05 and one variant is >= 1.3x better:
      mark winner = true on winning template
      mark active = false on losing template
      log winner detection event
```

**Feed into AI generation (`/api/ai/followup`):**
- Query winning templates for current pipeline stage
- Pass top 3 winner bodies to Gemini as "proven effective messages in this context"
- Gemini adapts the style rather than starting from scratch

**This is the key compound benefit:** over time, the system learns which messages actually get responses in this specific business, and AI drafts reflect that knowledge. It's not generic AI anymore.

---

## Priority 4 — Deal Health Score

Every opportunity should have a health score (0–100) computed from signals you already track. No new data needed.

**Signals:**
| Signal | Weight | Direction |
|---|---|---|
| Days since last inbound reply | -3/day after 5 days | Down |
| Days since last outbound contact | -2/day after 3 days | Down |
| Stage velocity vs average (faster = healthier) | +/- 10 | Up/Down |
| Number of calls (more = engaged) | +5 per call, cap at 20 | Up |
| Demo completed | +25 | Up |
| No-show | -20 | Down |
| Stage (closer to close = higher base) | Stage weight | Up |
| Response to last follow-up | +15 | Up |

**Score tiers:** 70+ = healthy (green), 40–69 = at risk (amber), <40 = cold (red)

**Where it shows:**
- Opportunity card in pipeline (small colored dot or thin border)
- Going Cold widget already shows days-since-update — replace with health score
- Admin pipeline health panel shows distribution of scores by stage

**Why this is useful daily:** Right now the only signal is `updatedAt`. A deal that was updated because someone moved it to a wrong stage looks healthy. A deal where the contact replied twice this week looks stale if nobody moved it. Health score captures actual engagement, not just activity.

---

## Priority 5 — Conversation Intelligence from Call Transcripts

Call transcripts from Google Meet are available but unused. This is a significant waste.

**What the system should do automatically after a call:**
1. Detect the call ended (already synced via cron or webhook)
2. Fetch transcript via existing `/api/calls/[id]/transcript`
3. Pass to AI with prompt: "Extract: what the prospect said they want, objections raised, promised next steps, suggested follow-up timing, red flags"
4. Store structured result against the GHL contact record (as a custom field or in `contactCustomFields`)
5. Surface in:
   - Contact detail view (new "Call Intelligence" section)
   - Follow-up queue context (so AI knows what was promised on the call)
   - Opportunity card tooltip

**Why this cuts reply time:** When a rep opens the follow-up queue after a call, the AI draft already knows "prospect mentioned budget concern, wanted case studies" — and writes accordingly. Without this, the rep has to remember or re-read the transcript.

**What's needed:**
- Post-call trigger: after `sync-calls` writes a new transcript, queue an AI analysis job
- New schema: `callInsights` table (callId, contactId, wantsJson, objectionsJson, nextStepsJson, redFlagsJson, analyzedAt)
- No new APIs needed — reuse `/api/ai/copilot` pattern with a specialized prompt

---

## Priority 6 — Smart Daily Brief

Every morning (configurable time), the system computes a personalized action list for each rep and sends it to Slack + shows it on the dashboard.

**For each rep, the brief contains:**
1. **Reply queue:** N conversations waiting for response, highest priority first
2. **Follow-ups due today:** Deals where follow-up is overdue + pre-drafted messages
3. **Today's calls:** Calendar events (already in CalendarWidget, add to brief)
4. **Going cold today:** Deals that cross the 7-day threshold today (not already cold)
5. **One thing to close this week:** Highest health-score deal in late stage

**Format:** Short Slack message + deep-link to the action. Not a wall of data — a 5-item punch list.

**What's needed:**
- Extend `/api/cron/daily-summary` (already exists, posts to Slack)
- Add per-rep personalization (currently posts generic aggregate numbers)
- Add "going cold today" query (deals where `updatedAt` is exactly 6 days ago)
- Add follow-up due count per rep

**Dashboard integration:** The "Today's Focus" widget on the rep dashboard already exists as a placeholder. This feature makes it real.

---

## Priority 7 — In-App Notifications

Currently: zero. The system knows when important things happen (webhooks, cron results) but nothing surfaces to the user in real-time without refreshing.

**What should trigger a notification:**
- New lead from comment (Meta or TikTok) — especially if keyword is high-intent
- Stage move on your opportunity (webhook already fires → just push to user)
- Message approved or rejected (from approval workflow)
- Follow-up due for a contact you own
- Deal went cold (crossed threshold)
- No-show detected

**Implementation:** Pusher events already exist and the pattern is in place for pipeline updates. Add a notification center component (bell icon in nav) with a feed of events. Mark as read on click. Badge count.

**Schema needed:** `notifications` table (userId, type, payload, readAt, createdAt). Simple.

---

## The "2035" features — genuinely useful, not ornamental

These are higher effort but worth naming:

### Auto-Responder for Comments (not spam, smart)
When a keyword comment comes in at 11pm, don't make the lead wait 8 hours. AI drafts a personalized reply ("Hey [Name], thanks for reaching out — sounds like [paraphrase their comment]. I'll have someone from our team follow up with you shortly"). Admin approves template once. System fires automatically within 2 minutes of comment.

This alone could cut lead response time from 8h to 2min for after-hours comments.

**Feasibility:** Meta/TikTok webhooks already fire in real-time. Comment leads are stored. Just need: auto-trigger AI draft → auto-send if confidence high / queue for approval if low.

### Response Rate by Message Angle (not just A/B)
Instead of just tracking which template wins, classify message *angles*:
- "social proof" (we helped similar brands...)
- "curiosity" (question-led openers)
- "urgency" (time-limited offer)
- "empathy" (acknowledge their situation)
- "direct" (straight value prop)

Track response rate per angle per stage per lead source. After 50+ sends, the system knows: Meta leads at Demo Sent respond 2x better to social proof than urgency. This feeds AI generation automatically.

### Pipeline Revenue Forecasting
Take each open deal, apply stage-based close probability (configurable: e.g., Demo Sent = 20%, Sale in Progress = 60%, Proposal Sent = 80%), multiply by monetaryValue, sum across deals → **expected revenue this month**.

Show as a number on the admin dashboard alongside actual cash. The gap between forecast and target is the rep's number to close.

### Lead Source Attribution (actual ROI)
When a deal closes, you should know: did this come from Meta, TikTok, organic, or referral? Right now that data exists (commentLeads has a `platform` field) but it's not surfaced in won-deal analysis.

A simple attribution table: won deals by source, with average deal size and close rate by source. This tells you whether the $X/month on Meta ads is actually converting.

---

## What to skip or defer

These came up in the analysis but are not worth prioritizing:

- **Territory management** — 2-8 person team, no territories needed
- **Multi-language** — Single market
- **Zapier/n8n connectors** — You have webhooks. Build what you need directly.
- **CSV export** — Nice to have, low daily value
- **GraphQL API** — Over-engineering for this scale
- **Predictive churn scoring** — Not enough data volume to be meaningful
- **Lead enrichment (Clearbit/Apollo)** — Expensive, limited ROI for email design agency

---

## Recommended build order

| # | Feature | Daily value | Effort | Build first |
|---|---|---|---|---|
| 1 | Unified Reply Queue | Massive — cuts reply time 10x | Medium | Yes |
| 2 | A/B Winner Detection (automatic) | High — existing data, just logic | Low | Yes |
| 3 | Message Approval Workflow | High — Jack's specific ask | Medium | Yes |
| 4 | Deal Health Score | High — replaces dumb "going cold" | Low | Yes |
| 5 | In-App Notifications | High — no polling | Medium | Yes |
| 6 | Smart Daily Brief (rep) | High — replaces manual dashboard | Low | Yes (extends cron) |
| 7 | Call Transcript Intelligence | Medium-High — improves AI draft quality | Medium | After 1-3 |
| 8 | Auto-Responder for Comments | Very high if high comment volume | High | After core queue |
| 9 | Response Angle Classification | Medium — builds over time | Medium | After A/B |
| 10 | Revenue Forecasting | Medium — strategic visibility | Low | After health score |
| 11 | Lead Source Attribution | Medium — strategic visibility | Low | After forecasting |

---

## Bottom line

The system is 60% of what it needs to be. The pipeline tracking and demo tracker are solid. The AI follow-up queue is a real differentiator but buried.

The missing 40% is all about **speed and decision reduction**: tell me what to reply to, give me the draft, let me approve it in one click, and learn from whether it worked. Every feature in Priority 1–6 serves that goal.

The infrastructure is already there. Most of these features reuse existing data flows. None require new third-party integrations. The deal health score and A/B winner detection are almost entirely database logic with no new API calls.

If the goal is to cut reply time 10x: build the Unified Reply Queue first, then wire up notifications so reps don't have to check — they get pulled in when something needs them.
