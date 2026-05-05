# AI Follow-Up Employee — Final Implementation Plan

Version: 4.0 — Stage-aware, pipeline-driven, human-sounding
---

## 1. The Sales Process (What We're Following Up On)

```
FB Ad click
    │
    ▼
New Lead ──────────────────────────────────────── [No follow-up needed here]
    │
    ▼
Initial Contact Made (Verify Info) ─────────────── [No follow-up — inbox handles this]
    │
    ├── No website / Not DTC → Invalid/Missing URL or Rejected
    │
    ▼
Demo In Progress ───────────────────────────────── [No follow-up — being built]
    │
    ▼
Demo Sent (Completed Demo) ◄═══════════════════════ FOLLOW-UP ZONE 1
    │  Goal: Get them to book an intro call
    │  Messaging: About the design, value of the call
    │
    ├── They book ──────────────────────────────► Intro Call Scheduled
    │       │
    │       ├── They show ──────────────────────► Post-Call (Sale In Progress)
    │       │
    │       └── No-show ◄══════════════════════════ FOLLOW-UP ZONE 2
    │               Goal: Reschedule the call
    │
    ▼
Sale In Progress ◄══════════════════════════════════ FOLLOW-UP ZONE 3
    │  (Proposal sent, discussing pricing, objections)
    │  Goal: Close — HANDLE WITH EXTREME CARE
    │
    ├── Unresponsive ◄═════════════════════════════  FOLLOW-UP ZONE 4
    │       Goal: Revive the deal
    │
    └── Won / Lost / Abandoned ─────────────────► [Out of queue]
```

---

## 2. Follow-Up Strategy Per Stage

### Zone 1 — Demo Sent (No Call Booked)
**Trigger:** In "Demo Sent (Completed Demo)" stage + no call booked  
**Goal:** Get them to book an intro call to review the design  
**Urgency:** HIGH — this is the hottest moment  
**Tone:** Excited about the work, curious about their reaction, low-pressure ask  

Message angles (cycle through, never repeat):
1. Simple check-in on whether they saw the design + soft call ask
2. Specific observation about their store or current emails + invite to discuss
3. What the design was built to achieve (higher CTR, better brand alignment) + call ask
4. Quick case study — what happened when we reviewed a similar design with another brand
5. Direct question — "what's stopping you from jumping on a 20-min call?"
6. Very short pattern interrupt — something provocative about their emails

### Zone 2 — No-Show
**Trigger:** In "Intro Call (No-Show)" stage  
**Goal:** Reschedule without making it awkward  
**Urgency:** MEDIUM — act fast before it goes cold  
**Tone:** Understanding, zero pressure, make it easy  

Message angles:
1. Simple "looks like we missed each other — want to find another time?"
2. Offer an alternative format — "happy to do async if a call doesn't work"
3. Resurface the design — remind them it's waiting + quick reschedule ask
4. Direct: "still interested? just let me know and we'll get it sorted"

### Zone 3 — Sale In Progress (Active, Not Unresponsive)
**Trigger:** In a Sale In Progress stage + last contact was 5+ days ago  
**Goal:** Move the deal forward — don't disrupt the momentum  
**Urgency:** LOW — be careful here  
**Tone:** Helpful, not pushy. Never make them feel chased.  

Message angles:
1. Helpful check-in — "wanted to make sure you had everything you needed"
2. Pre-empt the most common objection (price, timing, ROI) with a relevant point
3. Offer to answer questions async — "happy to do a quick voice note if easier"

**Rules for Zone 3:**
- MAX 1 message every 5 days
- NEVER send if last message was less than 5 days ago
- NEVER use urgency language ("last chance", "limited spots" etc.)
- If last interaction was a positive reply, do NOT follow up — they're still warm

### Zone 4 — Sale In Progress (Unresponsive)
**Trigger:** In an unresponsive sale stage OR in any Sale In Progress stage  
with NO contact for 10+ days  
**Goal:** Revive a deal that's gone quiet  
**Urgency:** MEDIUM  
**Tone:** Direct, adds value, reminds them what's at stake  

Message angles:
1. Reference the proposal specifically — "wanted to check if you had any questions on the numbers"
2. Something changed — a new relevant result, a client win, a reason to revisit
3. Address the most likely objection head-on
4. Short and direct — "still want to make this happen on your end?"
5. Very short pattern interrupt

---

## 3. The AI Message Rules (Anti-Slop)

These rules are injected into EVERY AI prompt, no exceptions.

