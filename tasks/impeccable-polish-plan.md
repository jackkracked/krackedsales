# Impeccable Polish/Harden Pass — Execution Plan

Branch: `impeccable-polish-pass` (off baseline `635c1a1`). main untouched.
Sources: `tasks/impeccable-audit.md`, `tasks/impeccable-critique.md`.
Verification gate per step: `npx tsc --noEmit` must stay at **0 errors**; lint errors must not exceed baseline **57**. (`npm run build` fails locally on missing API-key env at page-data collection — pre-existing, env-only, not a code gate.)
Constraints: no behavior removal, no functionality changes outside the named UI fixes, money/legal paths untouched (Tier 3 is plan-only).

---

## TIER 1 — Cosmetic + a11y (low risk, no behavior change)

- [ ] T1.1 Remove side-stripe colored borders (detector + audit tell). Replace with full 1px border, bg tint, or leading dot:
  - `components/dashboard/calendar-widget.tsx:44` (`border-l-2 border-primary`)
  - `components/calendar/calendar-client.tsx:147` (`border-l-2`)
  - `components/dashboard/conversations-strip/conversations-strip.tsx` InboxDrawer (`border-l-2 border-l-destructive`)
  - `components/inbox/reply-queue.tsx:59` (`border-l-2 border-l-primary`)
  - `components/demo-tracker/stage-heatmap.tsx:116` (`border-l-[3px]`)
  - `components/kpis/KpiDetailSheet.tsx:170` (`border-l-2 border-l-primary` — drop stripe, bg tint already present)
  - ~~BaseNode.tsx:107~~ **MOVED OUT (B2): `border-t-4` is load-bearing — it encodes node category color (CATEGORY_COLORS). Not decorative. Replace with a category-preserving cue (full colored border or colored dot) only with owner awareness; NOT a cosmetic drop.**
- [ ] T1.2 Em-dash + emoji in rendered UI copy → plain punctuation / `·` / lucide:
  - `components/dashboard/follow-up-queue.tsx:347` ("All caught up — … 🎉")
  - `components/dashboard/calendar-widget.tsx:52` (` — ${contactName}` → `·`)
  - `components/contacts/contact-modal.tsx` (5 em-dashes in body)
  - `components/kpis/KpiDetailSheet.tsx:150`, analytics peak-day subtitle
- [ ] T1.3 Emoji-as-icon → lucide:
  - `components/pipeline/opportunity-modal.tsx:473-479` (📥🔄 message labels)
  - `components/workflows/canvas/nodes/BaseNode.tsx` (📦📌👂), `WorkflowCanvas.tsx:311` (⚡)
- [ ] T1.4 a11y labels:
  - `aria-label` on icon-only buttons: opportunity-modal tabs (859-872), card message buttons, proposals row actions, contact-modal tabs (992-997)
  - `aria-current="page"` on active sidebar link (`components/layout/sidebar.tsx:183-220`)
  - `role="switch"` + `aria-checked` on toggles (team-settings, user-calendars-settings)
- [ ] T1.5 `components/contacts/contact-modal.tsx:365` `<img>` → add `alt` + onError fallback
- [ ] T1.6 `transition: width` → transform-based: `components/ui/donut-chart.tsx:97`, `components/workflows/canvas/CustomEdge.tsx:66`
- [ ] T1.7 Remove dead import `AiCopilotPanel` (admin-dashboard.tsx:10, rep-dashboard.tsx:11) — never rendered
- [ ] T1.8 Label opportunity-modal tabs with visible text or aria-label
- [ ] FLAG (do not auto-change): dead "Play recording" button `components/calls/calls-client.tsx:580` has no onClick. Decision needed (wire vs hide) — leave for user.

## TIER 2 — Systemic, behavior-preserving (medium risk, typecheck-verified, incremental)

- [ ] T2.1 ADD semantic tokens to `app/globals.css` `@theme`: `--success/--warning/--info` (+ `-foreground` + `/subtle`) and `--overlay`. Additive.
- [ ] T2.2 Strip dead `dark:` classes (no dark mode exists → never fire): transcript-drawer, calls-client, chat-bubble, health-row, contact-modal, BaseNode, booking-rules-settings (~23).
- [ ] T2.3 Build shared primitives (additive): `<Modal>` on Radix Dialog (focus trap, role=dialog, Escape, scroll-lock, `--overlay` backdrop) + `<ConfirmDialog>`. Reference: `components/settings/integrations-grid.tsx`.
- [ ] T2.4 Migrate overlays to `<Modal>` INCREMENTALLY (cluster at a time, typecheck after each). Order: dashboard → kpi/demo → calls/calendar → pipeline/proposals (NOT signing page). Backdrop → `--overlay`, kill raw `bg-black/*`.
- [ ] T2.5 Conservative color-token migration: duplicated brand-hex + two-green-families → semantic tokens. Visual-neutral, spot-checked, no blind replace-all.
- [ ] T2.6 Replace native `window.confirm()` (tasks-client:303, template-editor:68, booking-rules:183) with `<ConfirmDialog>` — NON-financial only.

## TIER 3 — PLAN ONLY (do NOT edit — live money/legal paths)

