# Impeccable Critique — Kracked Sales (whole app)

Read-only UX critique. No files changed. Baseline commit: `635c1a1`.
Method per impeccable/critique: two independent blind LLM design reviewers (28/40 and 27/40 — strong convergence) + the deterministic 27-pattern detector. Browser-overlay step skipped (app not running; needs live creds).

## Design Health Score (Nielsen's 10, synthesized)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 3/4 | Mostly strong, but call-prep fakes a 5-step progress on a 2500ms timer, and GHL writes use blind `setTimeout(2000)` refetches instead of confirming the write. |
| 2 | Match system & real world | 3/4 | Domain language sharp (MRR, ROAS, instalments). Minor: icon-only modal tabs rely on hover titles. |
| 3 | User control & freedom | 3/4 | Kanban has a real Undo toast. But signing auto-redirects to Stripe (unstoppable), inline edits autosave with no undo. |
| 4 | Consistency & standards | 2/4 | Weakest. 4 different backdrop opacities (`/10 /25 /40 black/30`), two green families (`green-*` vs `emerald-*`), no radius scale (12 hardcoded radii), 3 destructive-confirm patterns incl. native `window.confirm()`. |
| 5 | Error prevention | 2/4 | Proposals confirm well, but financial writes (Mark as Paid, deposit-override that *starts a Stripe subscription*, bulk Archive) are under-guarded vs a simple delete. |
| 6 | Recognition over recall | 3/4 | Good in-context insight surfacing. Icon-only Overview/Qualification/Notes/Activity tabs force icon recall. |
| 7 | Flexibility & efficiency | 3/4 | Real power touches (⌘↵ save, arrow-key queue nav). No global command palette / keyboard route-switching. |
| 8 | Aesthetic & minimalist | 4/4 | The standout. Warm paper + navy + gold, tabular-nums, earned density. Delivers the brand. |
| 9 | Help users recover from errors | 2/4 | Generic dead-ends ("Signing failed. Please try again."), sign mutation has `retry:false` + no timeout, some fetches swallow errors silently. |
| 10 | Help & documentation | 3/4 | Correctly assumes competence — no tutorial cruft. Public signing page has no help, which is riskier. |
| **Total** | | **28/40** | **Good — strong craft, soft underbelly on destructive / financial / error paths** |

## Anti-Patterns Verdict — does it look AI-generated?

**No.** Both blind reviewers and the deterministic scanner agree. The detector found **8 issues in the entire 177-component app**:
- `side-tab` (border-l-2): `calendar-widget.tsx:44`, `calendar-client.tsx:147`
- `border-accent-on-rounded` (border-t-4): `workflows/canvas/nodes/BaseNode.tsx:107`
- `broken-image` (`<img>` no alt/error handling): `contacts/contact-modal.tsx:365`
- `em-dash-overuse` (5 in body): `contacts/contact-modal.tsx`
- `flat-type-hierarchy`: `contacts/contact-modal.tsx:120`
- `layout-transition` (`transition: width`): `ui/donut-chart.tsx:97`, `workflows/canvas/CustomEdge.tsx:66`

Human-authorship signals dominate: a real opinionated token palette (not default shadcn slate), domain-specific logic (Gemini rate-limit stagger, deal-health tiers, deposit→subscription flow), speaker-hash transcript colors, the K-mark-doubles-as-expand sidebar. The faint AI tells are in the seams: emoji in product strings (`📥 New Lead`, `🔄 Moved to…`), heavy section-divider comments, and a boilerplate "Secured by 256-bit encryption" trust line on the payment page.

## Overall impression

Visually top-decile for an internal tool, and convincingly hand-built. The risk is concentrated, not spread: **destructive-action honesty** (silent failures, unconfirmed archive, lightly-guarded financial writes) and the **external signing→payment path** (no confirm on a legally-binding signature, no retry/timeout, unstoppable auto-redirect, ambiguous failure state). Fix those and the cosmetic seams, and this is a genuinely excellent product.

## What's working (keep / propagate)

1. **Opportunity modal** — the crown jewel. Two-pane contact/health/last-call insights + live message thread + arrow-key queue nav. "Data IS the UI" done right.
2. **Pipeline Undo** (`kanban-board.tsx:311`) — optimistic move + real 5s Undo toast with the contact name.
3. **The design system** (`globals.css`) — warm paper/navy/gold tokens, focus-visible rings, hover-reveal scrollbars. Brand promise delivered in code.
4. **Signing page responsiveness** — genuinely dual-built mobile-card vs desktop-table + print styles.

## Priority issues (convergent across both reviewers)

- **[P0] Harden the sign → pay path** (`proposal-signing-page.tsx`). The revenue + only legally-binding moment has the thinnest safety net: one-click irreversible signature with no confirm, sign mutation with `retry:false` and no timeout, an unstoppable 1.2s auto-redirect to Stripe, and a generic failure dead-end that leaves contract state ambiguous. *Fix:* add a "You're signing as {name} for {amount}" confirm; give the mutation a timeout + retry; replace auto-redirect with an explicit "Contract saved — continue to payment" button; persist a signed-but-payment-pending state; on failure show a contact + "your card was not charged." *Command: `/impeccable harden`.*
- **[P0] Surface silent batch failures** (`proposals-client.tsx:321`). Bulk delete uses `Promise.allSettled` and never reports rejections — delete 10, have 4 fail, told nothing. *Fix:* count rejected, toast "3 of 10 couldn't be deleted," keep them selected. *Command: `/impeccable harden`.*
- **[P1] Guard financial state-changes** (`proposal-detail-slide-over.tsx`). Mark-as-Paid, deposit-override (starts a Stripe subscription), and bulk Archive mutate money/reporting with less friction than a delete. *Fix:* one shared `<ConfirmDialog>`, plus a "this affects MRR/commission reporting" note on financial writes; require confirm on bulk Archive. *Command: `/impeccable harden`.*
- **[P1] Collapse consistency debt into tokens.** 4 backdrop opacities, two green families, no radius scale, dead `dark:` classes, native `window.confirm()` beside bespoke modals. *Fix:* `--overlay`, semantic `--positive/--negative/--warning`, a radius scale; sweep hardcoded values; delete dead `dark:`. *Command: `/impeccable colorize` + `/impeccable polish`.*
- **[P2] Stop faking system status.** call-prep fake progress + `setTimeout(2000)` GHL write confirmation. *Fix:* honest indeterminate/pending state or real streamed steps. *Command: `/impeccable harden`.*

## Persona red flags

- **Power user (Jack's team, daily):** no global command palette / keyboard route-switching — the biggest efficiency ceiling. "Play recording" button in the calls table (`calls-client.tsx:580`) is wired with no `onClick` — a dead control that looks live. Icon-only modal tabs with no `1/2/3/4` switching despite arrow-key queue nav elsewhere.
- **First-time team member:** the opportunity modal is a 12-15-element wall with icon-only tabs and a Stage `<select>` that looks like static text. Empty kanban columns say only "Empty" with no cue how leads enter.

## Provocative questions

1. Why is signing a one-click canvas stroke when it has *less* friction than deleting an internal draft — for a contract that waives chargeback rights and auto-starts a subscription?
2. The opportunity modal proves you can fuse data into one decision surface — why does the rest of the app still make reps walk 12 sidebar routes? What would a single "next action" surface look like?
3. You compute deal-health, going-cold, and last-call sentiment — but they live inside modals nobody opens proactively. Should the board itself carry the urgency signal?