### Banned words and phrases (explicit list in prompt):
```
"hope this finds you well"
"I wanted to reach out"
"just checking in"
"circling back"
"touching base"
"as per my last"
"going forward"
"I hope you're doing well"
"I wanted to follow up"
"don't hesitate to"
"please feel free"
"at your earliest convenience"
"I look forward to hearing from you"
"best regards" / "kind regards" / "warm regards"
"leverage"
"synergies"
"value proposition"
"moving the needle"
"in terms of"
```

### Banned formatting:
```
— (em-dash) — NEVER use this
... (ellipsis) — avoid
• or - bullet points inside messages
ALL CAPS for emphasis
Exclamation marks more than once per message
```

### Tone rules:
```
- Write like you're typing this on your phone between meetings
- Use their first name ONCE at the start — never again in the message
- Max 2 sentences for SMS, max 5 for email
- Ask ONE question. Never two questions in one message.
- Short sentences. Under 15 words each.
- Contractions are good: "I've", "we've", "don't", "can't"
- Lowercase is fine for SMS/DM: "hey sarah" not "Hey Sarah,"
- Never start with "I" — start with their name or a statement
```

### What good looks like:

**SMS (Zone 1 — Day 3):**
> "Sarah, did you get a chance to look at the design? Curious what you think."

**NOT:**
> "Hi Sarah, I hope this message finds you well! I wanted to follow up on the email design demo I sent over a few days ago. I'm eager to hear your thoughts and would love to connect for a brief call at your earliest convenience. Best regards!"

**Email (Zone 4 — Day 12):**
> Subject: quick q on the proposal
>
> "Sarah, wanted to check if anything in the proposal was unclear. Happy to jump on a quick call and go through any questions you've got."

**NOT:**
> Subject: Following Up on Our Proposal
>
> "Hi Sarah, I hope you're doing well! I wanted to circle back regarding the proposal I sent over last week. I'd love to leverage this opportunity to move forward and discuss how we can add value to your email program going forward. Please don't hesitate to reach out if you have any questions!"

---

## 4. UX / UI Design

