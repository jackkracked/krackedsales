# Money / Unit Economics — Contribution Margin & CAC (plan)

Source of truth: Gage's spec (~/Downloads/Contribution Margin & CAC Tracking_...txt). Swept
line-by-line, this plan aligns with all of §1–9. North star: phenomenally beautiful + 100%
accurate + flawless. NOT YET BUILT — this is the approved-before-build plan.

## The two questions (never mixed — spec §1,2,6.5)
A. "Is a client / an ad £ worth it?" → Contribution Margin (variable costs only, NO fixed overhead).
B. "Did the company keep money?" → whole-company: Total Contribution − Fixed Overhead = Surplus.

## Alignment refinements to match the sheet exactly
- Company P&L bridge shows **Total Contribution** as the mid-checkpoint, then subtracts fixed
  overhead → Surplus (spec §4 last formula).
- Realized CAC uses **rolling 30/60/90-day** windows (§5), distinct from the calendar Day/Week/
  Month toggle on the P&L.
- New-client count = ALL new client relationships (Management + Project), deduped at first
  acquisition point (§6.3 — the 6× fix). Acquisition-point definition to confirm with Jack.
- Lead every "money from a client" with the GUARANTEED 3-month floor; LTV shown as flagged upside (§6.6).

## The page (sections)
1. At-a-glance strip: Ad spend · New clients · Realized CAC (vs target) · LTV:CAC · CAC payback (mo).
2. ① Acquisition ("is our ad money worth it?"): acquisition bridge + per-PACKAGE table (profit $/%,
   payback, recommended max CAC, realized over/under). Never blended-only (§6, research).
3. Per-package RECIPE waterfall (this is where role hours show): price → −each role's time →
   −contractor fee → −commission → −card fee → = contribution. Proof of the profit %.
4. ② Company P&L bridge: Revenue → −variable → **Total Contribution** → −fixed overhead → Net kept.
   Visual bridge ↔ line-item table toggle; Day/Week/Month.
5. ③ Planner (what-if): ad spend + months + mix → clients, floor vs hope, net.
6. Assumptions drawer (the dials) — all editable, estimates flagged.

## Role hours per package  (input model — Jack correction)
- You NEVER type £/hr. Two inputs only: (a) each role's MONTHLY salary (entered once, seeded
  Designer $2,000 / Copy $3,750 / Strategist $6,000 / Tech $2,068); the hourly rate is auto =
  salary ÷ 160 (spec §34), never shown unless wanted. (b) HOURS per role per package in the grid.
  Cost is fully automatic. Show each package's deliverables beside the hours as context.
- DISPLAYED + EDITABLE: the hours GRID (roles × packages) in the Assumptions drawer, "estimate" banner.
- ON THE WATERFALL: per-package RECIPE waterfall shows each role's time as its own step. The COMPANY
  P&L waterfall shows the roles as their own always-visible lines (team spend visible with no click).

## Layout law — GLANCE FIRST (Jack correction: no clicking to understand)
The page is ONE scrolling story, ordered by altitude; the "spent X → got Y / company kept Z" answer
is the FIRST thing on landing, zero clicks. Below it: both bridges fully drawn (no clicks). Company
waterfall shows role lines inline. Further down (scroll, NOT click): per-package table (all 5 at once)
+ each package's recipe. Clicking is ONLY for editing a dial or an optional single-package deep-dive.
Nothing needed for first-glance understanding is ever hidden behind a click.
- MONDAY SEED: hours grid pre-filled with reasoned estimates TUNED so each package's profit % lands
  on Gage's known numbers (§9). So it's editable + matches his model from minute one. Gage edits real
  hours live in the meeting → everything updates. Contractor fee % seeded as a flagged placeholder.

## Inputs
LIVE (auto from the app): ad spend (Meta), revenue/cash (Stripe), new clients (proposals: paid,
distinct client, mgmt+project deduped), software costs, manual expenses, commission earned.
SET-ONCE-THEN-EDITABLE (seeded from Gage's numbers): package prices+deliverables, hours grid,
role rates, commission % (10%), card fee % (2.7%), contractor fee %, retention months (3/3/4/4/6),
fixed overhead (salaries/founder/insurance, itemizable), total revenue incl. off-Stripe white-label.

## Outputs
Per package: contribution $/%, guaranteed contribution, LTV contribution (flagged hope), payback
months, recommended max CAC, contribution per strategist hour. Blended target CAC, breakeven CAC.
Realized CAC (live) rolling 30/60/90 + per-tier/blended over-under. Company P&L surplus/net.
Planner projections.

## Build order
- v1 (Monday): everything above, accurate from today's numbers (profit driven by the seeded/editable
  hours grid, tuned to match §9). Live ad spend. Both bridges, per-package table, recipe waterfall,
  planner, editable dials.
- v2 (Gage's real hours): replace seeded hours; unlock per-person pay editing + profit-per-strategist-hour.
- v3 (data matures): real retention cohorts replace the estimate.

## Open confirmations (Monday)
Real hours table + contractor fee; $1,000 = custom downsell?; 3-month minimum vs "cancel anytime";
new-client acquisition point (first paid?); does Stripe capture ALL revenue or is white-label off-book.

## Reuse (existing app)
KPI engine (datasets→configs→run, supports ratio+combine), Meta ad-spend live, Stripe cash/MRR,
software_costs/manual_expenses tables + the settings pattern (single-row table + GET/POST). New:
a unit-economics settings group (packages, hours grid, rates, fees, retention, overhead) + the
compute + the Money page. Register: product (per PRODUCT.md). Match design system + r10n theme.
