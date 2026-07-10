# Reminders System — Read-Only Audit Findings

Audited 2026-07-10. Scope: the client-facing **proposal reminders** (`/reminders` drip
emails) and the internal **Slack reminders** (Settings → Notifications). Method: full read of
~2,300 lines across both subsystems + four independent reviewers (correctness, security,
data-integrity, UI/UX), with the highest-stakes claims hand-verified in `engine.ts`.

**Verdict:** the live money/comms path is sound. Reminders stop the instant a client signs or
pays, and the claim-a-row-before-sending dedup is atomic, so a crash or double-run cannot
double-email under normal operation. No blocking issue. The list below is the cleanup.

---

## Verified good (no action)

- Stop-on-signed/paid re-query is correct for all three arms; lost/void deals excluded.
- Dedup is an atomic insert-on-conflict on a stable step id (no check-then-insert race).
- No Stripe calls, no money-state writes anywhere in the send path.
- Transactional emails fall back to the hardcoded template on any failure (a send can't break).
- Injection-safe: values HTML-escaped, subjects newline-stripped, CTA forced to clean https://,
  unknown {{tokens}} rejected at save, preview iframe fully sandboxed.
- Migrations 0028/0030/0031 additive + idempotent; all routes admin-gated; no IDOR on the feed.

---

## Fixed this session (verified: tsc clean)

- [x] **#8 r10n theme parity** — the dedicated `/settings/notifications` route was missing the
  `data-r10n-settings` scope, so under the R10N theme its inputs/save button rendered default
  lime. Added the attribute (`app/(app)/settings/notifications/page.tsx:23`). One line, zero risk.
- [x] **#2 internal Slack nudge dedup + isolation** — the "proposal stalling" rep ping wasn't
  deduped, so a send retry could re-ping; and a DB error in that path could flip an already-sent
  email row to "failed" and re-send the client email. Wrapped it in `claimNotification` (at most
  once per step) and its own try/catch (`lib/reminders/engine.ts:131-146`). Blast radius: internal
  Slack only. Normal-operation behavior unchanged; only the retry/error edges are now safe.

---

## Open — safe code-only fixes (no DB, no auth)

- [ ] **#7 Enable/pause toggle can lie after a failed save** — the On/Paused switch flips local
  state and only persists on Save; a failed save leaves the header showing "On" while the server
  says "Paused", signalled only by a small error line. Reconcile to server state on save error
  and make the failure louder. (`components/reminders/reminders-client.tsx`, `email-editor.tsx:100`)
- [ ] **#6 Lost edits on in-app navigation** — the unsaved-changes guard only catches tab
  close/refresh (`beforeunload`), not clicking another sidebar item. Edit a step, click "Contacts",
  lose it. Needs an App Router route-change confirm (fiddly — do it carefully, not rushed).
  Matches the prior "inline edits need keepalive" lesson. (`reminders-client.tsx:64-68`)
- [ ] **#a11y remove-step is keyboard-unreachable** — the per-step X is a `role=button tabIndex=-1`
  span nested in a button (invalid + not focusable). Restructure to a real sibling button.
  (`email-editor.tsx:143-147`)
- [ ] **Copy: "@Gage" hardcoded** in the rep-nudge label though the rep varies. Soften to "the rep"
  or resolve dynamically. (`email-editor.tsx:231`)
- [ ] **/reminders has zero r10n hooks** — the whole client-email screen ignores the R10N theme.
  Larger surface pass; run it through the impeccable shape/craft/polish gates if we do it.

---

## Open — needs your decision (not a pure code fix)

- [ ] **#4 Task-due reminders come from TWO uncoordinated systems** — `cron/task-reminders`
  (in-app bell) and `cron/rep-reminders` (Slack), with different "due" definitions and different
  day math (task-reminders uses UTC days; everything else uses LA days), and task-reminders dedup
  is a check-then-insert with no unique index (a code comment claims an ON CONFLICT that was never
  implemented). Reads like a half-finished migration. **Decision needed:** which system wins, then
  retire/fix the other. (`app/api/cron/task-reminders/route.ts`, `cron/rep-reminders/route.ts:116`)

---

## Deferred — higher blast radius, documented not touched

- [ ] **#1 `sent_reminders.step_key` is nullable** — the dedup keystone rests on convention (every
  writer passes a non-null key) not a DB constraint. Postgres treats NULLs as distinct, so a future
  null insert would silently defeat dedup. Fix = `NOT NULL` (backfill-check first) or recreate the
  unique index with `NULLS NOT DISTINCT`. **Latent, zero live trigger today.** Deferred because it's
  a prod DB migration with no staging — do it deliberately, off the 15:00 UTC cron window.
- [ ] **#3 Rare double-email on a mid-send crash** — a row left "sending" by a crash is reclaimed
  after 15 min and re-sent; if the crash landed in the ms gap after Resend succeeded but before the
  status write, the client gets two emails. Fix = pass a deterministic Resend idempotency key from
  the engine (keyed on the ledger row). Touches shared email infra — do it carefully, not blind.
  (`lib/reminders/engine.ts:103-113`, `lib/email/resend.ts:111`)
- [ ] **App-wide session/auth (NOT reminders-specific, surfaced during the security pass):**
  - Deactivated users keep access — the session token never expires and can't be revoked short of
    rotating the global secret. (`lib/auth/session.ts`)
  - Session HMAC falls back to a hardcoded `dev-secret-change-me` if `SESSION_SECRET` is unset; cron
    guards fail open if `CRON_SECRET` is unset. **Action: confirm both env vars are set in prod.**
  - Deferred entirely: touching auth core without the original context is the highest-risk change.

---

## Lower priority / polish (from the UI + security reviewers)

- [ ] "Send a test" can email any address (bounded, admin-only). Restrict to org/self if desired.
- [ ] Editable email body is raw HTML to recipients (admin-only). Sanitize on save if not intended.
- [ ] Test-send popover doesn't trap focus / restore focus on close. (`preview-pane.tsx:98-126`)
- [ ] Preview fetch failure is silent (stale preview stays). (`reminders-client.tsx:80`)
- [ ] "Saved" confirmation on the notifications cards vanishes instantly on refetch. (`notifications-client.tsx:189`)
- [ ] No consequence note when enabling a client-emailing reminder (contrast the good Stripe warning).
- [ ] Radius/opacity drift (`rounded-[6..14px]`, `bg-destructive/8`) vs the token scale.
