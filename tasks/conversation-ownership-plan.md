# Conversation Ownership & Last-Responder — Execution Plan

**Goal:** On the dashboard conversations section, each rep (e.g. Alice) sees only what's relevant to them, leads can't fall through the cracks, and the main account (Gage) keeps a full overview.

## Agreed model (shared pool + claim-by-reply)

- **New lead lands → UNASSIGNED** (shared pool). Nothing auto-assigns on arrival.
- **Rep dashboard (Alice)** shows the UNION of:
  1. `unassigned pool` (claimable by anyone)
  2. `assigned to me`
  3. `I was the last to respond`
- **Claim-by-reply:** the moment a rep replies (in-app OR in GHL), they become the last responder AND we write `assignedTo = rep` back to GHL. The thread leaves other reps' pools and stays on that rep's page.
- **Gage = main account.** Admin dashboard sees EVERYTHING with a rep icon (already built) showing who owns / that it's unclaimed.
- **Roll-up to Gage:** a lead unclaimed for **24h** auto-assigns to Gage (the "all other conversations → Gage").
- **Channels:** ALL channels. GHL (SMS/email/calls) uses real GHL write-back. **Meta/TikTok** have no GHL assignment, so they use an **app-side ownership model** (ownership stored in our DB only; last-responder from the in-app activity log; Gage roll-up handled in our DB). ⚠️ Flagged as the biggest added-complexity item.
- **Backfill:** infer last-responder/ownership for existing open threads from already-stored data (GHL `rawData.userId` + in-app `activity_events`). Best-effort; some old threads may stay "unknown" until next reply.

## Key facts established (from codebase + GHL docs)

- GHL `OutboundMessage` webhook **includes `userId`** when a human sent the reply (absent for pure automation) → maps to `users.ghl_user_id`. We currently DROP this field.
- Shared GHL client exists: `lib/ghl/client.ts` (`ghl.get/post/put/patch`, auth via `GHL_PRIVATE_TOKEN`, retries/backoff built in).
- Contact update already works: `app/api/ghl/contacts/[contactId]/route.ts` does `ghl.put('/contacts/{id}', payload)`. GHL assigns at the **contact** level (`assignedTo`); conversations inherit it.
- Assignment stored locally on BOTH `local_contacts.assigned_user_id` and `local_conversations.assigned_to`; webhook upserts are idempotent (`onConflictDoUpdate`) → natural loop damping.
- In-app sends are already attributed via `activity_events` (`action="message.sent"`, with userId/userName).
- `local_messages` has NO author column today. Schema: `lib/db/schema.ts`.
- **Gage has NO stored GHL user id anywhere** — must be fetched once and stored.
- Webhook has NO signature verification (out of scope, noted).
- Dashboard data comes from `app/api/inbox/queue/route.ts` (current `scope=mine` filters by `assignedToId` only — TODO comment already flags phase-2 last-responder).

---

## Phase 0 — Prerequisites / config (DE-RISK before building anything)
- [ ] 0.1 Fetch Gage's GHL user id via `GET /users/?locationId={GHL_LOCATION_ID}` (greenfield — no existing list-users call; verify response shape `{ users: [...] }`); identify "Gage Flesher".
- [ ] 0.2 Store it as `GHL_GAGE_USER_ID` env var (Production-only, per project convention). Add a typed accessor in `lib/ghl/`.
- [ ] 0.3 Confirm Alice (and any other reps) have `users.ghl_user_id` populated in Team Settings; if not, capture them.
- [ ] 0.4 **Verify `userId` presence:** inspect a real production outbound `local_messages.raw_data` row — does GHL include `userId` for SMS/email in THIS account? If not, GHL-side replies can't be attributed (only in-app sends will).
- [ ] 0.5 **Verify write-back (C6):** confirm `PUT /contacts/{id}` with `{ assignedTo }` actually reassigns owner in GHL v2 on ONE test contact. The existing contact-PUT only ever sent website/email/phone — `assignedTo` is unproven here. Whole Phase 2/3 depends on this.

