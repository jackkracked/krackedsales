# ⭐ SESSION HANDOFF (2026-06-22) — read this first

Long session; continuing in a fresh session. Working tree clean except this file + the drafted `audits` table in lib/db/schema.ts (Phase 2 groundwork, committed as WIP).

## Shipped + deployed + verified this session
- Contacts toggle-pill filter sheet (commit 726659b)
- All Create Audit/Demo/Task buttons wired (commit 6f34965)
- Premium Create Audit modal redesign — manual fields, creator defaults, balanced (commit eb2b123). NOTE: creator-default person fields don't pre-fill yet — `/api/me` returns no `name` (fix in B).
- Pre-call prep = icon-only on call tile (commit c7e57d6)
- **A — Calls Logged fix (commit 2775b76):** calls table was empty after 2026-04-09. Now syncs GHL calendar bookings as callType "meet" (dedup meetConferenceId=`ghlappt_<id>`) in runSync. Verified: 306 calls total, **32 this month (was 0)**. Daily cron /api/cron/sync-calls keeps it current.

## REMAINING BACKLOG (Jack wants ALL, "100% accurately + beautifully")
- **B — Audit Phase 2 (tracking): ✅ DONE + DEPLOYED + VERIFIED (commit 048bad8, 2026-06-22).** /api/me name fix · migration 0015 applied to prod · create-audit DB write · contacts hasAudit/auditStatus join · "Audit delivered" filter card enabled · daily /api/cron/sync-audits. Two follow-ups: (1) confirm exact ClickUp "Delivered" status name to tighten isDelivered(); (2) one live end-to-end test (create audit → row → mark delivered → cron → filter). The demo-modal reskin was split out to **Phase 2b** (needs its own /impeccable pass). See the Audit Phase 2 section below.
- **C — Activity tab: show call outcomes. ✅ DONE + DEPLOYED + VERIFIED (commit c8e3032, 2026-06-22).** Used the call_dispositions table (keyed by contactId), not the calendar caveat path. Call outcomes now show in BOTH modals: contact Timeline gets a structured `call_outcome` row ("Call: No-show", toned phone icon, notes; the raw "[Call outcome:]" GHL note is de-duped); opportunity Activity merges dispositions via /api/activity?contactId and renders the existing pill with semantic tones. Single source of truth: lib/activity/outcomes.ts. Verified live on prod for a real no-show (contact eV3...): timeline event + activity merge both correct, no dup note. ALSO shipped the Contact/Opportunity modal identity system (navy round = person, gold square = deal; type chips + header wash + value elevated) — Jack approved the "full identity system" via /impeccable shape; verified beautiful + distinct on prod.
- **D — Call recordings linked per contact.** OPEN QUESTION: recordings source. Google Meet recordings need Workspace (not configured); Fathom needs key (not set). GHL dialer TYPE_CALL messages may carry a recording URL (check meta/attachments). Clarify with Jack where recordings live before building.
- **E — Mark conversation as read.** Inbox: add a way to clear unread so it doesn't persist. Self-contained. Look at components/inbox + the unread source (GHL conversation unreadCount or local state).

## Calls data caveat (affects A polish + C/D)
GHL /calendars/events list returns sparse fields — contactName/contactId/assignedUserId null for many events. The count (A) works, but per-contact linkage (C/D) and rep attribution need a richer fetch.

---

# Audit Request feature — AI auto-fill + tracking + unified modal redesign

**Status:** requirements locked (grill-me done 2026-06-22). Next: /impeccable shape.

## Locked requirements
- **Auto-fill** (Gemini): Brand+Website from data · ESP detected from site · Relevant Details drafted from qual Q&A · both pitch fields AI-suggested · Hiro default No · Strategist/Reviewer/Client Contact default to creator (logged-in user → ClickUp member by name). All editable.
- **AI-fill UX "Live drafting":** open instantly, hard fields filled, AI fields shimmer+sparkle+LOCKED until values animate in (then unlock + "AI" chip); ~8s timeout → unlock empty.
- **Submit:** ClickUp task as today (reuse /api/clickup/create-audit) + write new `audits` DB table (ghlContactId ↔ clickupTaskId + field values, requestedAt, status).
- **Tracking:** daily cron syncs ClickUp task completion → deliveredAt/status=delivered → powers "Audit delivered" filter (Yes=delivered) + KPIs. Add hasAudit/auditStatus to UnifiedContact + contacts route.
- **Beauty:** full unified premium redesign of BOTH audit + demo modals (one shared "request" design language, proposal-wizard/filter-sheet bar). Audit keeps 2-step; demo elevated.

## Done already this session
- [x] Swept + fixed all Create Audit/Demo/Task buttons (wired 2 dead audit buttons, 2 contacts half-baked) — deployed, verified on prod (commit 6f34965)

## REVISED after grill (2026-06-22): NO AI auto-fill
Jack: audits follow a call, so ESP/Details/pitches are entered manually from call info. Dropped Gemini + live-drafting entirely. ESP keeps all 5 ClickUp options. All 3 person fields (Strategist/Reviewer/Client Contact) default to the creator. Hiro default No.

