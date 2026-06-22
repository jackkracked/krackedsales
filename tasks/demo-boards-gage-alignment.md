# Demo Boards — Gage Alignment Plan

**Goal:** make our Demo Boards feature read like Gage's `gage-Kracked/kracked-demos` — his layout, his ClickUp/Slack wiring, his sections — but powered by our DB/Blob engine and kept on OUR design system. Gage opens it and recognizes his page + his pipeline flow; underneath it's our richer, better-tracked engine. His standalone repo becomes a one-time reference, then frozen (one home).

## Decisions locked (Jack, 2026-06-15)
1. **Look:** OUR design system (cream/navy/gold, Inter + Plus Jakarta Sans), phenomenally beautiful — but in **Gage's LAYOUT** (50/50 canvas+panel, his sections/order). NOT his dark+lime.
2. **Engine:** keep OUR Postgres + Vercel Blob. Align wiring to his conventions.
3. **Our extra features** (positional pins/comments, per-prospect tracking, Boards dashboard): KEEP as bonus upgrades on top.
4. **Booking:** use Gage's **shared** LeadConnector intro-call calendar, but **inline & branded** in our panel (not a new-tab widget).

## Confirmed wiring facts
- Our app already uses the **same ClickUp DEMOS list** as Gage (`CLICKUP_DEMO_LIST_ID` is set; our `lib/utils/demo-stage.ts` already maps his exact statuses). Our `CLICKUP_API_TOKEN` reaches his workspace (25582702). → wiring alignment is config, not new credentials.
- Gage's exact ClickUp IDs (→ into `lib/demo-boards/integration-config.ts`):
  - List `901702473428` · Workspace `25582702`
  - Page-URL field (his "PSD"/we write OUR board URL here): `ec707ae9-2bb8-4f7f-afd6-218f188dfbcf`
  - Brand Hub field: `9b7ee613-0765-4897-8c28-29bd7efb3cc4`
  - Copy Doc field: `65a2e565-7550-43d8-92ee-5683621d9a82`
  - Statuses: `copy` → `design` → (`copy/design revision needed`) → `internal qa review` → `scheduled/live` (+ `on hold`)
  - Task naming: demo task = `"{Brand}: Email Demo"`; email type from sibling `"{Brand}: {Type} Email"`
  - Ref code format: `DEMO·{SLUG[:6].UPPER}·{ddMon...}` (his exact `'DEMO\xB7'+slug.slice(0,6).toUpperCase()+'\xB7'+today.replace(/\s/g,'').slice(0,4)`)
- Slack: incoming webhooks — design channel `C069HBWAGAH` (env `SLACK_WEBHOOK_DESIGN`), sales channel `C0AUWSHDGF9` (env `SLACK_WEBHOOK_SALES`), Gage UID `U013TBC8TFH`.
- GHL: location `qg7S6Yx9XxcRKUYZpjsi`, **shared** calendar `M76E0edO2ZfonEXiQ5bf`, booking widget slug `email-design-demo-intro-call`. (We already have GHL creds.)
- Google Drive parent folder `1VQ4Q5LJnBTds3MLLzlXmrUf5LptUK0KI` (optional parity — per-brand asset folder).

## What Gage's page has that we must add (in OUR design system, his layout)
1. **Canvas tag** pill top-left of the design: `"{EmailType} · Email Design"`.
2. **Meta pills** in the panel: `Type` · `Built on Shopify + Klaviyo` · `Prepared {date}`.
3. **"Next Steps"** section label + the 25-min strategy-call copy block (adopt his wording).
4. **Case Studies** — 3 accordions with his exact copy/stats: California Naturals (81% list growth / 16.6% flow rev / 1,075+ conversions), Optimize Minerals (40% churn drop / 6.2× cancel-save / 471% peak ROI), Fly By Jing (53.6% open / 334 campaigns / 44% geo-open). Build the accordion in our system.
5. **Intro copy** (his): "Our team designed this retention email from your live store — your products, your brand, your customer journey. Explore the design, then grab a time with us below."
6. **On-page team import** (his FAB → email-gate → drop PNG → publish): add an import affordance on the public board that posts to our Blob upload. Keep the cockpit as the primary path; the on-page import matches his flow for designers working from the live page. (Auth: match his `@krackedretention.com` email-gate, OR reuse our session — TBD, default to email-gate to mirror his.)
7. **Footer**: `© 2026 Kracked Retention · krackedretention.com · {refCode}`.
8. **Canvas parity**: Cmd/Ctrl+scroll zoom (have), pinch (ADD for touch — was flagged as a follow-up), Fit / 100% / +/- buttons, dblclick toggle, keyboard +/-/0. (We already added trackpad pan + pinch-via-ctrl; add touch pinch + a 100% button + keyboard shortcuts for full parity.)