### Overall Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Follow-ups                                              [↺ Refresh]  [⚙]   │
├────────────────────────────┬─────────────────────────────────────────────────┤
│  LEFT PANEL (list)         │  RIGHT PANEL (AI workspace)                     │
│                            │                                                  │
│  [Search...]               │                                                  │
│                            │                                                  │
│  ● NEEDS ACTION (6)        │  ← Select a contact to see AI recommendation    │
│  ─────────────────         │                                                  │
│  Donale Miles        🔴   │                                                  │
│  Demo sent · 8d no msg    │                                                  │
│                            │                                                  │
│  Sarah Chen          🔴   │                                                  │
│  No-show · 3d ago         │                                                  │
│                            │                                                  │
│  Kendra Kerr         🟡   │                                                  │
│  Proposal · 6d no msg     │                                                  │
│                            │                                                  │
│  ─────────────────         │                                                  │
│  ● WAITING (4)             │                                                  │
│  ─────────────────         │                                                  │
│  Ashley Brooks             │                                                  │
│  Next: in 2 days           │                                                  │
│                            │                                                  │
│  ─────────────────         │                                                  │
│  ● CONVERTED (14)          │                                                  │
│                            │                                                  │
└────────────────────────────┴─────────────────────────────────────────────────┘
```

### Right Panel — Contact Selected (AI Workspace)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Donale Miles · heroeshonored.shop                              [Remove] [⋯] │
│  DTC ecommerce · Shopify Email                                               │
│                                                                               │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐              │
│  │ STAGE         │ DEMO SENT   │ LAST MSG     │ CHANNEL       │              │
│  │ Demo Sent     │ 26 days ago │ 8 days ago   │ EMAIL         │              │
│  └──────────────┴──────────────┴──────────────┴──────────────┘              │
│                                                                               │
│  MESSAGE HISTORY ──────────────────────────────────────────── [view all →]  │
│  ╔════════════════════════════════════════════════╗                          │
│  ║ You · 8 days ago                               ║                          │
│  ║ "Donale, wanted to check if you had a chance  ║                          │
│  ║ to see the design we put together..."          ║                          │
│  ╚════════════════════════════════════════════════╝                          │
│  ╔════════════════════════════════════════════════╗                          │
│  ║ You · 15 days ago                              ║                          │
│  ║ "Hey, just sent over the welcome email design  ║                          │
│  ║ for heroeshonored.shop..."                     ║                          │
│  ╚════════════════════════════════════════════════╝                          │
│                                                                               │
│  AI RECOMMENDATION ─────────────────────────────────────────────────────── │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                         │  │
│  │  Sending a single message. Here's why:                                 │  │
│  │  8 days of silence after 2 previous messages. Both previous messages   │  │
│  │  were warm and value-focused. Time to go shorter and more direct       │  │
│  │  with a specific observation about their store.                        │  │
│  │                                                                         │  │
│  │  ─────────────────────────────────────────────────────────────────     │  │
│  │  Subject: heroeshonored.shop                                           │  │
│  │                                                                         │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Donale, checked your store. The product photos are great but     │  │  │
│  │  │ the emails don't reflect it. Worth 20 minutes to fix that?       │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │  (click to edit)                                                        │  │
│  │                                                                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  [✓ Send Now]   [✏ Edit]   [↺ Try a different angle]   [⏭ Skip for today]  │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Right Panel — Sequence Recommended

```
│  AI RECOMMENDATION ───────────────────────────────────────────────────────  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                         │  │
│  │  Recommending a 3-message sequence over 8 days. Here's why:           │  │
│  │  Sarah replied once (Day 5) then went quiet for 33 days. She's        │  │
│  │  not cold, just busy. A short burst across 3 different angles is      │  │
│  │  more likely to surface at the right moment than a single message.    │  │
│  │                                                                         │  │
│  │  ─────────────────────────────────────────────────────────────────     │  │
│  │  MESSAGE 1 · Today                                                     │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Sarah, still thinking about the design? Just checking if timing  │  │  │
│  │  │ is better now.                                                    │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                         │  │
│  │  MESSAGE 2 · Day 4                                            [edit ↓] │  │
│  │  MESSAGE 3 · Day 8                                            [edit ↓] │  │
│  │                                                                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  [✓ Approve sequence]  [✏ Review & edit all 3]  [↺ Single message instead] │
```

### Left Panel — Contact Cards

```
  ┌────────────────────────────────────────────────┐
  │  Donale Miles                            🔴    │
  │  heroeshonored.shop                            │
  │  ┌──────────────────┬───────────────────────┐  │
  │  │ Demo Sent        │ No contact: 8 days    │  │
  │  └──────────────────┴───────────────────────┘  │
  │  EMAIL · 2 prior follow-ups                    │
  └────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────┐
  │  Sarah Chen                              🔴    │
  │  bloomandco.com                                │
  │  ┌──────────────────┬───────────────────────┐  │
  │  │ No-Show          │ No contact: 3 days    │  │
  │  └──────────────────┴───────────────────────┘  │
  │  SMS · 1 prior follow-up                       │
  └────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────┐
  │  Kendra Kerr                             🟡    │
  │  koh-i-noorbeauty.com                          │
  │  ┌──────────────────┬───────────────────────┐  │
  │  │ Proposal Sent    │ No contact: 6 days    │  │
  │  └──────────────────┴───────────────────────┘  │
  │  EMAIL · 1 prior follow-up  ⚠ Careful          │
  └────────────────────────────────────────────────┘
