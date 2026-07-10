# Dashboard Conversations — Unified Modal + Mark-as-Read

Shape brief APPROVED by Jack 2026-07-10 ("build both"). Register: product. Read-state
dual-writes app + GHL. Below is the granular execution plan.

## Decisions locked
- Every conversation click opens the full modal (opportunity modal for opps, contact modal
  for contacts, contact-style shell for social/no-record). NO writes on open. "Create Demo"
  is the promote-to-lead action and ALREADY dual-writes (promoteMetaLeadToGhl + socialLeads
  mirror) — just surface it.
- Mark-as-read = "handled, clear it": hover ✓ quick-clear + hover-checkbox multi-select +
  floating bulk bar + undo toast (sonner). Persisted to a new conversation_reads table AND
  best-effort pushed to GHL. A new inbound message re-surfaces the conversation.

## Phase 1 — Backend: read-state foundation
- [x] Migration `db/migrations/0032_conversation_reads.sql` — table conversation_reads
      (channel, conversation_id, read_at, read_by) + unique(channel, conversation_id). Additive.
- [x] Drizzle: add `conversationReads` to lib/db/schema.ts.
- [x] `POST /api/inbox/queue/mark-read` — auth + upsert/delete conversation_reads + best-effort
      GHL push + undo (read:false). DONE.
- [x] Queue filter in app/api/inbox/queue/route.ts — read_at vs last-message time; new inbound
      re-surfaces. DONE.

## Phase 2 — Frontend: mark-as-read UX (match existing tile/tokens/r10n)
- [x] Mark-as-read UX DONE — SelectControls (hover ✓ quick-clear + checkbox multi-select as
      absolute siblings, no nested buttons), selection ring, keyboard `E`, floating bulk bar,
      optimistic dismiss + POST + sonner undo + error revert, motion exit w/ useReducedMotion.
      Wired on BOTH the strip tiles and the drawer rows. tsc clean.

## Phase 3 — Frontend: unify the modal — DONE (tsc clean)
- [x] handleReply routes every click to a full modal: opp → OpportunityModal (AI draft);
      GHL contact no-opp → HYDRATE (reuse existing GET /api/ghl/contacts/[contactId], build a
      UnifiedContact client-side via buildContactFromQueue) → ContactModal; raw social lead
      (no contactId) → CreateDemoModal (promote-to-lead). NO new endpoint, NO shared-component
      edits (ContactModal/CreateDemoModal used as-is → zero breakage risk). No writes on open.
- [x] ReplyModal deleted (was only used here).

## Phase 4 — Verify + ship — DONE
- [x] tsc clean after each phase.
- [x] Migration 0032 applied to prod (verified: table + unique index present).
- [x] Deployed to prod (commit 1cf1a7e). SHIPPED 2026-07-10.

## Notes / open confirmations
- GHL mark-read field is best-effort (PUT /conversations/{id} {unreadCount:0}); degrade to
  app-only if GHL rejects. App-side clear is what drives the board regardless.
- Migrations are plain SQL applied directly to the DB (no npm runner).
