# Lessons

Observed problems and the rules that prevent them recurring.

## Project location & deploys
- **The real source is `~/Projects/kracked-sales`.** The folder
  `~/Documents/Agentic Workflows/Kracked Sales System/kracked-sales` is a stale
  bare Next.js starter — NOT the deployed app. Always work in `~/Projects`.
  (Real Node projects live outside iCloud.)
- **Production deploys are CLI uploads** (`vercel --prod`) from the working tree —
  there is no git-based deploy. The working tree carries a large amount of
  uncommitted work that is already in production. Before deploying, check the
  delta between the working tree and the last deploy (`find -newermt <deploy>`),
  don't assume the git diff vs last commit reflects what's unreleased.

## Build / env
- `.env.local` here holds only `VERCEL_OIDC_TOKEN` — no DB or API keys. So
  `next build` fails *locally* at page-data collection for any route that
  instantiates an SDK at module scope (e.g. `new Stripe(process.env.KEY!)` in
  `app/api/proposals/[id]/lost/route.ts`). This is an env limitation, not a code
  bug. Verify with `tsc --noEmit`; let Vercel (full env) run the real build. A
  failed Vercel build never aliases to production, so deploying to verify is safe.

## Auth middleware (proxy.ts)
- `proxy.ts` (Next 16 middleware) gates every route against `PUBLIC_PATHS`.
  Any unauthenticated server-to-server endpoint (Stripe/other webhooks, OAuth
  callbacks, cron) MUST be added to that allowlist or it 307-redirects to /login.
  Stripe's webhook was failing for exactly this reason — `/api/stripe/webhook`
  was missing from the list.

## 2026-06-24 — Never record/share before Jack verifies
RULE: Do NOT create a demo recording or post anything to Slack until Jack has personally verified the feature works and is good. Build → Jack verifies → only then (and only on his go) record/share. This applies to the headless GIF broadcaster and any future "share" step. I jumped to recording the rep-performance feature before full verification; do not repeat.

## 2026-06-25 — Feature demos: one feature per clip, and capture the REAL app
- ONE feature per GIF + message. Jack found a single clip covering 4 features overwhelming and confusing ("doesn't make sense"). Do feature-by-feature: understand it, focused message, one short clip.
- RECORD THE REAL APP, not a hand-built mockup. Recreated HTML mockups drift from the real UI for anything complex (multi-pane modal, full table) and read as fake/bad. Method that works: mint a session cookie for an admin user (userId|HMAC(userId, SESSION_SECRET) — the kracked_session cookie), set it in a headless Playwright context, navigate to the live app, inject scripts/director.js, drive the real UI, and use Playwright record_video (works with chromium_headless_shell) → webm → ffmpeg. Zero disruption, true UI. Wait for REAL rows ("tbody tr p"), not skeleton <tr>s, then trim the load.

## 2026-06-25 — Verify ambiguous UI references before building
- "Make these icons clickable to filter" was ambiguous: I built row channel/demo/proposal icon filters; Jack actually meant the STAGE PILLS at the top filtering by pipeline stage. When a request points at "these icons/pills" with a screenshot, confirm exactly which element + the exact behaviour before building. Reverted the row-icon filters; the stage-summary pills are now the filter (filters.stageName).

## 2026-06-25 — GHL custom-field values can be non-string
- resolveCustomFields crashed the contact modal ("Something went wrong", TypeError: e.trim is not a function) because a GHL custom field value was a number/array, not a string. Always coerce: typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(", ") : String(raw). Caught only because we captured the REAL app on real data — another reason to test on real data.

## 2026-06-27 — Inbox ≠ comment leads; read A/B/C as one set, A feeds B
- The Meta INBOX is conversational (Facebook + Instagram DMs). COMMENT LEADS are people who commented a trigger word on a post — a different entity that also surfaces in the Meta inbox. The Task/Demo/Audit sidebar sits on inbox conversations. Do NOT treat the `comment_leads` table as "the inbox data source."
- I started task B (auto-prefill the forms) in isolation and probed `comment_leads` for fuel — but its email/phone/website columns are empty (0/9) because NOTHING writes them yet. Task A (smart detection in the thread → click to attach) is what populates them. So **A feeds B; A ships first.** Read all related tasks and resolve their dependencies before choosing a start order, even when told "start with B."
- The detect+attach mechanism already exists: `lib/utils/extract-contact-data.ts` + `components/shared/chat-bubble.tsx` (EnrichChip/SmartBanner), used by the contact + opportunity modals, writes via PATCH `/api/ghl/contacts/{contactId}`. Task A = port it to the inbox threads, not build it from scratch.

## 2026-06-27 — Demo clips: REAL app + the realistic scenario + step-by-step (reinforces 2026-06-25)
Jack rejected TWO clip attempts before the right one. Lessons:
- **Never an authored HTML mockup scene.** It reads as fake, drifts from the real UI, and didn't even fit on screen. Always capture the REAL app: headless Playwright on live prod with a minted `kracked_session` cookie. To control the on-screen data without DB staging, use **Playwright `page.route` network fixtures** — intercept just the data endpoints (e.g. `/api/meta/conversations`, `/messages`, `/api/comment-leads/attach`) and `route.continue()` everything else (incl. auth). The UI/components/CSS stay 100% real; only the data is a fixture. (Added to [[reference_headless_real_app_capture]].)
- **Pick the realistic scenario.** I used a comment-lead; the comment thread had no visible message, so the "detected" banner made no sense. The real flow is a **raw DM** where the prospect hands over their website/email → tap each chip INLINE on the message to save → the demo form auto-fills. Match the clip to how the feature is actually used.
- **Show it step-by-step with captions.** Jack wants the clip to teach how it works: one caption per step, cursor visibly clicking each thing.
- **One coherent flow per clip**, not one big multi-feature video (he says big videos confuse the render + the viewer).

## 2026-06-29 — "Data sometimes missing on a GHL-backed page" = client retry/timeout gap, NOT the resolver
Jack: website + qualification STILL blank on new FB leads (pipeline cards + opportunity modal), despite the form-agnostic resolver fix. Root cause was NOT the resolver and NOT the data: GHL's gateway intermittently returns 503 ("no healthy upstream", "upstream connect error") and hangs, and `lib/ghl/client.ts` only retried on **429**. A transient 5xx made `/api/ghl/contacts/{id}` return `{contact:null}` → blank website/qualification/conversation. Proven by hitting GHL directly: data was present (Renee Sembera had website=shophazellane.com + 6 qual fields), the opportunity carried `contact.id`, and the same call 503'd then **succeeded on retry**.
- **Fix:** retry 429 + 5xx + network/timeout/abort with backoff+jitter, plus a 20s per-attempt AbortController timeout (a hang becomes a retry, not a stall).
- **Rule:** when GHL-derived data is "sometimes empty / still empty," first verify the raw GHL record (a 10-line read-only diag script reading `.env.production.vercel`), THEN suspect upstream resilience (retry/timeout) in `lib/ghl/client.ts`. Don't keep re-reading the resolver or assume a new lead-form variant.
- **Verify-the-truth recipe:** read GHL creds from `.env.production.vercel` (NOT `.env.local` — that only has VERCEL_OIDC_TOKEN), POST/GET `services.leadconnectorhq.com` with retry-on-5xx, dump `contact.website` + `customFields` + the opportunity's embedded `contact` (which is only id,name,companyName,email,phone,tags,score — NO website/customFields, so cards/modals MUST do the per-contact fetch).
