# Dashboard Conversations — Unify Modal + Mark-as-Read

Two features on the dashboard `ConversationsStrip`. Both are UI: run the impeccable
shape gate + get approval before building. Must be phenomenally beautiful + 100% functional.

## Feature C — one modal for every conversation
Decided 2026-07-10 (Jack). Every conversation click opens the FULL modal (like the
opportunity / contact modal), never the stripped "Reply to this message" box.
- Populate what we can from available data (name, platform, message thread, profile).
- **NO writes to GHL or our DB just from opening.** A conversation is NOT a lead until a
  demo is booked. Don't clog the system with non-leads.
- The **"Create demo"** quick action (exists in multiple places across the app) is the
  promotion point: pressing it creates the lead in BOTH GHL **and** our local DB
  (dual-write), future-proofing the eventual migration off GoHighLevel.
- Kill the basic `ReplyModal` (only used in ConversationsStrip → safe to remove).
- Today's branch: `components/dashboard/conversations-strip/conversations-strip.tsx:218-260`
  (`handleReply`). Full modal = `components/pipeline/opportunity-modal.tsx`; basic =
  `components/dashboard/conversations-strip/reply-modal.tsx`. Opp lookup =
  `app/api/ghl/contacts/[contactId]/opportunity/route.ts`.

- [ ] Shape the "no pipeline record yet" full-modal state (contact view + thread + reply +
      an "Add to pipeline / Create demo" CTA), including social leads with no GHL contact
- [ ] Route ALL clicks to the full modal; populate from available data; no writes on open
- [ ] Wire "Create demo" → dual-write GHL + local leads (the promotion-to-lead moment)
- [ ] Remove ReplyModal once nothing routes to it

## Feature D — mark conversations as read from the list (no open)
Jack wants to mark read WITHOUT opening a conversation. His direction (explicitly "not
gospel"): hover reveals a multi-select, then bulk "mark as read". Research best-practice
UX/UI first and propose.
- [ ] Research best-practice patterns (hover affordance vs always-visible, checkbox multi-
      select, bulk action bar, single-click mark-read, keyboard) — pick the strongest
- [ ] Confirm the read/unread data model + an API to mark read exists (or must be built);
      check the inbox/queue source (`/api/inbox/queue`) for an unread flag
- [ ] Shape + approval, then build

## Status
- Not started. Next step: impeccable shape for both, then approval, then build.