## Phase 1 — Capture message authorship (data layer)
- [ ] 1.1 Migration: add `local_messages.sent_by_ghl_user_id` (text, nullable).
- [ ] 1.2 Migration: add `local_conversations.last_responder_ghl_user_id` (text, nullable) — denormalized for fast dashboard queries.
- [ ] 1.3 `lib/ghl/sync.ts` `upsertMessage`: accept + store `sentByGhlUserId`. ⚠️ **CORRECTED (C2):** `upsertMessage` uses `onConflictDoNothing()` (sync.ts:312), so the conversation last-responder update must be a **separate UPDATE on `local_conversations`**, NOT folded into the message insert. **Guard it by date:** only advance `last_responder_ghl_user_id` if the incoming outbound's `message_date >= conversation.last_message_date` — prevents replayed/out-of-order webhooks from setting a stale responder.
- [ ] 1.4 `app/api/webhooks/ghl/route.ts`: on `OutboundMessage`, extract `body.userId` and pass into `upsertMessage` + the guarded conversation update.
- [ ] 1.5 In-app send path `app/api/ghl/conversations/[conversationId]/messages/route.ts`. ⚠️ **CORRECTED (C3):** this path does NOT insert into `local_messages` (only the webhook does, later). So directly bump `local_conversations.last_responder_ghl_user_id = sessionUser.ghlUserId` here, using the author we already have at the `logActivity` call (:88-99).
- [ ] 1.6 Meta/TikTok. ⚠️ **CORRECTED (C4):** `platform_replies` (schema.ts:488) has NO responder column, and the Meta/TikTok send routes capture NO session user. This is a multi-file change: (a) migration to add `responder_user_id` to `platform_replies` (or a small ownership table), (b) wire `getSessionUser` into `app/api/meta/.../messages/route.ts` and `app/api/tiktok/.../messages/route.ts`. NOT one checkbox.

## Phase 2 — Claim-by-reply (write-back to GHL)
- [ ] 2.1 Helper `assignContact(contactId, ghlUserId)` in `lib/ghl/` — `ghl.put('/contacts/{id}', { assignedTo })` + update `local_contacts`/`local_conversations`; **guard: only write if assignment actually changes** (avoid webhook loop / needless writes).
- [ ] 2.2 In-app reply: if contact unassigned (or not mine) and sender is a rep → call `assignContact(contactId, repGhlUserId)`.
- [ ] 2.3 GHL-side reply via webhook: if `OutboundMessage.userId` is a known rep AND contact currently unassigned → `assignContact` to that rep (claim). Idempotent.
- [ ] 2.4 Meta/TikTok: app-side claim only (set DB owner; no GHL call).

## Phase 3 — Gage roll-up (24h backstop)
- [ ] 3.1 Add a Vercel cron (e.g. every 20 min) → `app/api/cron/roll-up-orphans/route.ts`.
- [ ] 3.2 Query: conversations still in inbox where (unassigned OR assigned to a non-rep/inactive) AND no rep last-responder AND `last_message_date < now()-24h`.
- [ ] 3.3 For GHL channels → `assignContact(contactId, GHL_GAGE_USER_ID)`. For Meta/TikTok → set app-side owner = Gage.
- [ ] 3.4 Log each roll-up to `activity_events` for auditability.

## Phase 4 — Dashboard filtering (the actual behavior)
> ⚠️ **CORRECTED (C1, BLOCKER):** `app/api/inbox/queue/route.ts:108` fetches the conversation list **LIVE from GHL** (`/conversations/search`), NOT from `local_conversations`. The denormalized `last_responder_ghl_user_id` column is therefore not visible to the queue as written.
- [ ] 4.1 Keep the live GHL fetch, then **enrich each item by LEFT-JOINing against `local_conversations` / `local_messages` on conversation id** to attach `assigned_to`, `last_responder_ghl_user_id`, and channel. THEN apply the rep filter in code: visible if (`assigned_to == me`) OR (`last_responder == me`) OR (unassigned pool). **Admin** → all (unchanged).
- [ ] 4.2 Watch the `limit=100` truncation: current code filters AFTER fetch, so a strict rep filter on a 100-row page can silently drop items. Fetch enough / paginate, or push `assignedTo` into the GHL query and union the pool separately.
- [ ] 4.3 Include channel + ownership fields so Meta/TikTok items resolve ownership app-side.
- [ ] 4.4 Confirm `components/dashboard/conversations-strip` still calls `scope=mine` (it does, `conversations-strip.tsx:209`) — no client change needed for the core filter.
- [ ] 4.5 **GATE:** do NOT ship Phase 4 until Phase 0.4 + 1.3/1.5 are proven to populate `last_responder` — otherwise the "OR last_responder == me" clause is silently empty and reps lose threads they replied to.

