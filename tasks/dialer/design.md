# Power Dialer — Design Brief (v1)

Status: requirements locked via /grill-me 2026-06-30. Awaiting Jack's approval of architecture before /impeccable shape (UI) then build. NO code until approved.

## Requirements locked

- **Calling model:** browser WebRTC (Twilio Voice JS SDK). Rep talks via headset. Live call lives in a persistent layer at the app root so navigation never drops it.
- **Caller ID / numbers:** one shared business number for v1, but numbers are modeled as a POOL so per-rep numbers can be added later with no rework. Shared number is always the inbound catch-all.
- **Recording:** every call recorded + auto-transcribed through the existing Gemini pipeline (transcript, summary, sentiment, objections). Feeds the future Objections feature.
- **Campaigns:** admins create + assign to one or many reps and see everything; reps can create their own but the "assigned to" is locked to themselves. Same builder UI, permission-gated fields.
- **Queue:** shared queue with atomic claim + per-contact lock so two reps never dial the same person. FIFO order; no-contact requeues to the back, same session.
- **Max attempts:** per-campaign (default 3, configurable). Per-contact attempt counter shown ("2 of 3"). Removed/exhausted after the last failed attempt.
- **Outcomes:** REUSE the existing OutcomeModal (same two-step layout: outcome → optional pipeline-stage change + notes), extended with no-contact outcomes (No Answer / Busy / Voicemail / Bad Number / Do Not Call). No-contact = requeue; everything else = terminal. Disposition generalized to attach to a dialer call, not a calendar event.
- **Auto-advance:** after the mandatory disposition, the next available contact loads into the keypad automatically (number + full preview), ready to dial.
- **Manual dials:** first-class. Recorded + logged. Known number → full preview + required disposition; unknown number → logs, disposition optional.
- **Compliance:** minimal (Jack's call). One non-negotiable: the number must be carrier-registered (A2P / voice verification) or it gets blocked / "Spam Likely". That's one-time provisioning, not an ongoing gate. Keep a manual "Do Not Call" outcome.
- **Sync:** dialer calls + outcomes stored in our own DB only for v1. No GHL push yet.
- **Inbound:** route to the rep who last dialed that contact; if offline, any available rep; if none, voicemail (recorded, transcribed, logged, team notified).

## Architecture

### 1. Twilio setup (Settings → Telephony, admin-only, one-time)
- Admin pastes Twilio Account SID + an API Key SID/Secret (we store secret encrypted, never in code).
- We create/point a TwiML App (voice URL → our webhooks) and list/buy a voice number via the Twilio API; the chosen number(s) land in `twilio_numbers`.
- Mic permission requested on the dialer page.

### 2. The live call (browser + persistent layer)
- `DialerProvider` mounted in `app/(app)/layout.tsx` (same pattern as `PusherProvider`) holds the Twilio `Device`, the active `Call`, and call state in React context.
- Token endpoint `GET /api/dialer/token` mints a short-lived Voice access token (VoiceGrant) for the logged-in user's identity.
- Outbound: `Device.connect({ To })` → TwiML webhook `POST /api/dialer/voice/outbound` returns `<Dial record="record-from-answer-dual" callerId={sharedNumber}><Number>{To}</Number></Dial>`.
- A floating "call in progress" mini-bar persists across every page when off `/dialer`; full cockpit on `/dialer`. Call survives navigation because the Device lives at the root, not in the page.
- Live state (ringing/answered/ended/duration) broadcast via Twilio status callbacks → Pusher channel `dialer-${userId}` → context.

### 3. Campaign engine (the Stripe-architect's core)
- **Claim-next is atomic:** `SELECT ... FOR UPDATE SKIP LOCKED` picks the next `queued` contact for the campaign, flips it to `in_progress` + sets `lockedByUserId`/`lockedAt`. Guarantees no double-dial across reps.
- **Disposition closes the loop** (`POST /api/dialer/contacts/:id/disposition`): writes the call + disposition, then:
  - terminal outcome → contact `completed` (DNC → `suppressed`), lock released.
  - no-contact outcome → `attempts++`; if `attempts < maxAttempts` → back to `queued` (FIFO tail); else `exhausted`. Lock released.
- **Stale-lock reaper:** a lock older than N minutes (dropped call / closed tab) auto-releases so a contact never gets stuck.
- **Auto-advance:** disposition response returns the next claimed contact, so the UI loads it instantly.

### 4. Inbound routing (`POST /api/dialer/voice/inbound`)
- Look up contact by `From` number → find last rep who dialed them (from the call log).
- If that rep's Device is online (presence heartbeat in DB / Pusher) → `<Dial><Client>{rep}</Client></Dial>`.
- Else → dial all online reps (shared pool); first to answer wins.
- Else → voicemail: `<Record>` → `POST /api/dialer/voice/voicemail` stores + transcribes + creates a missed-call notification + follow-up task.
- Caller's contact preview auto-opens for whoever answers.

### 5. Recording → transcription → insights
- `recordingStatusCallback` → `POST /api/dialer/voice/recording` → download recording to Vercel Blob → store URL on the call row → enqueue `analyzeTranscript()` (existing Gemini helper) → write `callInsights` (wants/objections/nextSteps/sentiment). Same pipeline Fathom calls use.

### 6. Data model (new tables + small extensions)
- `twilio_numbers`: id, phoneNumber, twilioSid, label, assignedRepUserId (null = shared), isShared, createdAt.
- `dialer_settings` (single row): twilioAccountSid, apiKeySid, apiKeySecret (encrypted), twimlAppSid, voicemailGreetingUrl, updatedBy.
- `dialer_campaigns`: id, name, createdBy, ownerScope ("admin"|"rep"), maxAttempts (default 3), status (active|paused|archived), createdAt, updatedAt.
- `dialer_campaign_reps`: campaignId, userId (the assigned reps; rep-created = just themselves).
- `dialer_campaign_contacts`: id, campaignId, contactId, contactName, phone, position (FIFO), attempts (default 0), status (queued|in_progress|completed|exhausted|suppressed), lockedByUserId, lockedAt, lastOutcome, lastAttemptAt, createdAt. Unique (campaignId, contactId) to dedupe.
- Extend `calls`: add `twilioCallSid` (unique), `campaignId` (nullable), `recordingUrl`, `source` ("ghl"|"twilio"). Keep callType="dialer".
- Generalize `callDispositions`: add nullable `callId` (→ calls.id) so a disposition can attach to a dialer call, not only a `calendarEventId`. Backward compatible.
- All migrations additive + idempotent (no preview env; lands straight in prod).

## The page (UX shape direction — formal /impeccable shape next)
Three-zone cockpit on `/dialer`:
- **Left rail — Campaigns:** list of campaigns the user can work (admins see all; reps see theirs). Each shows progress (done / remaining / exhausted) + assigned reps. Click → load campaign → Start Campaign.
- **Center — Contact cockpit:** the loaded contact's EVERYTHING inline (no navigating away): identity, phone/email, qualification Q&A, conversation/messages, notes, timeline/activity, last-call insights. Built by extracting the contact-modal panes into a reusable pane.
- **Right — Dial dock:** the beautiful keypad (0-9, * # +), the input field, big Dial button, and when live it becomes the in-call panel (mute/keypad/hangup, timer, recording dot). The loaded contact's number is prefilled; the attempt counter ("2 of 3") shows.
- **Flow:** Start Campaign → first contact loads (number + preview) → Dial → talk → call ends → OutcomeModal (mandatory) → next contact auto-loads. A persistent mini-call-bar lets the rep roam the app mid-call.
- **Add to campaign:** add a button to the existing bulk-action bars on Contacts (`contacts-client.tsx:347`) and Pipeline (`kanban-board.tsx:417`) → "Add to Power Dialer" → pick/create campaign.

## Build phases (each shippable + verifiable)
1. **Telephony spine:** Settings → Telephony (connect Twilio, pick number), token endpoint, DialerProvider, a working manual keypad call (dial a number from the browser, talk, hang up). Recording + transcription wired.
2. **Contact cockpit:** extract the contact panes into a reusable preview; manual call to a known contact shows full preview + OutcomeModal (generalized disposition).
3. **Campaigns:** data model + builder (admin/rep permissioned) + "Add to Power Dialer" on Contacts/Pipeline + campaign list on /dialer.
4. **Power-dialer loop:** claim-next engine, lock, Start Campaign, auto-advance, requeue + max attempts + attempt counter, stale-lock reaper.
5. **Inbound + voicemail:** last-rep-sticky routing, pool overflow, voicemail capture + notify.
6. **Polish + harden:** the breathtaking pass, every failure mode (dropped call, network loss, permission denied, tab close), load test the queue.

## Open / deferred (not v1 unless you say so)
- Voicemail drop (pre-recorded VM on outbound no-answer to save rep time) — natural v2 efficiency add.
- Local-presence dialing (number pool matching area code) — later upgrade.
- GHL push of dialer calls — later.

## Build note — quick actions reuse existing modals (locked 2026-06-30)
Dialer Create demo/task/audit MUST mount the EXISTING shared components, not the
preview placeholder: `CreateTaskModal`, `CreateDemoModal`, `CreateAuditModal`
(components/shared/), exactly as components/pipeline/opportunity-modal.tsx does
(lines 1273-1299). Props are a direct pass-through from the loaded contact
(contactId, contactName, contactEmail, contactPhone, opportunityId,
opportunitySource). The preview QuickActionModal is a stub only because mock
contacts have no real GHL id and to avoid creating real records on a demo click.