```

Stage badges are colour-coded:
- **Demo Sent** — blue
- **No-Show** — amber
- **Sale In Progress** — purple (+ "⚠ Careful" label)
- **Proposal Sent** — purple

Urgency dots:
- 🔴 Action overdue (7+ days no contact for demo/no-show, 10+ for proposal)
- 🟡 Due today (3–6 days no contact)
- 🟢 Upcoming (scheduled, not yet due)

---

## 5. Technical Architecture

### Data Source

The follow-up list is built from **live GHL pipeline data**, not a manual enrollment table.

On page load:
1. Fetch all open opportunities from the pipeline (`/api/ghl/opportunities`)
2. Filter to stages that need follow-up (Demo Sent, No-Show, Sale In Progress)
3. For each: look up last `followupSends` record from DB to get last contact date
4. Compute "days since last contact" = now - max(demoSentAt, lastFollowupSent)
5. Determine if AI recommendation already exists in `followupRecommendations` table
6. Return grouped, sorted by urgency

This means:
- Zero manual enrollment — when GHL stage changes, they automatically appear/disappear
- No stale contacts — if they move to Won/Lost, they vanish from the list next refresh
- Last contact date comes from `followupSends` DB (our actual sends)

### Schema Changes

**New table: `followupRecommendations`**
```sql
CREATE TABLE followup_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_contact_id  TEXT NOT NULL,
  opp_id          TEXT NOT NULL,
  stage_name      TEXT NOT NULL,
  type            TEXT NOT NULL,      -- 'single' | 'sequence' | 'wait'
  reasoning       TEXT NOT NULL,      -- Displayed to user
  messages_json   JSONB NOT NULL,     -- Array: { subject?, body, channel, delayDays, angle }
  status          TEXT DEFAULT 'pending',
    -- 'pending' | 'approved' | 'skipped' | 'dismissed' | 'replaced'
  generated_at    TIMESTAMP DEFAULT NOW(),
  acted_on_at     TIMESTAMP
);
```

**Modified: `followupSends`** (add columns)
```sql
ALTER TABLE followup_sends ADD COLUMN opp_id         TEXT;
ALTER TABLE followup_sends ADD COLUMN stage_name      TEXT;    -- Stage at time of send
ALTER TABLE followup_sends ADD COLUMN angle           TEXT;    -- What angle was used
ALTER TABLE followup_sends ADD COLUMN scheduled_for   TIMESTAMP; -- For sequence messages
ALTER TABLE followup_sends ADD COLUMN sent_at_actual  TIMESTAMP; -- When actually sent
```

### AI Prompt Structure

One Gemini call per contact. Returns structured JSON.

**Input:**
```json
{
  "contact": {
    "name": "Donale Miles",
    "firstName": "Donale",
    "website": "heroeshonored.shop",
    "brandCategory": "ecommerce",
    "platform": "Shopify Email",
    "channel": "EMAIL"
  },
  "pipeline": {
    "currentStage": "Demo Sent (Completed Demo)",
    "followUpZone": 1,
    "followUpGoal": "Get them to book an intro call to review the design",
    "demoSentDaysAgo": 26,
    "daysSinceLastContact": 8,
    "totalFollowUpsSent": 2
  },
  "history": {
    "hasEverReplied": false,
    "lastReplyText": null,
    "messagesSent": [
      { "daysAgo": 15, "angle": "demo_intro", "preview": "Hey, just sent over..." },
      { "daysAgo": 8, "angle": "check_in", "preview": "Donale, wanted to check..." }
    ]
  },
  "notes": ""
}
```

**Output (JSON):**
```json
{
  "type": "single",
  "reasoning": "8 days of silence after 2 warm messages. Both previous messages were lengthy. Time to go short and direct with a specific observation about their store.",
  "messages": [
    {
      "subject": "heroeshonored.shop",
      "body": "Donale, checked your store. The product photos are great but the emails don't reflect it. Worth 20 minutes to fix that?",
      "channel": "EMAIL",
      "delayDays": 0,
      "angle": "pattern_interrupt_observation"
    }
  ]
}
```

### Gemini System Prompt

```
You are an AI assistant helping a one-person email design agency follow up with sales prospects.
Your job: recommend the best follow-up action and write the actual message(s).

THE GOAL varies by pipeline stage:
- "Demo Sent": Get them to book an intro call to review the design
- "No-Show": Get them to reschedule the call, no awkwardness
- "Sale In Progress": Move the deal forward. CAREFUL — don't be pushy or disrupt.
- "Proposal Sent": Follow up on the proposal gently. MAX 1 message every 5 days.

DECIDING SINGLE VS SEQUENCE:
- Single message: last contact was 3–10 days ago, or they've replied recently
- Sequence (2–3 messages max, 3–5 days apart): 20+ days cold, or showed early 
  interest then went quiet
- Wait (return nextCheckInDays): messaged in last 3 days, or active conversation

WRITING THE MESSAGES — STRICT RULES:
1. Sound like a human typing on their phone. Short. Direct.
2. Max 2 sentences for SMS. Max 4 sentences for email.
3. ONE question per message. Never two.
4. Use their first name once, at the start. Never again.
5. Never start a message with "I".
6. Contractions: always. "I've", "we've", "can't", "it's".
7. NEVER use these words/phrases:
   - hope this finds you well, I wanted to reach out, just checking in, 
     circling back, touching base, as per my last, going forward, 
     don't hesitate, please feel free, at your earliest convenience, 
     I look forward to, best regards, kind regards, leverage, synergies,
     value proposition, moving the needle
8. NEVER use em-dashes (—). Use a comma or period instead.
9. No bullet points inside messages.
10. No exclamation marks unless Zone 1 casual SMS.
11. Reference something specific about their business, not generic praise.
12. Never mention "AI", "template", or "automated".

GOOD EXAMPLE (EMAIL):
"Donale, checked your store. The product photos are great but the emails don't 
match the brand. Worth 20 minutes to fix that?"