## Phase 1 — premium audit modal — ✅ DONE + DEPLOYED (commit eb2b123, live on prod)
- [x] /impeccable shape (coded mockups, Jack approved direction; AI layer later cut)
- [x] Rebuilt create-audit-modal.tsx: shared "request" primitives, balanced equal-size fields (ESP+Client Contact aligned), step rail, premium shell (blur/ring/scale-in), portal + Esc + reduced-motion
- [x] Brand+Website auto from qual note (✓auto); ESP/Details/pitches manual; Hiro default No
- [x] Verified live on prod (modal opens, both steps balanced, Hiro=No default)

## Phase 1 gap → fold into Phase 2 — ✅ FIXED (commit 048bad8)
- [x] Creator-default person fields: `/api/me` now returns `name`. memberIdForName(me.name) can match a ClickUp member (modal already wired to use me.name). Live test pending (see Phase 2 verify-after).

## Phase 2 — tracking — ✅ DONE + DEPLOYED + VERIFIED (commit 048bad8, 2026-06-22)
- [x] Fix /api/me to return `name` (creator-default) — getSessionUser already had it; added to JSON
- [x] `audits` table migration 0015 (additive/idempotent) — applied to prod, 11 cols verified, 0 rows
- [x] Extend /api/clickup/create-audit to insert audits row (taskId PK + ghlContactId + createdBy from session; non-fatal try/catch; onConflictDoNothing)
- [x] hasAudit/auditStatus on UnifiedContact + contacts route join (auditMap, delivered wins) + applyRule "auditDelivered" case
- [x] Enable "Audit delivered" filter card + ContactFilters.audit Tri + filtersToRules + filtersToParams + parseFilters + countActive (removed Coming-soon Lock)
- [x] Daily delivered-sync cron /api/cron/sync-audits (GET + CRON_SECRET, per-task fetch) → status/deliveredAt; vercel.json 0 10 * * *
- [x] Security/data review (Gates 5+6) passed; tsc clean; deployed READY; cron verified live (401 unauth, {pending:0} authed)

