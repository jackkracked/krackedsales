# Demo Boards — Sequenced Build Plan

**Status:** ALL 6 PHASES BUILT · 2026-06-14 · deployed to prod (full Next build passing). Public hero visually QA'd (desktop + mobile) ✓. Remaining before "100% done": provision `BLOB_READ_WRITE_TOKEN`, Gage-alignment checklist, and a live E2E (upload → review → send → open → comment → book) once Blob + a real GHL contact/calendar are available.

## Build progress
- [x] **Phase 0 — Foundations** — 4 tables migrated to prod (0013, verified live), `@vercel/blob` installed, `integration-config.ts` (the Gage seam), `lib/demo-boards/tokens.ts` + `queries.ts` (board lookup, comments-by-visibility, event funnel `logBoardEvent` + `recordBoardOpen`). tsc clean.
- [x] **Phase 1 — Public board (hero)** — `/board/[token]` route + layout, `GET /api/boards/public/[token]` (read-only) + `POST .../track` beacon (allowlisted events), `DemoBoardPage` (two-panel, splash/missing/pending states), `DesignCanvas` (cursor-aware zoom/pan, fit, placeholder shimmer, time-on-design heartbeat), `BrandPanel` (prepared-for, meta, sticky Book-a-call w/ sheen, scroll-depth track, ref code), `BookingPanel` (slide-over shell — Phase 4 fills the scheduler at `[data-booking-slot]`). `.dotgrid` canvas texture in globals.css. tsc clean.
- [x] **Phase 2 — Designer upload + lifecycle** — `POST /api/boards/[id]/design` (Vercel Blob `put`, versioned, 25MB guard, assigns designer), `POST .../review` (gated on design → in_review + ClickUp Internal QA + Slack), `POST .../send` (channel composer → GHL `/conversations/messages` → sent + ClickUp Scheduled/Live + Slack; only marks sent if message actually goes), `GET /api/boards/[id]` (full internal view). ClickUp write methods added to client; `clickup-adapter.ts` + `slack-adapter.ts` + `urls.ts` (all safe no-ops when unconfigured). Admin cockpit: `/(app)/boards/[id]` + `board-cockpit.tsx` (drag-drop upload, design preview + replace, lifecycle buttons, send composer, activity timeline). tsc clean.
- [x] **Phase 3 — Comments (positional pins)** — `comments.tsx` (reusable: `CommentPins` ride the scaled canvas, counter-scaled, internal=amber+lock / shared=navy / resolved=check; `CommentThreadPanel` screen-space slide-in with reply/resolve/delete + visibility toggle; `CommentToggle`). Wired into `DesignCanvas` (add-mode drops a pin → composer) used by BOTH the public board (prospect mode, shared-only, posts to `/api/boards/public/[token]/comments`) and the cockpit (team mode, all pins, internal/shared). Routes: public prospect comments (→ engaged + Slack + ClickUp mirror), team `POST /comments`, `PATCH/DELETE /comments/[commentId]` (resolve/reopen/delete). Public board polls 25s so replies appear live. tsc clean.
- [ ] **Phase 4 — Booking (rep-routed scheduler into the BookingPanel seam)**
- [ ] **Phase 5 — Boards page + tracking surfaces**
- [x] **Phase 6 — Integration wiring (buildable parts)** — Board **auto-creates** on every demo request (`createBoardFromDemo` wired into `/api/webhooks/demo`, non-fatal). ClickUp **two-way sync** added to the existing `/api/webhooks/clickup` (`clickup-sync.ts`: for a tracked task, reflects mapped status → board + backfills the board-link field; safe no-op for unknown tasks). Slack notifications already fire from lifecycle/comment/book routes. tsc clean.

