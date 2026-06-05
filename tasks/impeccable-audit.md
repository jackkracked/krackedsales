# Impeccable Audit — Kracked Sales (whole app)

Read-only technical audit. No files changed. Baseline commit: `635c1a1`.
Method: 4 parallel subagents, one per cluster, scored against the 5 impeccable audit dimensions + PRODUCT.md anti-references.

## Audit Health Score (whole app)

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2/4 | No modal/drawer in the app has a focus trap or `role="dialog"`/`aria-modal` that actually hides the background. ~20 overlays affected. |
| 2 | Performance | 3/4 | Solid foundation (React Query caching, animations disabled on sparklines). Main gaps: no list virtualization (transcripts/tables), per-card N+1 fetch + AI call on kanban mount. |
| 3 | Theming | 1/4 | Real token backbone exists and is well-adopted (card/foreground/border in 42/48 files), but: hex not OKLCH, **dark mode defined nowhere yet ~23 `dark:` classes ship as dead code**, and **no semantic status tokens** → 29/48 files hard-code raw `emerald/amber/blue/red`. |
| 4 | Responsive | 2/4 | Works on desktop; weak on mobile/tablet. Kanban unusable on phones, date-range-picker popover overflows, sub-44px touch targets throughout. |
| 5 | Anti-Patterns | 3/4 | Genuinely avoids the major AI slop tells. Isolated minor tells only. |
| **Total** | | **11/20** | **Acceptable — significant work needed, but no fundamental rot** |

## Anti-Patterns Verdict — does it look AI-generated?

**No, at the macro level it passes.** This is the standout positive. Across all four clusters: no purple-to-blue gradients, no hero-metric template, no glassmorphism-by-default, no identical-card-grid filler, no neon/gamer dark theme, no gradient text. It reads as a deliberate, data-dense premium tool — exactly the PRODUCT.md brief. The tells that exist are small and local:
- `border-l-2`/`border-l-[3px]` colored side-stripes in ~5 spots (calendar-widget, conversations InboxDrawer, reply-queue, stage-heatmap, KpiDetailSheet).
- Emoji used as functional icons in workflows (`📦 📌 👂 ⚡`) and a couple of message labels.
- A few em dashes + one 🎉 in rendered UI copy.
- Raw `#000`/`bg-black` modal backdrops (6+ overlays).

## Executive Summary

- **Score: 11/20 (Acceptable).** No P0-blocking, app-wide defects, but two systemic issues drag every cluster down.
- **Issue counts:** P0 ≈ 2 (focus-trap family, counted once), P1 ≈ 8, P2 ≈ 14, P3 ≈ 12.
- **Top 5 critical:**
  1. **Modal/dialog accessibility** (systemic) — ~20 overlays with no focus trap, no real `aria-modal` background hiding, no focus restoration. Radix Dialog is already a dependency; one migration fixes most of it.
  2. **Theming: missing semantic status tokens** (systemic) — add `--success/--warning/--info` (+ subtle bg + foreground), sweep 29 files off raw Tailwind palette colors. Single highest-leverage theming fix.
  3. **Dark-mode contradiction** (systemic) — decide: implement `.dark` tokens, or strip all `dark:` dead classes. Don't ship both.
  4. **No list virtualization** — transcripts and 50-row tables render every node. Transcript is the highest-value target.
  5. **Mobile/touch** — kanban unusable on phones; sub-44px touch targets app-wide; date-range-picker overflows.

## Systemic patterns (fix once, win everywhere)

1. **Overlay primitive.** ~20 modals/drawers each re-implement an overlay. They diverge on a11y (focus trap, role, Escape) and on backdrop (`bg-foreground/25` vs raw `bg-black/40`). A single shared `<Modal>` built on Radix Dialog fixes accessibility + backdrop tokenization in one place. `integrations-grid.tsx` already does the a11y correctly — use it as the reference.
2. **Semantic color tokens.** The token gap (no success/warning/info) is the root cause of 60% of files hard-coding colors. Patch the tokens, not each component.
3. **Dark mode decision.** A half-committed dark mode is the biggest theming-score drag. One decision resolves it.
4. **Touch targets.** Consistently <44px — a shared icon-button component with correct hit area fixes it broadly.

## Positive findings (keep / propagate)

- `kpi-card.tsx` is the **accessibility exemplar** for clickable tiles (`role="button"`, `tabIndex`, Enter/Space) — propagate to the other `<div onClick>` tiles.
- `integrations-grid.tsx` is the **modal a11y exemplar** (`role="dialog"` + `aria-modal` + `aria-label`).
- Token backbone is genuinely well-adopted (42/48 files).
- Animations are tasteful ease-out `cubic-bezier(0.16,1,0.3,1)` — **no bounce anywhere**.
- `tabular-nums` used consistently for numeric columns — real data-density discipline.
- The **public proposal-signing page** is the most responsive surface in the app (mobile-card vs desktop-table, print variants, autoComplete). Good instinct on the one external surface.
- Recharts tooltips/axes correctly reference CSS variables.

## Recommended actions (priority order)

1. **[P1] `/impeccable harden`** — wrap the ~20 overlays in a shared Radix-Dialog-based modal: focus trap, `role="dialog"`, Escape, focus restoration, tokenized backdrop. Biggest single a11y win.
2. **[P1] `/impeccable colorize`** (theming) — add `--success/--warning/--info` semantic tokens + subtle/foreground variants; sweep raw palette colors. Resolve the dark-mode contradiction (recommend: strip `dark:` dead code unless dark mode is a near-term product goal).
3. **[P1] `/impeccable optimize`** — virtualize the transcript + long tables; collapse the kanban per-card N+1 fetch/AI-categorize into a batched/viewport-gated call.
4. **[P1] `/impeccable adapt`** — kanban→list default on mobile, fix date-range-picker popover, raise touch targets to ≥44px via a shared icon-button.
5. **[P2] `/impeccable clarify`** — icon-only buttons need `aria-label` (not `title`); add `aria-current` to active sidebar nav; `role="switch"`/`aria-checked` on toggles (Radix Switch already installed).
6. **[P3] `/impeccable polish`** — remove the 5 side-stripe borders, swap emoji-icons for lucide, fix em dashes/🎉 in copy, dead imports, skeleton/layout mismatch.

Re-run `/impeccable audit` after fixes to watch the score climb (target 16+/20).
