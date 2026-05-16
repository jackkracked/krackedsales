# Activity Tracking System — Build Plan

## What We're Building
A comprehensive event log that captures every meaningful action in the app, surfaces as:
1. A timeline tab on each opportunity card (per-entity, built first)
2. A global Activity feed page in the sidebar (admin-only, built second)

No passive navigation tracking. No PostHog (for now). All events stored in Postgres via Drizzle.

---

## Phase 1 — DB Foundation

### 1.1 Schema — `activity_events` table
```
id              uuid, PK
user_id         text NOT NULL        -- app user ID
user_name       text NOT NULL        -- denormalized for display
user_email      text NOT NULL        -- denormalized for display
action          text NOT NULL        -- e.g. "opportunity.stage_changed"
entity_type     text NOT NULL        -- "opportunity" | "contact" | "proposal" | "task" | "note" | "call" | "message" | "template" | "follow_up"
entity_id       text NOT NULL        -- GHL ID or local UUID
entity_name     text                 -- denormalized display name
metadata        jsonb                -- action-specific payload (from_stage, to_stage, outcome, etc.)
created_at      timestamptz DEFAULT now()
```

**Indexes:**
- `(entity_type, entity_id, created_at DESC)` — per-entity timeline queries
- `(user_id, created_at DESC)` — per-rep activity queries
- `(action, created_at DESC)` — filter by action type
- `(created_at DESC)` — global feed

### 1.2 Migration script
`scripts/apply-activity-events-migration.mjs`

---

## Phase 2 — Logger Utility

### `lib/activity/logger.ts`
```typescript
export type ActivityAction =
  | "opportunity.created"
  | "opportunity.stage_changed"
  | "opportunity.viewed"
  | "note.created"
  | "note.updated"
  | "call.dispositioned"
  | "proposal.sent"
  | "proposal.accepted"
  | "proposal.declined"
  | "message.sent"
  | "template.sent"
  | "task.created"
  | "task.completed"
  | "task.updated"
  | "demo.scheduled"
  | "demo.started"
  | "follow_up.sent"
  | "lead.added"

export interface LogActivityParams {
  userId: string
  userName: string
  userEmail: string
  action: ActivityAction
  entityType: string
  entityId: string
  entityName?: string
  metadata?: Record<string, unknown>
}

// Fire-and-forget — never blocks the request, never throws
export function logActivity(params: LogActivityParams): void {
  db().insert(activityEvents).values({ ...params })
    .catch(err => console.error("[activity]", err))
}
```

---

## Phase 3 — Instrument API Routes

Add `logActivity(...)` to each of these after the primary action succeeds:

| Route | Method | Action logged | Metadata |
|-------|--------|---------------|----------|
| `/api/ghl/opportunities` | POST | `opportunity.created` / `lead.added` | `{ pipeline_id, stage_id }` |
| `/api/ghl/opportunities/[id]` | PATCH | `opportunity.stage_changed` | `{ from_stage, to_stage, from_stage_id, to_stage_id }` |
| `/api/ghl/contacts/[id]/notes` | POST | `note.created` | `{ note_preview: body.slice(0,100) }` |
| `/api/ghl/contacts/[id]/notes/[noteId]` | PUT | `note.updated` | `{ note_preview }` |
| `/api/dashboard/calls/[eventId]/outcome` | POST | `call.dispositioned` | `{ outcome, has_notes: !!notes }` |
| `/api/proposals` | POST | `proposal.sent` | `{ proposal_id, contact_name }` |
| `/api/templates/[id]/send` | POST | `template.sent` | `{ template_name, contact_name }` |
| `/api/tasks` | POST | `task.created` | `{ title, assigned_to }` |
| `/api/tasks/[id]` | PATCH | `task.completed` / `task.updated` | `{ title, status }` |
| `/api/comment-leads/[id]/message` | POST | `message.sent` | `{ channel: "instagram" \| "messenger" }` |
| `/api/ghl/conversations/[id]/messages` | POST | `message.sent` | `{ channel: "sms" \| "email" }` |
| `/api/follow-ups/[id]/send` (if exists) | POST | `follow_up.sent` | `{ contact_name }` |
| `/api/ghl/opportunities/[id]/demo-in-progress` | POST | `demo.started` | `{ opportunity_name }` |

**Session user** is fetched inside each route via `getSessionUser()` — that's where user_id/name/email come from.

---

## Phase 4 — Per-Entity Timeline UI

### New tab on `OpportunityModal`
- Add `"activity"` to the `Tab` type
- New `ActivityTab` component:
  - Fetches from `GET /api/activity?entityType=opportunity&entityId={id}`
  - Renders a reverse-chrono list of events
  - Each event: avatar/initials chip + action sentence + relative time
  - Example: `"Jack moved to Proposal Sent · 2h ago"`
  - Shows note previews inline for `note.created`
  - Skeleton loading state

### New API route: `GET /api/activity`
Query params: `entityType`, `entityId`, `userId`, `action`, `limit`, `cursor`
Returns: `{ events: ActivityEvent[], nextCursor?: string }`

---

## Phase 5 — Global Activity Feed Page

### `/app/(app)/activity/page.tsx`
- Admin-only (redirect non-admins)
- Server component wrapper, client feed inside

### `components/activity/activity-feed.tsx`
- Real-time reverse-chrono feed of ALL events
- Filters bar: Rep (dropdown), Action type (multi-select), Date range
- Infinite scroll with cursor pagination
- Each row: avatar | action sentence | entity link | time
- Clicking entity name opens the opportunity modal inline

### Sidebar nav update
- Add "Activity" nav item (admin-only, hidden for reps)
- Icon: `Activity` from lucide

---

## Phase 6 — Action Sentence Formatting

Single utility `lib/activity/format.ts`:
```typescript
export function formatActivityEvent(event: ActivityEvent): string {
  switch (event.action) {
    case "opportunity.stage_changed":
      return `moved ${event.entity_name} to ${event.metadata.to_stage}`
    case "note.created":
      return `added a note on ${event.entity_name}`
    case "call.dispositioned":
      return `logged ${event.metadata.outcome.replace(/_/g, " ")} on ${event.entity_name}`
    case "proposal.sent":
      return `sent a proposal to ${event.entity_name}`
    case "message.sent":
      return `sent a message to ${event.entity_name}`
    case "task.completed":
      return `completed task: ${event.entity_name}`
    // ... etc
  }
}
```

---

## Build Order
1. [ ] DB schema + migration script
2. [ ] `lib/activity/logger.ts`
3. [ ] Instrument all API routes
4. [ ] `GET /api/activity` route
5. [ ] `ActivityTab` on opportunity modal
6. [ ] Global activity feed page + sidebar nav
7. [ ] Deploy + verify events are logging

---

## What This Unlocks Later
- Copilot: "What has Jack been working on this week?"
- KPI formulas based on activity (notes per deal, time-to-disposition)
- Rep leaderboards by activity volume
- Deal health scoring using recency of actions on opportunity
- Replay a deal's full history from first touch to close