BAD EXAMPLE (EMAIL):
"Hi Donale! I hope this message finds you well. I wanted to follow up on the 
email design demo I sent over. I'd love to leverage this opportunity to connect 
and discuss how we can move the needle on your email marketing. Don't hesitate 
to reach out at your earliest convenience!"

Output ONLY valid JSON matching the schema. No commentary outside JSON.
```

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/follow-ups` | GET | All contacts needing follow-up, with AI recommendations |
| `/api/follow-ups/analyse` | POST | Generate AI recommendations for all active contacts |
| `/api/follow-ups/[contactId]/send` | POST | Send message, record to DB |
| `/api/follow-ups/[contactId]/skip` | POST | Skip — surface again tomorrow |
| `/api/follow-ups/[contactId]/remove` | POST | Remove from queue entirely |
| `/api/follow-ups/[contactId]/regenerate` | POST | Get a fresh AI recommendation |
| `/api/follow-ups/[contactId]/notes` | PATCH | Update notes for a contact |

### Vercel Cron (New)

```json
{
  "path": "/api/cron/followup-analyse",
  "schedule": "0 8 * * *"
}
```

Runs every morning at 8am UTC. Analyses all active follow-up contacts and pre-generates recommendations so they're ready when you open the page.

---

## 6. Component Architecture

```
app/(app)/follow-ups/page.tsx             (wrapper — unchanged)

components/follow-ups/
  follow-ups-client.tsx                   ← FULL REWRITE
  follow-up-list-panel.tsx                ← NEW: left panel with contact list
  follow-up-contact-card.tsx              ← NEW: individual card in list
  follow-up-workspace.tsx                 ← NEW: right panel AI workspace
  follow-up-recommendation.tsx            ← NEW: AI recommendation + reasoning
  follow-up-message-editor.tsx            ← NEW: editable message with send button
  follow-up-sequence-review.tsx           ← NEW: timeline view for sequences
  follow-up-history.tsx                   ← NEW: message thread
  follow-up-empty.tsx                     ← NEW: empty state

lib/ai/
  followup-engine.ts                      ← NEW: full context builder + Gemini call

app/api/
  follow-ups/route.ts                     ← NEW
  follow-ups/analyse/route.ts             ← NEW
  follow-ups/[contactId]/send/route.ts    ← NEW
  follow-ups/[contactId]/skip/route.ts    ← NEW
  follow-ups/[contactId]/remove/route.ts  ← NEW
  follow-ups/[contactId]/regenerate/route.ts ← NEW
  cron/followup-analyse/route.ts          ← NEW
```

---

## 7. Implementation Phases

### Phase 1 — Foundation (Day 1)
1. Schema migrations: `followupRecommendations`, update `followupSends`
2. `GET /api/follow-ups` — fetch from GHL pipeline + compute urgency + join with DB
3. `POST /api/follow-ups/analyse` — AI call for all contacts needing recommendations
4. `POST /api/follow-ups/[id]/send` — send via GHL + record to DB
5. GHL webhook: auto-detect inbound reply → remove from queue

### Phase 2 — AI Engine (Day 2)
6. `lib/ai/followup-engine.ts` — context builder + structured Gemini call
7. Stage-aware prompt with full anti-slop rules
8. Single vs. sequence decision logic
9. "Try a different angle" — regenerate with hint to use a different approach

### Phase 3 — Core UI (Day 3–4)
10. Split-panel layout (list + workspace)
11. Contact cards with stage badges + urgency dots
12. AI workspace: reasoning panel + editable message
13. Sequence review: timeline + per-message edit
14. Skip / Remove actions

### Phase 4 — Polish (Day 5)
15. Daily cron for pre-generation
16. Empty states + loading skeletons
17. Keyboard shortcuts (j/k to navigate, enter to approve, s to skip)
18. End-to-end test all 4 channels and all 4 follow-up zones

---

## 8. What the Page Feels Like Day-to-Day

You open Follow-ups. The AI has already done its analysis overnight.

Left panel: 6 people need action. Sorted by urgency. You click the first one.

Right panel loads instantly. You see:
- Who they are, what stage they're in, when you last contacted them
- The last 2 messages you sent them (so you remember the context)
- The AI's reasoning for what it's suggesting (2–3 sentences, plain English)
- The actual message — short, human, specific to their business

You read it. It's good. You hit Send. Done in 15 seconds.

Next person. The AI suggested a 3-message sequence. You tap "Review all 3" — a timeline opens. Message 2 is slightly off. You edit it inline. Hit Approve. Done.

Every person in your pipeline is touched. Nothing slips through. No generic messages. No AI slop. Just persistent, intelligent, human-sounding follow-up.