## Phase 5 — UI polish (⚠️ GATED: `/impeccable shape` BEFORE any JSX)
- [ ] 5.1 Rep view: visually distinguish **Unclaimed (pool)** tiles from **owned** tiles (tag/treatment). Decide if an explicit "Claim" affordance is wanted vs. claim-on-reply only.
- [ ] 5.2 Admin view: keep existing rep icon; add an "Unclaimed → Gage" state so the overview reads clearly.
- [ ] 5.3 Run `/impeccable shape` → confirm brief → `/impeccable craft` → `/impeccable polish` → `/impeccable harden` (renders user/API data).

## Phase 6 — Backfill existing data (one-off)
- [ ] 6.1 Script/endpoint: for open conversations, infer last responder from latest OUTBOUND `local_messages.raw_data.userId` (parse JSONB) and from `activity_events` (`message.sent`). Populate `sent_by_ghl_user_id` + `last_responder_ghl_user_id`. Best-effort.
- [ ] 6.2 Do NOT mass-write assignments back to GHL during backfill (avoid a storm of GHL writes / webhooks) — backfill local state only; let cron + future replies converge GHL.

## Phase 7 — Verify & deploy
- [ ] 7.1 `tsc` (only reliable local gate — no preview env).
- [ ] 7.2 `/code-review` (multi-file feature) before prod.
- [ ] 7.3 Deploy `vercel --prod` (autonomous, per convention).
- [ ] 7.4 Verify: log in as Alice → sees pool + hers only; log in as admin → sees all w/ rep icons; force a 24h-old orphan → confirms roll-up to Gage.

---

## Risks / open flags
- **Meta/TikTok app-side ownership** is a parallel model with no GHL write-back — most added complexity. Could be split into a fast-follow if you'd rather ship GHL channels first.
- **`userId` presence on outbound** must be confirmed in this account (Phase 0.4) — the whole "GHL-side claim" path depends on it. If GHL omits it for SMS/email here, GHL-side replies fall back to "unknown author" and only in-app sends attribute cleanly.
- **Multi-rep race** on the shared pool: first reply wins the claim; acceptable for a small team.
- **Webhook loop**: mitigated by "only write if changed" guard + idempotent upserts.
- **No webhook signature verification** exists — out of scope, noted.

---

# ✅ HOMEWORK FINDINGS & REVISED LOCAL-FIRST DIRECTION (2026-06-08)
_Supersedes the phase ordering above where they conflict. Based on live read-only GHL probes + a deep requirements sweep._

## Verified live (read-only GHL API)
- **All GHL user ids captured → Phase 0.1 DONE.** Alice G = `JdxmH5egVkzDNHoOto0o` (the ONLY `user`-role account = the rep). Gage Flesher = `yi2pnZ49sp6z8OIAezdA` (admin / main account). Jack Pointer = `ZF6pRQnvS2rQRnir6DL7`. Also: Arham, Bloo io, Roofy, Taylor (all admin). → set `GHL_GAGE_USER_ID=yi2pnZ49sp6z8OIAezdA` (a user id, not a secret).
- **B1 CONFIRMED — outbound messages carry `userId`.** Saw real ids resolving to Alice & Gage. ⚠️ **NUANCE:** `userId` is ALSO populated on `source:"workflow"` automation sends (85 workflow vs 69 api vs 24 app vs 8 bulk_actions had a userId). So a genuine human reply = **`userId` present AND `source ∈ {app, api}`** (a person in GHL web/mobile = `app`; sent through our own app/API = `api`). EXCLUDE `source:"workflow"` (automation) and `bulk_actions` (mass send), and EXCLUDE non-message `TYPE_ACTIVITY_*`/activity rows.
- **Outbound message fields:** `altId, body, contactId, contentType, conversationId, dateAdded, dateUpdated, direction, from, id, locationId, messageType, meta, source, status, to, type, userId(when present)`. No nested user object — `userId` is top-level.
- **Backfill is feasible** without relying on the partial `local_messages`: the GHL **messages API returns `userId` historically**, so we can compute last-responder for existing open conversations by reading that API (capped/paginated).