## We KEEP (bonuses Gage doesn't have)
Positional pin comments (internal + shared), per-board event tracking, the Boards command-center page, the cockpit, DB persistence, token privacy.

## Build sequence (each phase: tsc + deploy gate; UI phases go through `/impeccable shape → craft → polish → harden`)

### G1 — Wiring seam alignment (no UI)
- Fill `integration-config.ts` with Gage's exact IDs/fields/statuses/Slack/GHL/Drive values above.
- Change `clickupConfig.stages` to his **exact API strings**: `inReview: "internal qa review"`, `sentToClient: "scheduled/live"` (currently title-case — must match what ClickUp's API expects).
- Align `referenceCode()` to his `DEMO·…` format.
- Extend `slack-adapter.ts` to two channels (design/sales incoming webhooks) + his message shapes.
- **Cascading check:** confirm our ClickUp adapter writes use these exact status strings; verify `demo-tracker` still renders (it already maps these statuses).

### G2 — Re-shape the public board to his layout, our skin (UI)
- `/impeccable shape` the new panel structure first (gate). Then craft: add canvas tag, meta pills, Next Steps copy, Case Studies accordion, intro copy, footer ref code — all in our design system, his order/layout. Keep pins + tracking. Polish + harden.

### G3 — Booking → shared calendar, inline & branded
- Repoint the inline slot-picker from rep-routing to Gage's **shared** calendar (`M76E0edO2ZfonEXiQ5bf` / location via seam). Keep our beautiful inline picker + booked state + board attribution. Add UTM-style campaign = board slug for parity with his tracking.
- Move calendar/location/booking-slug into `integration-config.ts`.

### G4 — ClickUp-driven board creation (replicate poll.js, event-driven)
- Extend our existing `/api/webhooks/clickup` (already registered, already does status sync): when a `"{Brand}: Email Demo"` task in list `901702473428` enters `copy` (or is created), **create a board** if none exists (contactName = Brand, title = email type from sibling task), set `clickupTaskId`, write OUR board URL into the page-URL field (`ec707ae9…`), comment on the task, and Slack the design channel — exactly Gage's poll.js outcome, but event-driven (no 15-min poll, no 1-task/run 10s limit). Non-fatal.
- Keep our demo-webhook auto-create too (covers demos created from our app).

### G5 — Daily Slack recaps + health (replicate tally.js + health.js)
- New daily Vercel crons (Hobby = daily OK): `tally` (Daily Design Recap table + Daily Sales Summary, sourced to match his — ClickUp pipeline counts + GHL bookings, enrichable from our DB) and `health` (HEAD-check our live board URLs → DM Gage on failures).
- **MUST export GET handlers** (our cron memory: Vercel Cron triggers via GET; POST-only crons never run).

### G6 — Optional parity + finish
- Optional: per-brand Google Drive folder on board creation (needs GDRIVE creds); on-page email-gated import polish.
- Full live E2E (ClickUp copy-task → board → upload → review→internal qa review → send→scheduled/live → open → book on shared calendar), then batched deploy.

## Env to provision (NAMES only — never store values in memory)
`BLOB_READ_WRITE_TOKEN` (still pending), `SLACK_WEBHOOK_DESIGN`, `SLACK_WEBHOOK_SALES`, `SLACK_GAGE_UID` (or hardcode in seam), GHL shared calendar/location (have GHL creds), optional `GDRIVE_*`. ClickUp token + demo list already set.

## Cascading-effects guarantee
- Public board restyle = isolated surface (own routes/components, like the proposal page) → zero app-wide impact.
- Stage-string change touches only our ClickUp adapter writes + must stay consistent with `demo-stage.ts` (verify).
- Slack 2-channel + new crons + webhook board-create = all additive, all non-fatal/guarded.
- Nothing here changes existing pages, the inbox, KPIs, proposals, or pipeline.