- Signing→pay (`proposal-signing-page.tsx`): confirm step; mutation timeout + retry; replace auto-redirect with explicit button; persist signed-but-payment-pending; failure recovery copy.
- Financial-write guards: Mark-as-Paid, deposit-override (starts Stripe subscription), bulk Archive → confirm + reporting note.
- Surface silent bulk-delete partial failures (`proposals-client.tsx:321`).
- Honest progress: call-prep fake steps + `setTimeout(2000)` GHL write confirmation.

---

## Review notes (staff-engineer pass — incorporated)
- **B1 (blocker):** Tailwind v4 `@theme inline` — T2.1 must add BOTH raw `:root` vars (`--success`, `--success-foreground`, `--success-subtle`, `--overlay`) AND `--color-*` keys inside `@theme inline` (mirror `--accent-green` at globals.css lines 17-18 + 43-44), else `bg-success` silently won't compile. Verify one `bg-success` element before sweeping.
- **B2 (blocker):** BaseNode `border-t-4` is the only category encoding on the canvas — removed from T1.1 cosmetic sweep (see above).
- **S1:** Build `<Modal>` on Radix `Dialog` (`@radix-ui/react-dialog@^1.1.15`, installed) for focus trap/Escape/restoration. integrations-grid is the backdrop/aria visual ref only — it has NO focus trap.
- **S2:** Full `window.confirm` site list: tasks-client:303, template-editor:68, booking-rules:183, user-calendars-settings:139, create-audit-modal:380, workflows/page:198. EXCLUDE meta-settings:145 (may touch Meta-ads money path → Tier 3 classify).
- **S3:** `window.confirm` is sync/blocking; `<ConfirmDialog>` is async/callback. Each site must move post-confirm logic into onConfirm — not a 1:1 swap. Verify the guard still gates.
- **S4:** Toggles = attribute add (`role="switch" aria-checked`), NOT a Radix Switch component swap.
- **N1 sequencing:** T2.1 tokens → T2.2 strip dead `dark:` → T2.3 build Modal → T2.5 color sweep → T2.4 incremental modal migration → T2.6 confirms. (No dark mode exists anywhere — strip confirmed safe.)
- **N3:** Reliable gate is `npx tsc --noEmit` (0 errors). Use `npx eslint .` for a comparable lint count.

## Outcome log

### Commit `9bec95f` — Tier 1 (partial, the high-value safe wins)
DONE & verified (tsc 0 errors, lint errors unchanged at 57, warnings 130→128):
- T1.1 side-stripes: calendar-widget, reply-queue, conversations-strip (late→bg wash), stage-heatmap + calendar-client (3px stripe→full colored border, color meaning kept). KpiDetailSheet:170 left (legit vertical-tab active indicator, not decoration).
- T1.2 copy: follow-up-queue (em-dash+🎉), calendar-widget (—→·), opportunity-modal activity labels. contact-modal em-dashes = FALSE POSITIVE (empty-value placeholders + comments), left.
- T1.3 emoji: opportunity-modal activity labels de-emoji'd. **Workflow-canvas emoji (BaseNode 📦📌👂, WorkflowCanvas ⚡) NOT done — needs lucide mapping, deferred (in-progress feature, low traffic).**
- T1.4 a11y: sidebar aria-current, opportunity-modal tabs aria-label + active-tab text label. **Remaining: card message buttons, proposals row actions, contact-modal tabs (992) aria-labels; toggle role="switch" (team-settings, user-calendars) — NOT done.**
- T1.5 contact-modal img alt + onerror. DONE.
- T1.6 transition:width = FALSE POSITIVE (SVG stroke-width, not CSS layout). Left intentionally.
- T1.7 dead AiCopilotPanel imports removed. DONE.
- T1.8 opportunity-modal tabs labelled. DONE.
- FLAG: dead "Play recording" button still flagged for owner decision.

### Commit `66377ca` — Tier 2 foundation
DONE & verified (tsc 0, lint errors unchanged at 57):
- T2.1 semantic tokens (`--success/--warning/--info` + subtle/foreground, `--overlay`) wired into @theme inline. Additive.
- T2.2 stripped 69 dead `dark:` classes across 8 files. Behavior-neutral.
- T2.3 built `components/ui/modal.tsx` + `confirm-dialog.tsx` on Radix Dialog (focus trap/Escape/scroll-lock/restoration). Additive, not yet wired in.

### REMAINING — needs VISUAL verification (see note)
- T2.5 color sweep (20+ files, visible shade changes) — typecheck-safe but visually unverified locally.
- T2.4 modal migration to `<Modal>` (~20 overlays, changes focus/scroll/portal behavior) — needs a running app to verify.
- T2.6 confirm-dialog swaps (sync→async restructure per site).
- Tier 1 tail: workflow-canvas emoji→lucide; broader icon-button aria sweep; toggle role="switch".
- Tier 3 = plan only (untouched, as agreed).

### ⚠️ VERIFICATION CONSTRAINT
Local `npm run build`/`next dev` cannot run — `.env.local` lacks API keys (Stripe/etc.), so page-data collection fails. tsc is the only local gate. The remaining Tier 2 work is VISUAL/behavioral; it should be verified on a Vercel PREVIEW deployment of this branch (env exists there) before trusting it, rather than applied blind.