## Still to verify — REQUIRES A PROD WRITE (not done; needs your OK)
- **B2** — does `PATCH/PUT /contacts/{id}` with `{assignedTo}` actually reassign owner in GHL v2? (the contact route is PATCH today and has NEVER sent `assignedTo`; owner may live on the conversation, not the contact.) Needs ONE sanctioned test write on a throwaway contact.
- **B3** — does writing `assignedTo` echo a `ContactUpdate` webhook back (loop)? Verify with that same test write + log watch.
- These ONLY gate the **optional GHL write-back** step. Under local-first, that step is deferred to last.

## Infra facts confirmed (from sweep)
- Migrations: **manual, against prod** — `npx drizzle-kit generate` → SQL in `db/migrations/` → apply via a copy of `scripts/run-migration.mjs` (neon driver). No `migrate`/`push` script, no apply-on-deploy. No preview env → schema lands in prod.
- DB: `lib/db/index.ts` → `db()` singleton, neon-http. One-off reads via `.mjs` (no tsx/ts-node pinned).
- Cron: 12 crons in `vercel.json`; auth = `Bearer ${CRON_SECRET}`; `/api/cron/` already whitelisted in `proxy.ts`. New cron auto-covered.
- Queue (`app/api/inbox/queue/route.ts`) fetches **live GHL** + live Meta/TikTok; reads `users` + `platform_replies` only. `local_conversations` already mirrors `assignedTo`, `lastMessageBody/Date`, `unreadCount`, `contactName` (via webhook + `/api/ghl/sync`) → ownership can be served from local TODAY; only **last-responder** is the missing datum.
- `local_messages`: forward-only & partial (webhook only; NOT in `/api/ghl/sync`; no full history backfill). Has NO author column.
- Meta/TikTok: messages NOT persisted locally at all; `platform_replies` marks "we replied at T" with NO user. Send routes don't capture session user.

## STATUS (2026-06-08)
- ✅ **SHIPPED — increment 1 (GHL core):** migration `0009`; authorship capture (webhook + in-app send); last-responder stored in Neon; dashboard rep filter = assigned ∪ last-responded ∪ unclaimed-pool, claim-by-reply. Admin sees all. tsc ✓, code-review ✓, build READY.
- ✅ **SHIPPED — increment 2:** migration `0010` (platform_replies.responder_user_id); Meta + TikTok send routes capture the responder; queue scopes Meta/TikTok by app-side ownership; **backfill run** — 100 convs scanned, 36 attributed (Alice 5 / Gage 31). tsc ✓, build READY.
- ✅ **VERIFIED — GHL write-back (B2):** test contact created → `PUT assignedTo=Gage` → read-back matched → contact deleted. Works.
- ✅ **SHIPPED — increment 3 (Gage roll-up):** `app/api/cron/roll-up-orphans` (assigns unclaimed >24h awaiting threads to Gage in GHL + locally; conservative filter, cap 25/run, dry-run flag, audit-logged via new `contact.assigned` action). `GHL_GAGE_USER_ID` set in prod env. Cron scheduled **daily 09:00 UTC** (Hobby plan allows once-daily only — not 6-hourly). Dry-run on prod: 100 scanned, **14 orphans** pending, 0 failures. Build READY.
- ⏳ **Remaining:** first LIVE roll-up run (14 real contacts → Gage) — will auto-fire daily; awaiting Jack's nod to trigger it immediately vs. let the schedule do it. Step 8 (UI pool-vs-owned tiles — needs `/impeccable shape`).

