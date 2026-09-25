# Inbox Redesign (GHL-inspired) — approved 2026-07-29

North star: beat GHL. Light/airy, unified, channel-badged, cross-channel send, editable contact panel. 100% functionally flawless per channel (reply on IG works exactly like GHL; same for SMS/Email/FB/TikTok). ONE polished deploy at the end. Not deployed until complete.

## Approved decisions (Jack)
- Structure: UNIFIED inbox, default "All". GHL-style status tiles (Unread / All / Recent / Starred) at top + search + new-message. Slim left channel rail to narrow to one channel (All/SMS/Email/Instagram/Facebook/TikTok/Comments).
- Cross-channel send: compose once, tick channels, ONE Send. Only channels the contact has. CURRENT channel pre-selected. Phenomenally beautiful + flawless + clear per-channel success/fail.
- Contact panel: EDITABLE, writes back to GHL. Blanks hidden + "+ Add details" to fill blanks.
- Social comments: STOP creating pipeline leads from comments. Surface comments in the inbox under their channel (beautiful, "a benefit"), promote to real lead only on demo.
- Colorway: light/airy. Both bubbles soft (inbound white/light border; outbound soft blue tint). Replaces R10N obsidian/black inbox styling.

## Key facts (from architecture map)
- Send: `POST /conversations/messages` (GHL) with { type, contactId, message, [conversationId] }. Routes by contactId+type; conversationId optional. Cross-channel = same call per channel, different type. toGHLSendType map in the current send route.
- Channels via GHL: SMS/Email/IG/FB/TikTok. FB Messenger also has a Meta-direct path (/api/meta/conversations). Prefer GHL send for all (GHL-consistent); verify per channel.
- Data: localConversations (SMS/Email/IG/FB/TikTok mirror), localMessages, message_index (has `channel`), conversationReads (mark-read), localContacts (email/phone/website/company/source/tags/address), socialLeads (comments), platformReplies.
- Components: inbox-client.tsx (rail+tabs+layout), conversation-list.tsx (ContactAvatar already has channel badge), message-thread.tsx (bubbles, dark), reply-composer.tsx (single channel selector), lead-details-sidebar.tsx (qual-only), meta-conversations.tsx, tiktok-conversations.tsx, reply-queue.tsx.
- Colorway: app/globals.css [data-theme="r10n"] inbox rules (~1382-1674): outbound bubble = var(--primary)=#000. Fix these.