### Gage-alignment checklist (when `gage-Kracked/kracked-demos` lands — edit ONLY `integration-config.ts` unless noted)
- [ ] `clickupConfig.boardLinkFieldId` → his "Brand Hub" custom-field **id** (set env `CLICKUP_BOARD_LINK_FIELD_ID`).
- [ ] `clickupConfig.stages.inReview` / `sentToClient` → confirm exact ClickUp status strings match his list.
- [ ] `slackConfig.webhookUrl` + message copy → his channel + wording (set env `SLACK_DEMO_BOARDS_WEBHOOK_URL`).
- [ ] `referenceCode` / `boardSlug` / `PLACEHOLDER_*` → match his naming + copy.
- [ ] **Board-create-from-new-task**: `clickup-sync.ts` only syncs tasks already linked to a board. If we want a ClickUp task created outside our demo flow to spawn a board, add his contact-field mapping there (the one seam that needs his payload shape).
- [ ] **n8n**: disable the **Miro-board-creation step** in his demo flow (the board now replaces it). Our `/api/webhooks/demo` already auto-creates the board on the same request.
- [ ] **`BLOB_READ_WRITE_TOKEN`**: provision a Vercel Blob store (see blocker below).

## Verification log
- 2026-06-14: deployed Phases 0-3 to prod — **full Next build PASSED** (READY). Seeded a board (Maya Chen / Steamy), confirmed `/board/[token]` serves 200 + correct API payload. Added `/board/` + `/api/boards/public/` to `proxy.ts` PUBLIC_PATHS (was 307-redirecting to login). Screenshot QA of the hero: brand rail = premium ✓. Fixed: canvas now fits-to-WIDTH (was 42% full-height = tiny); mobile now leads with the design (50svh) then brand panel (was squeezing design to nothing); dot-grid bumped for subtle texture. Fixes built, pending next batched deploy.

## ⚠ Blockers for Jack
- **`BLOB_READ_WRITE_TOKEN`** must be provisioned (Vercel → Storage → create a Blob store; it auto-adds the env var). Designer upload (Phase 2) can't store images without it. Everything else proceeds.

---

_Original plan below._

## What we're building
A branded, hosted **demo board** per prospect that replaces the bare Miro board. Two panels: LEFT = the prospect's email design (designer-uploaded, infinite zoom/pan canvas, positional comments); RIGHT = branded Kracked panel (prepared-for, pitch, tags, a sticky "Book a call", resources). Generated automatically from the Create-Demo flow, synced two-way with ClickUp, sent to the client via the inbox channels, and tracked event-by-event. A new **Boards page** (sortable command center) + Demo Tracker enrichment + per-board timeline + KPIs.

## Confirmed decisions (from grill-me)
1. **Lifecycle/ClickUp sync:** board auto-created with the demo task. "Send for review" → ClickUp **Internal QA**. "Send to client" → ClickUp **Scheduled/Live**. Two-way sync (board drives ClickUp on those moves; ClickUp webhook drives the board). "Send for review" gated on a design existing.
2. **Storage:** **Vercel Blob** (CDN-served, any type/size). No Drive.
3. **Access:** tokenized personal link = no gate for the intended prospect (logs "Opened"). Email opt-in gate is the fallback for forwarded/cold opens (captures a NEW lead).
4. **Send to client:** a composer (message + channel) reusing the **inbox channels/send routes**; channel pre-selects to the prospect's **last active channel** (fallback Email); pre-filled editable message with the link; threads into the inbox; logs "Sent".
5. **Comments:** **positional pins** (Miro-grade), each a resolvable thread. Two modes: **Internal (team-only)** vs **Shared (client-visible)** with an unmistakable visual difference. Prospect comments → Slack + in-app + mirrored to ClickUp task. Team replies → prospect pinged.
6. **Booking:** inline on the board (slides in, real motion), **intelligently routed** to the demo's owning rep → their calendar; fallback to booking-rules. Attributed to the demo → pipeline/KPIs.
7. **Tracking:** a dedicated **Boards page** (sortable/filterable list — Client · Rep · Designer · Stage · Sent · Opened · Viewed · Comments · Booked · Last activity) AS WELL AS Demo Tracker enrichment (engagement badges + click-through) + a per-board **timeline** + funnel KPIs. Events: Created · Design uploaded · Sent(+channel) · Opened · Viewed · Time-on-design · Scrolled-bottom · Re-opened · Forwarded/shared · Comment · Booked · Closed.