## REVISED build order — LOCAL-FIRST (local DB = source of truth; GHL synced but read; write-back last & optional)
> This delivers the ENTIRE Alice-vs-admin behavior with **zero GHL mutations** (steps 1–5). Aligned with the dual-write / future-proofing goal.
1. **(done, read-only)** Verify B1 ✓ + capture user ids ✓.
2. **(pure-local migration)** Add `local_conversations.last_responder_user_id`, `last_responded_at`, `last_responded_source`; add `local_messages.sent_by_user_id`, `source`. Add indexes on `assigned_to`, `last_responder_user_id`, `last_message_date`. Apply via `run-migration.mjs` copy.
3. **(pure-local capture, forward)** Webhook `upsertMessage`: store `userId`+`source`; when outbound AND `source ∈ {app,api}` AND real message type → date-guarded UPDATE of conversation last_responder. In-app send route also bumps last_responder directly (has `sessionUser`).
4. **(pure-local backfill)** Cron/script reads GHL messages API per open conversation → set last_responder from most-recent human outbound (`source∈{app,api}`). Capped, `CRON_SECRET`.
5. **(pure-local read — THIS is where Alice's behavior ships)** Repoint `inbox/queue` GHL branch to read `local_conversations`; rep filter = `assigned==me OR last_responder==me OR unassigned-pool`; admin = all.
6. **(pure-local display; GHL write OPTIONAL/deferred)** Gage roll-up cron: mark unclaimed >24h as Gage locally; write back to GHL only after B2/B3 pass, with echo-suppression + dry-run + per-run cap.
7. **(Meta/TikTok, app-side only)** Add owner/responder columns + capture `sessionUser` on the two send routes; no platform-native author exists.
8. **(UI gate)** `/impeccable shape` before any JSX — distinguish pool vs owned tiles; rep icon already exists.

**Risk split:** steps 2–5 + 7 are pure-local (low risk, but still land in prod since no preview env). Only step 6's GHL write-back is a prod mutation, and it's deferred + gated on B2/B3.

---

## Review notes (staff-engineer pass)
**Single riskiest assumption (now corrected in Phase 4):** the dashboard queue reads ownership from local DB — it does NOT; it fetches GHL live (`queue/route.ts:108`). Phase 4 rewritten to enrich live results from local DB.

Corrections folded in: C1 (live queue → enrich+join), C2 (`upsertMessage` is `onConflictDoNothing` → separate date-guarded conversation UPDATE), C3 (in-app send writes no local message → bump conversation directly), C4 (Meta/TikTok need a new responder column + session-user wiring in 2 send routes), C6 (`assignedTo` write-back unproven → Phase 0.5 gate).

**Still-open guards to add during build:**
- **Migrations:** no `db:push`/`db:migrate` script in package.json; applied manually via drizzle-kit → `db/migrations/*.sql` (ignore the stale `lib/db/migrations` starter). No preview env → schema lands straight in prod; generate + review SQL carefully.
- **Indexes:** add indexes on `local_conversations(assigned_to)`, `(last_responder_ghl_user_id)`, `(last_message_date)` in the Phase 1 migration (none exist today).
- **Cron auth:** `roll-up-orphans` must use `Bearer ${CRON_SECRET}` like `app/api/cron/snapshots/route.ts:23` AND be whitelisted in `proxy.ts`. Existing crons are POST.
- **Gage cron rollback:** add a dry-run flag + per-run cap (e.g. ≤25 reassigns) since there's no preview env and it mutates real GHL data.
- **Loop guard (C5):** `assignContact` must read current assignment before writing; residual webhook race is acceptable for a small team but not a hard guarantee.

**Verified correct:** all schema/table names, `conversations-strip` calls `scope=mine`, current filter is assigned-only with a phase-2 TODO, GHL client + version, cron pattern fits.