## PROGRESS (2026-07-29) — full tsc clean, NOT deployed
DONE: lib/ghl/send.ts (shared send) · POST /api/inbox/send (cross-channel, per-channel results) · PATCH /api/ghl/contacts/[contactId] (authed, full editable fields + local mirror) · POST /api/ghl/conversations/[id]/star · useCrossChannelSend hook · reply-composer.tsx (multi-channel pills, current pre-selected, per-channel ✓/✕, → /api/inbox/send; shares ["ghl-contact",id] cache) · message-thread.tsx redesigned (soft-blue #EEF4FF outbound, white inbound, channel-badged avatar every msg) · NEW components/inbox/channel-avatar.tsx (shared ContactAvatar/CHANNEL_ICONS/CHANNEL_BADGE) · lead-details-sidebar.tsx = editable contact panel (inline edit→GHL, blanks hidden + "+ Add details", tags, copy/call) · app/globals.css inbox rules retuned light/airy soft-blue.

DONE 2 (2026-07-29, full tsc clean, NOT deployed): inbox-client.tsx FULLY REBUILT — slim channel rail [All(default)/SMS/Email/Instagram/Facebook/TikTok] + status tiles [Unread/All/Recent/Starred] + search + unified list (useConversations per channel + client filters: search, starred, recent-30d, sort desc) + redesigned thread (ContactAvatar channel-badged header + Star toggle via /api/ghl/conversations/[id]/star) + composer (passes contactPhone/email) + editable panel. Exported ChannelFilter from use-conversations. conversations API now merges local `starred` (added starred to GHLConversation type). VERIFIED: Meta webhook (app/api/webhooks/meta/route.ts) only writes socialLeads (inbox record) on a comment — NO pipeline opp/contact created; pipeline only on demo. So "comments don't clog pipeline" already holds.

REMAINING:
- COMMENTS SURFACING (regression guard — old Meta tab was dropped): add a "Comments" channel-rail item rendering a light/airy comments view of socialLeads (FB+IG) with reply + Start-demo, clearly NOT pipeline. Data: /api/comment-leads/inbox (or /api/meta/conversations). Do NOT deploy until comments are visible again (else comment visibility regresses).
- NEW-MESSAGE button (deferred): functional contact-search → open/compose. Fast-follow.
- Decide fate of MetaConversations/TikTokConversations/ReplyQueue/InboxOverview (unused now except InboxOverview empty-state). Meta-direct FB DMs: verify they appear via GHL (TYPE_FB) in the unified list; if not, keep a path.
- Polish + harden + verify + ONE deploy + per-channel send checklist for Jack.
- OLD REMAINING (superseded by DONE 2):
- Layout spine (inbox-client.tsx): slim channel rail [All(default)/SMS/Email/Instagram/Facebook/TikTok/Comments] + status tiles [Unread/All/Recent/Starred] + search + new-message; unified list default All; wire redesigned thread/composer/panel; pass contactName to MessageThread (agent A's 1-line follow-up). Unification decision: use /api/ghl/conversations (localConversations, all GHL-routed types incl IG/FB/TikTok) as the ONE list; STOP excluding Instagram; channel rail sets the type filter; status tiles filter unread/starred/recent.
- Comments-in-inbox (no pipeline): find + neutralize the comment→pipeline/social_leads path (Jack: comments must NOT create pipeline leads; only a demo does). Surface comments in the inbox under their channel (FB→Facebook, IG→Instagram), distinct beautiful treatment + "Start demo" CTA. Investigate MetaConversations/socialLeads + the webhook that creates leads from comments.
- Decide fate of separate MetaConversations/TikTokConversations/ReplyQueue components (fold into unified or keep Queue).
- Polish + harden + verify + ONE deploy + per-channel send checklist for Jack.

## POLISH ROUND 2 (2026-07-29, tsc clean, DEPLOYED dpl_BAqtPjERxJ7fLcihJwL5ywSmX6r6)
Jack's 3 batched bugs:
- [x] IG thread crash ("Something went wrong" on Jordan Roots Apothecary) — ROOT CAUSE: `extractContactData(msg.body)` with null body (IG media/story message) did `text.match()` unguarded → TypeError → error boundary. IG threads now route through the standard MessageThread (redesign removed the IG exclusion), so this path is new. FIX: `extractContactData` null-safe (returns empty result for null/undefined). lib/utils/extract-contact-data.ts.
- [x] Website detection dedup + already-on-file — (a) thread compared against `websiteRaw` (custom field) only; the site lives in the standard field, so it never filtered. FIX: message-thread `existing.website` now uses resolved `website` (GET already returns `deriveWebsite`) ?? websiteRaw. (b) http:// + non-http showed as TWO chips. FIX: `filterAlreadyOnFile` now dedupes by normalized form (dedupeNormalized) so one detected site = one chip. Applies to BOTH the aggregated SmartBanner (line ~120) and per-message chips (line ~283).
- [~] IG avatar (Jack: "GHL pulls their avatar, we can too") — GHL `/conversations/search` does NOT return the photo under `avatarUrl` (route already passes raw fields through, so if it did, it'd already show). GHL's field name is UNKNOWN and the sandbox is TLS-blocked from live GHL, so I can't discover it here. SHIPPED: defensive `pickAvatarUrl()` in conversations/route.ts that normalises any of [avatarUrl,avatar,profilePhoto,profilePicture,photo,contactPhoto,userProfilePhoto,userProfileImg,profilePicUrl,image] → avatarUrl (harmless if absent). PLUS extended /api/ghl/conversations/debug with `avatarDiscovery` (dumps a social conversation's raw keys + its raw contact object + all url-ish fields) — NOW AUTH-GATED (was open; dumps PII). NEXT if avatar still shows initials: Jack opens /api/ghl/conversations/debug logged-in, pastes `avatarDiscovery`, then wire the exact field (conversation field, or fetch the contact's photo field per-conversation).

## POLISH ROUND 3 (2026-07-29, tsc clean, DEPLOYED 7lzyzqlpz)
- [x] IG avatar was header-only — passed `contactAvatarUrl={selectedConversation.avatarUrl}` into MessageThread (new prop) → used on every inbound message avatar (`avatarUrl={isOutbound ? null : contactAvatarUrl}`).
- [x] Jordan thread STILL crashed after Round 2 → SECOND null-deref on the SAME null-body IG message: `MessageBody` did `body.length`/`body.slice()` on a null body. Made MessageBody null-safe (`const text = typeof body === "string" ? body : ""`). Lesson: a null IG media body hits BOTH extractContactData AND MessageBody; fix every consumer.
- [x] RESILIENCE: one bad conversation was nuking the whole page AND trapping nav (inbox store is a module singleton, not persisted, but survives client-side nav → /inbox auto-reopened Jordan → re-crash). Added `components/shared/error-boundary.tsx` (class boundary, `resetKeys` auto-recovers on conversation switch) wrapping MessageThread with an inline "This conversation could not be displayed / Try again" fallback. Inbox chrome + list stay usable; picking another conversation recovers.

## Phase 1 — Backend (functional correctness; do first)
- [ ] `POST /api/inbox/send` — cross-channel: { contactId, channels[], message, subject?, html?, conversationId? } → per channel GHL send (same-channel passes conversationId; others omit → GHL routes). Returns [{channel, ok, error?}]. Reuse toGHLSendType + logActivity + updateLastResponder.
- [ ] `PATCH /api/ghl/contacts/[id]` — editable contact fields (firstName/lastName/email/phone/website/companyName/address/city/state/country/tags) → GHL update API + update localContacts mirror. Validate.
- [ ] Star toggle: `POST /api/ghl/conversations/[id]/star` (localConversations.starred) for the Starred filter.
- [ ] Unified list: extend/confirm `/api/ghl/conversations` covers all channels; add filter=recent/starred + channel=all. (message_index / localConversations.)
- [ ] Comments: neutralize pipeline creation from comments (socialLeads → inbox only; demo promotes). Find + gate the comment→lead path.

## Phase 2 — Frontend
- [ ] inbox-client.tsx: new layout — slim channel rail + status tiles (Unread/All/Recent/Starred) + search + new-message + unified list | thread | editable contact panel. Default All.
- [ ] Colorway: globals.css inbox rules → light/airy soft bubbles (inbound white, outbound soft-blue), white/light panels, blue accents.
- [ ] message-thread.tsx: channel-badged light avatar on EVERY bubble (inbound + outbound). Soft bubbles.
- [ ] composer: multi-channel pills (only available channels, current pre-selected) → /api/inbox/send. Per-channel toast.
- [ ] lead-details-sidebar.tsx → editable contact panel (inline edit → PATCH GHL; hide blanks; + Add details; keep stage/quick-actions/qual).
- [ ] Comments in inbox: distinct beautiful treatment, Start-demo CTA, no pipeline.

## Phase 3 — Polish, harden, verify, deploy
- [ ] Polish (impeccable), harden (long text, empty, errors, RTL, slow net, per-channel fail), a11y.
- [ ] tsc clean; Jack verifies per-channel send end-to-end (sandbox can't send real msgs). ONE deploy. Gate 5/6. Memory.

## Risk / verify
- Cross-channel send with omitted conversationId: confirm GHL creates/routes. Fallback: find-or-create conversation per channel first.
- FB via GHL vs Meta: pick the reliable path per channel; Jack tests each.
- Editable contact writes to live GHL (CRM): explicit save + clear success/fail.