## THE GAGE SEAM (so his GitHub drops in easily later)
A single module `lib/demo-boards/integration-config.ts` holds EVERY external-integration specific, defaulted now, retuned from Gage's repo later WITHOUT touching feature code:
- ClickUp: demo list id, the board-link custom field (his "Brand Hub"), stage names (Internal QA / Scheduled/Live), comment-mirror target, task-link format.
- Slack: channel(s) + message templates (demo requested · ready for review · sent · booked · daily summary).
- Naming: reference-code format (his `DEMO-DRINKS-0613`), board title, placeholder copy ("Design on its way"), board URL slug rule.
- n8n: which step to disable (Miro creation) — documented, not code.
All ClickUp/Slack calls go through thin adapters that read this config. When Gage's repo arrives: read it → map his field ids/formats/templates into this one file → done.

## Data model (Gate 6)
- `demo_boards` (id, token, slug, demoTaskId, contactId, contactName, repId, designerId, status, referenceCode, createdAt, sentAt, sentChannel, lastActivityAt)
- `demo_board_designs` (id, boardId, blobUrl, mimeType, width, height, version, uploadedBy, createdAt)
- `demo_board_comments` (id, boardId, designId, x, y, body, authorType[prospect|team], authorId, authorName, visibility[internal|shared], parentId, resolvedAt, createdAt)
- `demo_board_events` (id, boardId, type, actor, metadata jsonb, createdAt)
- forwarded/opt-in viewers → captured as events + (optionally) a lead in the existing contacts/pipeline.

## Phases (each: shape → craft → polish → harden; Gate 5/6 on data + external sends)
- **Phase 0 — Foundations:** migrations (4 tables), Vercel Blob setup, the `integration-config.ts` seam + thin ClickUp/Slack adapters, the token/slug model, `/board/[token]` public route skeleton.
- **Phase 1 — The public board (the hero):** the two-panel prospect experience — infinite-canvas design viewer (zoom/pan, placeholder state) + branded right panel (prepared-for, pitch, tags, sticky Book-a-call, resources). Tokenized access; opt-in gate fallback. Outrageously beautiful, on our design system. Records Opened/Viewed/Time/Scroll/Re-opened/Forwarded.
- **Phase 2 — Designer upload + lifecycle:** team-auth uploader (Blob, any size), "Send for review" → ClickUp Internal QA, "Send to client" → channel composer (inbox send) → Scheduled/Live. Status + event logging. Version history.
- **Phase 3 — Comments:** positional pins, internal/shared modes, threads, resolve, two-way notify (Slack + in-app + ClickUp mirror).
- **Phase 4 — Booking:** inline booking panel (motion), intelligent rep/calendar routing, attribution to demo → pipeline/KPIs.
- **Phase 5 — Boards page + tracking surfaces:** the sortable/filterable Boards page, per-board timeline, Demo Tracker engagement badges, funnel KPIs.
- **Phase 6 — Integration wiring + Gage alignment:** Create-Demo → board auto-create + ClickUp board-link field, ClickUp webhook two-way sync, Slack notifications, n8n Miro-step removal (documented). When Gage's repo lands: align the seam.

## Cascading effects to handle
Create-Demo flow, ClickUp custom fields + webhook, Demo Tracker, KPIs (new board-funnel lines), inbox/pipeline (opt-in + forwarded leads), Slack, the public-link/auth model (new public surface like the proposal page), n8n (disable Miro step).

## Verification per phase
tsc + eslint; deploy to prod; Playwright screenshots of every new surface; adversarial money/data review on the lead-capture + ClickUp-write + send paths; live E2E on the lifecycle (create → upload → review → send → open → comment → book) before "done".