### Self-audit — ✅ data/cron/logic layers PASS (2026-06-22)
- [x] **Exact delivered status CONFIRMED:** Account Audits list real statuses are "audit needed" (open), "ready to send to client" (custom), "client received" (type=done, 86 tasks = the real delivered status), "on hold (missing access)" (open), "Closed" (type=closed). `isDelivered()` classifies ALL FIVE correctly (delivered = client received + Closed, via the type=done/closed check). No change needed; raw name stored in `clickup_status` anyway.
- [x] **Cron flip PROVEN on prod:** inserted 2 sentinel rows (real done-task + real open-task) → ran deployed cron → returned {pending:2,checked:2,delivered:1} → "client received" flipped to delivered (deliveredAt + clickup_status set), "audit needed" stayed requested. contacts auditMap yielded hasAudit/auditStatus/auditDelivered correctly. Sentinel rows deleted; table back to 0 rows. (used SELFTEST ghl ids that match no real contact, zero pollution.)
- [x] Build READY on prod, tsc clean, cron route enforces CRON_SECRET (401 unauth).
- [ ] **Remaining = 2 quick UI eyeball checks (need Jack's session, do together):** (1) open a contact → Create Audit → submit → confirm a row lands in `audits` with the right ghlContactId + the modal's person-fields pre-fill from /api/me name; (2) Contacts → filter sheet → confirm "Audit delivered" card is enabled (no "Coming soon") and toggling Yes/No persists to URL + filters the list. Not done autonomously: submitting creates a real ClickUp task in the live Account Audits list.

## Phase 2b — demo modal reskin (SEPARATE — needs its own impeccable pass)
- [ ] Re-skin demo modal with the shared request-modal primitives. This is a UI feature → run /impeccable shape → craft → polish → harden. NOT part of the tracking spine; deferred so tracking could ship clean.

---

# Contacts Advanced Filters — toggle-sheet rebuild (impeccable craft)

**Status:** in progress · 2026-06-22 · Jack approved direction **B + stage color** (hero live-count, tinted groups, rep avatars, semantic stage pills)

## Plan — ✅ COMPLETE (2026-06-22, deployed to prod)
- [x] `lib/contacts/filters.ts` — FilterRule types, ContactFilters model, pill catalogs, filtersToRules(), URL serialize/parse, countActive, stage tint
- [x] Extend API `app/api/contacts/route.ts` applyRule() — platform, channel, assignedTo, urgency, daysInCurrentStage, hasProposal, reachableChannels
- [x] Build `components/contacts/filter-sheet.tsx` (states, keyboard, reduced-motion, responsive, a11y, hero count-up)
- [x] Rewire `contacts-client.tsx` — ContactFilters state, live filtering, URL persistence, count badge, search + All/Unread/No-response presets, smart lists store ContactFilters
- [x] Delete `advanced-filters-panel.tsx`; add prefers-reduced-motion guard in globals.css
- [x] Verify tsc (clean) + in-browser visual check (clean console, fixed hydration); removed temp mock + reverted proxy.ts
- [x] Polish + harden; security/data review (read-only, passed); deployed `vercel --prod` (commit 726659b)
- [x] Verified LIVE on prod: 3,131 → 1 live filter, count-up, URL persist, emerald stage colour, real GHL stages

## NEXT TASK (Jack: "closed tab") — ✅ DONE (commit 048bad8)
- [x] Wired **Audit delivered** tracking + enabled the filter card in filter-sheet.tsx (see Audit Phase 2 section above)

## Decisions
- Filtering is SERVER-SIDE via existing `rules` engine — sheet emits FilterRule[] (is_any_of = OR within card, and = AND across cards). Minimal-impact reuse.
- Opt-in source: GHL contacts hardcoded platform="lead_form"; only comment leads carry real FB/IG/TikTok. Pills honest to stored data. Flagged to Jack.
- Available channels: only Email/SMS derivable → Email only / SMS only / SMS+Email. IG DM lives under Last contact channel.
- Lead score CUT (opaque). Audit delivered = disabled "coming soon" (wiring is the next task).

---

# Proposal Builder Redesign — Guided Wizard (impeccable craft)

**Status:** in progress · 2026-06-11 · Jack approved the shape brief ("go for it, build it")

## Design (approved)
Guided wizard, one decision per screen, plain-language deal shapes, persistent live "deal line", and a document-grade animated reveal. Reuses the proven billing engine (self-cancelling subscription, discount engine, server guardrails) — re-skin, not a billing rewrite.

## Spine (dynamic steps)
client → work → scope → deal → price → [schedule?] → reveal
- schedule only when: project + split (instalments) OR management retainer + deposit.

## Deal shapes (friendly UI over existing form fields)
- Management: "Auto-renewing retainer" (autoRenew=true + cadence + optional deposit) · "Fixed term, paid once" (autoRenew=false + length months)
- Project: "One payment" (single) · "Split into payments" (instalment)

## Preserve verbatim (revenue-critical)
FormState, billedTotalOf, compileScope, ContactSearch, FlowPill, handleSubmit + the API payload, the discount/billed math. Only the rendering/navigation changes.

## Build steps — ✅ COMPLETE (2026-06-11)
- [x] Rewrote proposal-create-modal.tsx as the guided wizard (motion transitions, AnimatePresence between steps, reveal price count-up + staggered nodes + savings pill; reduced-motion respected via useReducedMotion)
- [x] tsc + eslint clean (0 errors)
- [x] deployed + screenshot-verified all 7 screens on prod (Playwright harness, since removed) — ZERO console errors end-to-end
- [x] polish pass: fixed the reveal "Covers" node (now shows duration "6 months", not a truncated date range)
- [x] harden reasoning: $0 blocked, no-discount gated, long names use firstName, reduced-motion handled, submit shows Sending… + disabled
- [x] cleaned up temp harness + playwright; redeployed READY

Outcome: dead-simple guided wizard. Deal shapes (Auto-renewing retainer / Fixed term paid once · One payment / Split) are a friendly layer over the existing autoRenew + paymentStructure form fields — the proven handleSubmit payload + billing engine are UNCHANGED. Verified beautiful + flawless on prod.

## Visual elevation pass ("The Instrument") — ✅ COMPLETE (2026-06-11)
Jack: "make it magnificently beautiful / outrageously creative / one hell of an experience" + fix the contact dropdown being clipped. Used emil-design-eng (motion) + impeccable craft.
- [x] Contact dropdown CLIPPING FIXED — portaled to document.body (position:fixed, repositions on scroll/resize) so the modal's overflow can't clip it.
- [x] Cinematic shell: richer ink/45 backdrop + blur, paper #FBFBF9 card, premium layered shadow + ring, scale-in entrance (EASE_OUT 0.28s).
- [x] Refined header: `02 / 06` tabular counter + step label + animated filling progress rail.
- [x] Bigger editorial headings (1.6rem, -0.02em, balance).
- [x] ChoiceCard: bold full-navy selected for cards w/o sub-options (work, project-deal); rich navy-tint for cards w/ controls (retainer/fixed-term, legibility); hover lift, press scale, spring-expanding sub-options, inverted icon tile, springing radio.
- [x] Segmented control with "magic" sliding navy pill (layoutId spring) for cadence/length — 4 presets one row + "or set a custom period" link (no wrap).
- [x] Deal line: refined navy strip, updates in place.
- [x] Reveal: soft glow behind a bigger 3.25rem count-up, shimmering green savings pill, nodes with connectors that draw in.
- [x] Footer: primary press scale + arrow nudge on hover; back active-scale.
- [x] All ease-out custom curves, reduced-motion fully handled (useReducedMotion).
- [x] Verified on prod via Playwright screenshots (since removed): all screens render, ZERO console errors. tsc + eslint clean. Engine UNCHANGED.

## Design tokens (real)
paper #FAFAF7 · ink #1C2333 · primary petrol-navy #0F3A5C · forest-green #2D5E3F (savings only) · Plus Jakarta Sans headings · radius 8/10px
