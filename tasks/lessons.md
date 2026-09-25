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

## 2026-06-30 — Testing authed prod endpoints: mint the cookie right, and don't use node fetch
To curl a logged-in endpoint, mint `kracked_session=<userId>|HMAC-SHA256(SESSION_SECRET, userId).hex` (matches app/api/auth/login + proxy.ts verifySession). TWO gotchas that cost real time:
- **Parse SESSION_SECRET with JSON.parse, not a quote-strip regex.** `vercel env pull` writes it dotenv-quoted with an escaped char; a naive `.replace(/^"|"$/g,"")` gives the WRONG secret (off by a char) → every cookie 307s to /login. `JSON.parse(rawValueIncludingQuotes)` gives the real 65-char secret. (The DB url parses fine either way, which masks the problem.)
- **Node's fetch (undici) silently strips the `Cookie` request header** (forbidden header). Use `curl -H "Cookie: ..."` (or execFileSync('curl',...)) for authed test calls, not fetch.
- Auth gate is **proxy.ts** (Next 16's renamed middleware), not middleware.ts. Server-to-server webhooks (e.g. Twilio /api/dialer/voice/) must be added to its PUBLIC_PATHS or they get redirected to /login.
- Recipe lives in [[reference_headless_real_app_capture]] context; pull prod env with `vercel env pull /tmp/x --environment=production --yes` (SESSION_SECRET there matches runtime).

## 2026-08-05 — Money scripts: test the SIDE EFFECTS, not just the money (cost: 4 client emails)
Creating 5 mid-term Stripe subscriptions for the 90-day clients. The money was proven exhaustively in test mode with a Test Clock (16/16 checks: nothing charged early, right dates, right amounts, stops itself). It ran perfectly. Then it emailed 4 real clients a "Payment received" note and posted 4 false "Paid: $4,500" Slack alerts.
- **Root cause:** a subscription created with `trial_end` makes Stripe emit a **$0 invoice** to open the trial. Stripe instantly marks it `paid` and fires `invoice.paid`. Our webhook found no proposal metadata on the invoice, fell through to its "match by the subscription's `metadata.proposal_id`" branch — the metadata *I had set* — and marked the proposal PAID. That cascaded into `sendReceiptForProposal()` (emails the CLIENT + Gage), `createOnboardingTasks()` and a Slack "paid" alert.
- **I had spotted the $0 invoice earlier, called it "cosmetic", and said I'd suppress it. Then ran the job without suppressing it.** If you notice a stray artefact, either handle it or trace what consumes it. "Cosmetic" is a hypothesis, not a finding.
- **RULE, before any live money/state script:** list every webhook, email, Slack post and workflow that the objects you create could trigger, and grep for the handlers. `grep -n 'status: "paid"' app/api/stripe/webhook/route.ts` would have found it in 10 seconds. Testing in test mode does NOT cover this — the test account has no webhook wired to prod, so side effects are invisible there.
- **Guard to add:** webhook must ignore `invoice.paid` when `amount_paid === 0`. A zero-value invoice is never evidence a deal is paid.
- **Emails cannot be unsent.** Resend/SES `delivered` is final. There is no recall. Treat any code path that can email a client as irreversible.
- Mitigation that worked: removed `proposal_id` from the subscription metadata (kept as `kracked_proposal_ref`) so the real charges in Aug/Sep can't re-trigger it; restored statuses; deleted the tasks and the Slack posts via `chat.delete`.

## 2026-08-07 — Migration runners: a comment-stripping filter that eats the whole migration
`scripts/apply-0045-meta-lead-stage.mjs` split the .sql on `;` then dropped any chunk starting with `--`. Every statement in the file is preceded by its own comment block, so **all four statements were filtered out** and the migration would have applied nothing. It failed safe (the column check reported 0 of 7) rather than half-applying, but only by luck.
- **Rule:** a migration runner must assert the statement count it expects (`if (statements.length !== N) exit(1)`) before executing. "0 statements, migration complete" must be impossible to print.
- **Rule:** strip comment-only *lines* from each chunk; never discard a chunk because it *starts* with a comment. Documented SQL is the norm here, not the exception.
- **Pre-flight that paid off:** count rows in every table the migration touches before running. `local_contacts` = 5,270 and `facebook_leads` = 1, so a plain `CREATE INDEX` (which blocks writes while it builds) was milliseconds, not an outage. On a large table that check is the difference between a safe deploy and blocking the GHL webhook.

## 2026-08-07 — `animate-in` / `slide-in-from-right` are silent no-ops in this project
This is Tailwind **v4 with no `tailwindcss-animate` (or `tw-animate-css`) dependency**, so the shadcn-style `animate-in slide-in-from-right` classes do nothing at all. They are used in `components/kpis/KpiDetailSheet.tsx` and `components/money/tip.tsx`, where those drawers therefore appear with no transition.
- **Use the project's own hand-rolled utilities in `app/globals.css`:** `animate-slide-in-right`, `animate-slide-up-fade`, `animate-fade-in`, `animate-scale-in`, `animate-scale-in-flex`. They use `cubic-bezier(0.16, 1, 0.3, 1)` and already opt out under `prefers-reduced-motion`.
- **Rule:** before using an animation class copied from shadcn docs, grep `app/globals.css` and `package.json`. A class that does nothing looks identical to a class that works, in code review and in a screenshot.

## 2026-08-07 — A dropdown inside a scroll container needs a portal, not a z-index
The Leads Centre stage control is rendered inside the table (`overflow-auto`) and the drawer (`overflow-y-auto`). An `absolute` menu is **clipped by the nearest scrolling ancestor**, so on rows below the fold Gage could not set a stage at all. z-index cannot fix clipping; only escaping the container can.
- **Fix:** `createPortal` to `document.body` + `position: fixed` from `getBoundingClientRect()`, flip up when the space below is short, clamp `left` to the viewport, and close on capture-phase `scroll`/`resize` (a portalled menu no longer moves with its trigger).
- **Rule:** any popover/menu/tooltip inside a scrollable region gets portalled from the start. Test it on the LAST row, not the first — the first row always looks fine.

## 2026-08-07 — Correlated subquery silently matched EVERY row (column shadowing)
The Leads Centre feed enriched contacts from `facebook_leads` with:
`(SELECT fl.leadgen_id FROM facebook_leads fl WHERE LOWER(fl.email) = LOWER(${localContacts.email}) ...)`.
The outer column rendered **unqualified** inside the raw fragment, and because `facebook_leads` ALSO has an `email` column, Postgres bound the bare `email` to the INNER table. The predicate became `LOWER(fl.email) = LOWER(fl.email)` — true for every row — so all 553 contacts inherited whichever `facebook_leads` row was newest. In production that was a Meta **test lead**, so every lead in the UI displayed `<test lead: dummy data for ...>` as its form answers, plus a wrong Meta lead id.
- **It did not throw, did not log, and returned a plausible id.** Only comparing two leads side by side reveals it.
- **Rule:** never reference an outer column inside a raw correlated subquery when both tables share that column name. Either alias the outer table explicitly (`FROM local_contacts lc` ... `LOWER(lc.email)`) or, better, do the lookup as a separate keyed query and join in TypeScript where the scope is visible.
- **Detection recipe:** if an enrichment field looks right on one row, check whether EVERY row has the identical value. `distinct(metaLeadId).length === 1` across a page is the smell.
- The stage-change route was unaffected because it binds a JS **value** (`contact.email`), not a column — so no wrong CAPI events were sent. Values bind safely; columns shadow.

## 2026-08-07 — Drizzle expands JS arrays into tuples, so `= ANY(${arr})` is broken
Replacing the subquery above, `where(raw\`LOWER(email) = ANY(${keys})\`)` compiled and typechecked, then 500'd in production with `op ANY/ALL (array) requires array on right side`. Drizzle expands a JS array into `($1, $2, ... $50)` — a row expression, not an array.
- **It passed my scratch test because the raw `neon` tagged template DOES bind JS arrays as Postgres arrays.** The driver and the ORM disagree, so a scratch script proves nothing about ORM behaviour.
- **Rule:** use `inArray(col, values)` (it accepts a SQL expression as the first arg, e.g. `inArray(sql\`LOWER(${t.email})\`, keys)`), never hand-rolled `= ANY()` through Drizzle.
- **Rule:** when a scratch script validates a query, replicate the SQL SHAPE the ORM emits (placeholders and all), not just the intent. Better still, hit the deployed endpoint and assert on the response before calling it done.

## 2026-08-07 — Meta Leads Centre stages: the Graph API is closed, PROVEN, and the CSV is the way
Jack pushed back on "it can't be synced" as laziness. Re-probed properly rather than trusting a note, and the note was right — but now it is evidence, not belief:
- Brute-forced 30+ candidate fields on the lead node (`lead_status`, `crm_status`, `stage`, `lead_stage`, `qualification_status`, `leads_center_status`, `disposition`, `sales_stage`, `pipeline_stage`, `labels`, `assignee`, `notes` …) — all `(#100) nonexisting field`.
- The lead node's COMPLETE field set is: `id, created_time, ad_id/ad_name, adset_*, campaign_*, form_id, field_data, partner_name, is_organic, platform, post, retailer_item_id, vehicle, custom_disclaimer_responses`.
- Edges `/crm`, `/stages`, `/notes`, `/status`, `/labels` on the lead; `/leads`, `/crm_leads`, `/leadgen_leads`, `/lead_center` on the page; `/leads`, `/crm_leads`, `/leads_center` on the business — all "Unknown path components" or nonexisting.
- Holds on v17, v19, v21, v23, v25. `?metadata=1` introspection is silently ignored on all of them (returns the node, not metadata) — so "no metadata" is NOT evidence of anything; brute-forcing field names is.
- Token had `leads_retrieval` + `ads_management` + `business_management`, so this is not a permissions gap.
- **Rule:** "the API doesn't expose X" is only worth stating after brute-forcing names against the real node AND probing the edges on every parent node. The error messages are the documentation.
- **The way in is `scripts/import-meta-stages.mjs`**: export from Leads Centre (one file if it has a Stage column, else one file per stage filter), match on email, write `meta_lead_stage` DIRECTLY.

## 2026-08-07 — A stage backfill must bypass the stage route, or it re-fires the ad signal
`PATCH /api/leads/[id]/stage` fires a Conversions API event on qualified/converted/not_qualified. Backfilling Meta's own stages through it would send Facebook ~143 duplicate `BAD` events for leads Meta already knows about — teaching the optimiser that good leads are bad, on traffic at $117-$337 per qualified lead. The importer writes the column directly: no route, no CAPI, no GHL write-back.
- Recorded as `capi_status = 'imported'` rather than left NULL, so the Signal column can say "From Meta" instead of showing an unexplained blank that reads as "we forgot to tell Facebook".
- The route now treats `'imported'` like `'sent'` in its idempotency check. Without that, re-clicking the stage already visible on an imported lead would fire the duplicate event the import existed to avoid.
- **Rule:** any bulk write to a column whose normal write path has side effects must bypass that path AND record that it did.

## 2026-08-07 — Fuzzy match keys need entropy, and "Status" is not "Stage"
Two traps found by testing the importer on real data instead of shipping it:
- **Degenerate phone keys.** Matching on the last 9 digits filed an unrelated lead under the wrong stage, because a live contact (`parreech1969@gmail.com`) has a phone whose last nine digits are `000000000` and it collided with a placeholder number. Fix: require ≥10 digits AND ≥4 distinct digits. Placeholder numbers are normal in form data; a match key needs entropy before it can be trusted.
- **Meta's export has BOTH a `Stage` and a `Status` column, and `Status` means "Complete form" / "Incomplete"** — form completion, not pipeline position. A header regex of `/stage|status/i` would import garbage into all 553 rows and look entirely plausible doing it. The column finder matches `^stage$` first and explicitly excludes anything containing "status".
- **Rule:** match one row to at most one record on BOTH sides, in ordered passes strongest-key-first. A single loop per contact let a weak phone match steal a person a strong email match had already claimed — which pushed the match count ABOVE the number of rows in the file. The count looked plausible; the assignment was wrong.

## 2026-08-07 — The Leads page population: the obvious fix was wrong, and the check caught it
Chasing "why do we show 553 when Meta shows 264", I found the page's definition of a Meta lead is loose: `raw_data::text ILIKE '%"utmAdId"%'` is a TEXT SEARCH over the whole attribution blob, while `pickAttribution()` reads only the LAST touch. So a contact whose last touch is an Instagram DM but who once clicked an ad still counts as a "Form Lead", and renders with a blank campaign.
- Tightening it to "the LAST touch carries an ad id" gives 457 and drops 96 (78 Instagram DMs + 18 calendar bookings). That looked like the fix.
- **It is not.** Checked before shipping: of those 96, **55 are in Meta's Leads Centre export** (47 Converted, 8 Qualified). Meta's Leads Centre deliberately INCLUDES organic Instagram and Messenger leads — 35 of its 264 rows have no form and no ad. Tightening the filter would have deleted real Leads Centre leads from the page and made parity worse while looking rigorous.
- **Rule:** before narrowing a population filter, intersect the rows you would drop with the set you are trying to match. "This filter is more correct in principle" is not evidence; the overlap count is.
- The loose filter still deserves a fix (a DM should not render as a Form Lead with a blank campaign), but the fix is to classify the row, not to exclude it.

## 2026-08-07 — Meta's Leads Centre is not a complete view of your leads
Meta's own Graph API reports **686 leads across the 31 lead forms** on the page. Leads Centre displays **264**. Per form: "FREE EMAIL DESIGN | JUNE (PETER TEST)" is 390 by leads_count, 177 in the Leads Centre export; "MAY NEW COPY V1" is 198 vs 25. So Leads Centre is a SUBSET, and "mirror Leads Centre" can never mean "show every Meta lead".
- Compounding it: the "All" tab **excludes Not qualified**. Jack measured 143 Not qualified over 8 Jul–6 Aug; the All export contains zero of them. So Leads Centre membership = All (264) + Not qualified (143) = 407, not 264.
- **Rule:** never treat a vendor UI's headline count as the population. Reconcile it against the API's own totals first; here the two disagree by 422.

## 2026-08-07 — A control that renders, is enabled, and cannot be clicked
Jack: "there's only one page, I can't go to the next." The API was fine — verified against prod with a minted session cookie: 12 pages, `hasMore: true` on page 0, 3 rows on page 11. The Next button rendered and was enabled. The floating assistant bubble (fixed, bottom-right) sat directly on top of it, because the pager was a full-width `justify-between` row OUTSIDE the table card, which pins Next to the exact corner the widget occupies.
- **Fix:** pager moved INSIDE the card footer, both buttons grouped right with `pr-14` to clear anything floating, plus a "1–50 of 553" readout so the page count is legible without clicking.
- **Rule:** when a user says a control does nothing, verify the endpoint FIRST, then look for an overlay. A disabled control and an obscured control are indistinguishable in a screenshot, and neither shows up in the code.
- **Rule:** this app has a fixed bottom-right widget. Nothing interactive may live in that corner.

## 2026-08-07 — One section, not two: the qualification duplication
The lead drawer printed the same six answers twice — once in "Qualification" under GHL's paraphrased field labels ("Open text field", "Revenue range"), once in "Form answers" under the real question the lead read. The sidebar already accepted a `formAnswers` prop that REPLACES the GHL-derived list; leads-client was deliberately withholding it and rendering its own block below instead, which is what created the duplicate.
- **Fix:** pass `formAnswers`, delete the local block, keep the heading "Qualification". The form Q&A does not sit beside the qualification, it IS the qualification.
- **Rule:** when a shared component already has a prop for the data, the answer is almost never a second renderer next to it.

## 2026-08-07 — The "dark morbid" app is the r10n theme, not the design
Jack asked how to make the app light and airy instead of dark. Nothing needed building: the
DEFAULT theme in `app/globals.css` `:root` is already light — `--background #FAFAF7` (warm
off-white), `--sidebar #F3F0ED` (light warm grey), `--card #FFFFFF`. The near-black sidebar
comes from `[data-theme="r10n"]`, which sets `--sidebar: #0A0C18`, and it is an admin-only
OPT-IN theme applied by a cookie in `app/layout.tsx`. The "r10n: on" pill at the bottom-left
of his screenshots is `components/system/r10n-theme-toggle.tsx` — the switch.
- **Rule:** before restyling anything, check whether a non-default theme is active. The token
  layer is the first place to look, not the components. A whole-app "redesign" request can be
  a toggle.

## 2026-08-07 — Migration runner, second bite: strip comments BEFORE splitting on ";"
The 0045 lesson said "strip comment-only lines from each chunk, never discard a chunk because
it starts with a comment". I did that in the 0046 runner and it STILL broke, differently: a
comment containing a semicolon ("-- The rail counts group by stage; the feed orders by date.")
split a statement in half, and the tail of the English sentence was executed as SQL —
`syntax error at or near "the"`. The statement-count assert passed because the count happened
to come out right.
- **Fix:** strip comment lines from the WHOLE file first, then split on ";".
- **Rule:** a count assert is necessary but not sufficient — it catches "too few statements",
  not "the right number of wrong statements". Log the first ~64 chars of each statement before
  executing; that is what made this obvious in one run.
- Failed safe only because the migration is `IF NOT EXISTS` throughout, so re-running after
  the fix completed cleanly.

## 2026-08-07 — Why the app could never match Meta's rail: it was reading the wrong table
Intake showed 9 against Meta's 16. The 7 missing: Meta's own `test@meta.com` dummy, two leads
that reached Meta but not yet GHL, and four organic Messenger leads (Chris Bryan, Amelia
Louise, Suz SQ, Dan Grant) carrying NO email and NO phone. Converted showed 135 against 187,
29 of the gap being organic Instagram leads.
- **Root cause, not a filter bug:** the Leads page derived its population from `local_contacts`
  (the GHL mirror). 162 of Meta's 711 people are not GHL contacts and never will be, so no
  stage could ever be written for them. No filter change can fix a row that does not exist.
- **Fix:** `meta_leads` (migration 0046) mirrors Meta's export verbatim — one row per Leads
  Centre row — and links to `local_contacts` where the person is identifiable. Counts come
  from the mirror, so they are Meta's by construction.
- **Deliberately NOT inserted into `local_contacts`:** it is maintained by `lib/ghl/sync.ts`;
  invented rows would surface in Contacts as fake CRM records, risk being overwritten by the
  sync, and duplicate the person if they later arrive properly from GHL.
- Row ids are a deterministic hash of email|name|created|form, so re-importing the same export
  updates in place. `created` and `form` are IN the hash on purpose: Meta counts two
  submissions from one person twice, and the mirror must agree with Meta, not with the CRM.

## 2026-08-07 — The GHL sync dropped the newest contacts, and reported success doing it
Jack: "why does Tony Lightwood show in Meta AND GoHighLevel, but not in ours?"
- `syncContacts()` paged `/contacts/?locationId=…&limit=100`, which GHL returns **ascending by
  dateAdded**, and broke out of the loop on a 50s budget (`PAGE_BUDGET_MS`). At 5,094 contacts
  that is 51 round trips. Whenever the budget expired, the contacts it never reached were
  ALWAYS the newest — and it still returned `{ ok: true, synced: { contacts: N } }`.
- Measured: GHL 5,094 / ours 5,270, and the 4 in GHL that had never arrived were the four most
  recent (Tony added 07:42, Cameron Gardiner 07:04, plus "coleman" and Meta's test lead). Our
  newest contact was 20 hours stale. Gage searched the app, found nothing, and fell back to
  GoHighLevel — the exact workflow this app exists to replace.
- **Fix:** `/contacts/search` (v2) with `sort: [{field:"dateAdded", direction:"desc"}]`, paging
  on `searchAfter`. Newest-first makes the time budget SAFE: running out now drops the OLDEST
  records, which are already mirrored and rarely change. Verified — the desc first page returns
  exactly those 4 as rows 1-4; after deploy the sync reported 5,094 contacts and local_contacts
  went 5,270 → 5,274 with Tony present.
- **Rule:** any budget-bounded or paginated sync must process in the order where truncation is
  survivable. Oldest-first + a deadline means the newest data is always the first casualty.
- **Rule:** a sync that can partially complete must not report a bare success. `ok: true` with
  a count is indistinguishable from a run that missed every new lead of the day. It should
  report whether it reached the end of the source.

## 2026-08-07 — Two-way reconciliation, not one-way
Jack asked that every GHL contact exist in our system. Checking only that direction would have
missed the larger half: GHL 5,094 vs ours 5,270 — we hold **180 contacts GHL no longer has**
(deleted or merged there, never removed here), against only 4 missing inbound.
- **Rule:** "is everything in A also in B" is half a question. Pull both id sets and diff both
  ways; the surprising number is usually the one you did not ask for.
- Deleting the 180 is NOT safe to do unprompted — opportunities, proposals and tasks reference
  contact ids. Flagging them `deleted_in_ghl` and excluding them from counts gives exact parity
  in the UI without orphaning anything. Awaiting Jack's call.

## 2026-08-07 — "I can't find the lead" was never the sync. The Contacts page lists OPPORTUNITIES.
Jack searched Contacts for Tony Lightwood right after the sync fix put him in the database, and
still got "No contacts found". Tony was there: `local_contacts` row present, `deleted_in_ghl_at`
null. What he did NOT have was an opportunity.
- `app/api/contacts/route.ts` builds its list from `getAllOpportunities()` /
  `getOpportunitiesFromMirror()` and enriches from `local_contacts`. So a contact only appears
  if they have an opportunity in GHL — despite the page being called "Contacts" and subtitled
  "Every lead across GHL and comment sources".
- **Measured: 1,895 of 5,094 live contacts have no opportunity — 37% of the CRM is invisible
  on the Contacts page.** Every brand-new lead is in that 37%, which is exactly the cohort Gage
  searches for, which is exactly why he kept falling back to GoHighLevel.
- The sync bug (4 missing contacts) was real but was NOT this. Fixing it did not make Tony
  findable, and would never have.
- **Fix:** source the page FROM `local_contacts` (filtered `deleted_in_ghl_at IS NULL`) and LEFT
  JOIN opportunities, rather than deriving it from opportunities. Consequence to weigh first:
  the page grows from ~3,199 to 5,094 rows and every saved filter/segment count shifts.
- **Rule:** when a record is "missing from the UI", verify it is missing from the DATA before
  fixing the pipeline that fills the data. I fixed a real sync bug that was not the reported
  problem. The next check — "is it in the table?" — took one query and pointed somewhere else.

## 2026-08-07 — Contacts page rebuilt on contacts (fix shipped)
`app/api/contacts/route.ts` now iterates `local_contacts` (filtered `deleted_in_ghl_at IS NULL`)
and treats the opportunity as an ATTRIBUTE of a contact rather than the reason a contact exists.
- The contact-fields query that already existed for the DND/customer maps was widened to carry
  name/email/phone/website/company/tags/dates/owner, so this cost no extra round trip.
- Every opportunity-derived field on `UnifiedContact` was ALREADY nullable
  (`opportunityId`, `stage`, `stageId`, `pipelineId`, `opportunityStatus`, `monetaryValue`,
  `assignedTo`, `daysInCurrentStage`), so no type changes were needed — the shape had always
  allowed a contact without a deal; nothing ever produced one.
- `daysInCurrentStage` is null (not 0) with no opportunity: "0 days in stage" reads as a
  brand-new deal rather than "there is no deal".
- `website` can only come from `local_contacts` — GHL's embedded opportunity contact carries
  only id/name/companyName/email/phone/tags/score (lessons 2026-06-29).
- Verified on prod: search "tony lightwood" returns 1 row with stage "(no opportunity)", and
  the page total reads 5,094 — exactly GHL's count, up from ~3,199.

## 2026-08-07 — A stale mirror looks exactly like a broken filter
Jack: "we filter by Unresponsive (Demo Not Started) and get 14, GHL says 0 — every filter is
100% incorrect." The obvious suspect was stage-NAME resolution (`local_opportunities.stage_name`
is NULL for every row; names are resolved at read time from `local_pipelines.stages`).
- **The mapping was fine.** The neighbouring stage "Unresponsive (Demo Not Started) - TP1"
  matched GHL's 230 exactly. A correct number next to a wrong one exonerates the mapping.
- **The population was wrong.** I sampled six of our 46 opportunities in that stage against
  `GET /opportunities/{id}` — all six returned **404**. Deleted in GHL, never removed here,
  counted forever, because the sync only upserts.
- After ghost-deleting the 98 orphans, all five sampled stages matched GHL to the row.
- **Rule:** when a filter returns the wrong count, check whether the rows it returned still
  exist upstream BEFORE touching the filter logic. Six id lookups settled it in a minute; a day
  could have gone into the stage-name mapping, which was never broken.
- **Rule:** a pipeline total will still differ from GHL's board — the board defaults to "Open
  opportunities". Compare like for like (2,247 all-status vs 2,194 open = the 52 won + 1 lost).

## 2026-08-07 — Ghost delete needs a partial-pull guard, or it is a data-loss weapon
Both reconcile scripts ghost-delete "everything we have that GHL does not". If the GHL pull
truncates — a 500 mid-pagination, a stuck cursor, a rate limit — that set becomes "almost
everything", and one run would wipe the CRM.
- Contacts: refuses unless `pulled === reported total`.
- Opportunities: refuses if the pull is under 50% of what we hold live, plus a cycle guard that
  aborts when a page adds no new ids.
- **Rule:** any "delete what the source lacks" job must first prove it saw the whole source.
  The guard is not optional and belongs in the script, not in the operator's head.

## 2026-08-07 — I broke Meta attribution on 5,094 contacts by "fixing" the sync endpoint ★
To make the contact sync newest-first I switched `syncContacts()` from v1 `/contacts/` to
v2 `/contacts/search` (the only one that accepts a sort). tsc passed, the build passed, the
sync reported `{ok:true, contacts:5094}`, and Tony Lightwood arrived. It looked like a clean fix.

**It silently destroyed the Meta attribution on every contact it touched.**
- v1 `/contacts/` returns an `attributions` ARRAY — every UTM touch, including `utmAdId`.
- v2 `/contacts/search` returns `attributionSource` / `lastAttributionSource` (single objects)
  and **no `attributions` array at all**.
- `upsertContact()` stores the whole payload as `raw_data`. The Leads page identifies a Meta
  lead with `raw_data::text ILIKE '%"utmAdId"%'`, so the Leads Centre fell from **553 to 10**.
- The only survivors were the 10 ghost-deleted contacts — the ones the sync SKIPPED. That is
  the tell: when the only intact records are the ones you did not process, the processor is
  the culprit.
- Recovered fully by reverting to v1 and re-syncing (GHL still had the truth): 555 leads back,
  stage spread intact. Nothing was lost, but only because the source system is authoritative.

**Rules:**
- **Two endpoints for the "same" object are not interchangeable.** Before swapping one for
  another in a write path, diff the KEY SETS of both payloads on a real record. One `Object.keys()`
  comparison would have caught this in ten seconds; I ran it only after the damage.
- **A sync that stores a whole payload as raw JSON is a schema contract.** Changing where that
  payload comes from is a migration, not a refactor.
- **"The count is right" is not "the data is right".** 5,094 contacts synced, every one of them
  degraded. Verify a downstream CONSUMER of the data, not the row count.
- The original problem (v1 pages oldest-first and a 50s budget dropped the newest leads) is now
  fixed the boring way: `CONTACTS_BUDGET_MS = 200_000` so the pass finishes, plus a loud
  `console.error` if it ever truncates. Slower and correct beats clever and lossy.

## 2026-08-07 — "Can't find these anywhere" — 44% of contacts had an unsearchable website ★
Gage could not find `harborheightscoffee.com` or `buruv.com`. Both were in the system the whole
time, with open opportunities and a conversation each, both assigned to Kelsey.
- The website was in a GHL **custom field** ("Your website", `te2hH1PWliUW8R18epQn`), never in
  `local_contacts.website`. `upsertContact` did `website: c.website ?? null` — and Meta lead-ad
  submissions put the URL in a custom field, so the native column stayed empty.
- **Scale: 2,258 of 5,094 live contacts (44%) had a URL on the record that nothing could search.**
  Contacts with a website went 790 → 3,564 after one sync.
- The Contacts page ALREADY searched `website`. It had nothing to search. A correct search over
  an empty column is indistinguishable from a broken search.
- The field ids were already known — `LEGACY_WEBSITE_FIELD_IDS` in lib/ghl/qualification.ts,
  used by the per-contact route and the DTC KPI. Three places knew; the sync did not.
- **Fix:** `resolveWebsite()` in the sync — native field, then "Your website", then "Full
  Website URL", with the non-string coercion the 2026-06-25 lesson demands. Fixes every future
  sync and backfilled all 2,774 in one run.
- **Rule:** when a user says a record is missing, search EVERY text/jsonb column in EVERY table
  before believing them. A 100-table scan took one query and found both immediately.
- **Rule:** if a field exists in three places (native column + two custom fields), the ingest
  layer must normalise it ONCE. Every consumer resolving it independently means the ones that
  forget — like search — fail silently.

## 2026-08-07 — Two bugs behind one symptom: the URL search
Backfilling the website column made `search=buruv` work, and I called it fixed. Jack then
pasted the URL the way a human actually does — `https://harborheightscoffee.com/` — and got
nothing, on a contact that was right there.
- We store `www.harborheightscoffee.com`; he searched `https://harborheightscoffee.com/`.
  **Neither string contains the other**, so a substring match can never join them.
- Fix: `urlKey()` in lib/utils/url.ts — strip scheme, `www.`, query/hash and trailing slash,
  lowercase — applied to BOTH the query and the stored value before comparing. Verified on
  prod across all six forms (`https://…/`, `www.…`, bare domain, uppercase, partial).
- **Rule:** I verified the fix with MY search term, not the user's. `search=buruv` was the
  convenient case; the real one is a pasted browser URL. Test with the input the user actually
  types, in the shape they actually type it.
- **Rule:** any field a human copies from elsewhere (URL, phone, email, handle) needs a
  normalised comparison key on both sides. Exact/substring matching on free-form input fails
  on formatting, not on content.

## Run the linter before hunting a render crash by hand (2026-08-28)

The opportunity card on the dashboard calls strip crashed on the first click and worked on the
second. I spent three rounds reading `opportunity-modal.tsx` by eye, auditing every dereference
on the render path for values used before their query resolved, and found nothing, because every
one of them was correctly guarded. The cause was `react-hooks/rules-of-hooks`, which `npx eslint`
reports in about two seconds:

    494:3  error  React Hook "useEffect" is called conditionally.

`MessagesTab` ran 5 hooks, early-returned a skeleton while `convLoading` was true, and then
called a 6th `useEffect` below that return. Once the conversation query resolved the guards fell
through, the 6th hook appeared, and React threw "Rendered more hooks than during the previous
render". `staleTime` served the conversation synchronously on the second open, so all 6 hooks ran
from mount and it worked. That is the whole "fails once, then fixes itself" behaviour.

- **Rule:** "crashes the first time, works the second time" in React is a hook-order or
  cache-warming signature. Run `npx eslint <file>` FIRST, before reading anything. Existing lint
  errors in a file are suspects, not background noise.
- **Rule:** an early return placed above a hook is the bug, not a style issue. Hooks that guard
  their own bodies (`if (initialDraft && conversationId)`) belong above every early return.
- **Rule:** when static inspection keeps coming up empty, that is evidence the tool is wrong, not
  that the search needs another pass. Switch tools instead of repeating the pass.
- **Rule:** a fix that makes a symptom disappear is not a fix. An error boundary with a silent
  retry masked this perfectly, and would have shipped as "fixed" while the same crash still took
  the whole page down at the 11 other `OpportunityModal` call sites that have no boundary.

## Never `git checkout <file>` in this repo (2026-09-12)

I reformatted `vercel.json` with a Python json round-trip, saw an 84-line diff where I wanted
three, and reached for `git checkout vercel.json` to undo it. That did not undo my edit. It
restored the file to HEAD, and HEAD is ~32 commits behind the working tree. The working copy
had 30 cron entries; the committed one has 17. I destroyed 13 of Jack's cron registrations
(sync-ghl x4, sync-stripe x2, kpi-watchdog x4, ninety-day-charges, sync-customers,
reconcile-opportunities x2) in one command, and `git status` then reported the file as clean,
so nothing looked wrong.

Recovered it exactly by downloading the file from the last production deployment:

    GET /v6/deployments/{id}/files            -> find the uid for /src/vercel.json
    GET /v7/deployments/{id}/files/{uid}      -> {"data": "<base64>"}

Decoded, diffed against my memory of the earlier read, restored, then re-applied the change
as a surgical text edit. Verified with a diff showing only the intended lines.

- **Rule:** in this repo `git checkout`, `git restore` and `git stash` on a tracked file are
  DESTRUCTIVE, not undo. ~257 files are modified against HEAD and Jack pushes rarely, so HEAD
  is not a safe fallback for anything. To undo my own edit, reverse the edit.
- **Rule:** before touching a tracked file, if I might want to revert, copy it to the
  scratchpad first. That copy is the undo, not git.
- **Rule:** never round-trip a config file through a parser to change two values. `json.dumps`
  reformats the whole file and buries the real change in noise, which is what tempted the
  bad revert. Edit the text.
- **Rule:** a Vercel deployment is a recoverable backup of every source file at deploy time.
  Worth remembering the next time something uncommitted is lost.

## Slack `conversations.list` must be paginated, `limit` is a hint only
2026-09-23. Posting the demo GIFs failed with `channel not found` because the lookup
called `conversations.list?limit=200` once. This workspace returns a handful of channels
per page regardless of `limit`: 18 channels took 9 pages, and `#kracked-software` (private,
bot is a member) only appeared on a later page. Always walk `response_metadata.next_cursor`
until the channel is found or the cursor is empty. A single-page miss looks identical to
"the bot was never invited", which sends you debugging the wrong thing.


## Drizzle hides the Postgres error code, so never sniff the error TEXT
2026-09-23. The attribution job classified "this appointment already pays someone" by testing
`String(err)` for the constraint name. Drizzle wraps the driver error, so the string is only the
failed SQL: the constraint name and SQLSTATE live on `err.cause`, sometimes nested. The guard was
working perfectly and being reported as an unknown failure. Walk the `cause` chain for
`code === "23505"`. The same walk is now in lib/booking/attribute.ts and
app/api/booking-links/book/route.ts.

## `a ?? b` in a match rule can delete the rule
2026-09-23. `p.calendarId === (ev.calendarId ?? p.calendarId)` reads like a safe fallback and is
actually `true` whenever the field is missing, turning the strictest condition in a pay
calculation into a no-op. When a field is missing from a payload, the answer is to DISQUALIFY the
record, not to substitute the thing being tested against. Tag records with the value you asked
for rather than trusting the one they report.

## This Vercel account only allows once-daily cron expressions
2026-09-23. `20 */3 * * *` is rejected at deploy time: "Hobby accounts are limited to daily cron
jobs". That is why `sync-ghl` appears four times at different hours instead of once with an
interval. To run something N times a day, add N separate entries. The deploy fails loudly, so
this costs a deploy rather than silently running less often.

## "Automatically collect" and "send an invoice" are different products
2026-09-24. The instalment engine created a `send_invoice` invoice and emailed a payment link.
Jack asked why instalments do not "automatically collect". They never had. Charging the card on
file is `charge_automatically`, and on that path FINALISING THE INVOICE IS THE CHARGE, which
changes the meaning of every timing decision in the code: a 3-day "send it early as a courtesy"
lead time silently becomes "debit them 3 days early". Also: Stripe rejects a `due_date` in the
past, so any overdue instalment on the invoice path throws unless the date is floored forward.
Both were caught by a Test Clock proof, neither by reading the code.

## A fix for a jam can create a charge
2026-09-24. A voided invoice used to block a client from ever being billed again. The obvious
fix, clearing the invoice id so the row is billable again, combined with a daily sweep to
produce a genuine loop: the sweep raised a new invoice the next morning and the card was debited
three days after a human deliberately voided it. When undoing a block, ask what the recovery
path will do with the freed record, and prefer a terminal state a person must leave deliberately.

## A route that starts moving money needs re-reviewing as if it were new
2026-09-24. "Mark instalment paid" was a badge toggle: a session check was proportionate. Adding
one line so it advances the billing plan turned it into a money-moving endpoint, still with no
admin gate, no ownership scoping, no runtime validation of the body, no confirm dialog, and no
voiding of the invoice it superseded. The diff was one line; the required review was not.

## Do not tell a client WHY a payment is late
2026-09-25. Two clients were emailed a heads-up before a late instalment was charged, and the
copy said the delay was "a billing issue on our side". Jack afterwards: "None of them should
have had a email for this btw." Naming our own failure invites a conversation the client was
never going to start, and on a payment they already owe under a signed agreement it converts a
routine collection into a negotiation. The default is to take the payment on the agreed date and
say nothing. If a heads-up is ever wanted, it states the amount and the date and stops there.

## A green test suite can be green about the wrong thing
2026-09-25. The calling-hours warning had 31 passing assertions and was still broken in five
ways, two of them firing false warnings on live contacts. Every assertion tested the pure
function; nothing tested that the dialer PASSED it the data, that the dialog suppressed the
keypad behind it, or that "Call anyway" dialled the number that had been checked. The suite
could not see any of that and was green throughout. When a feature spans a library, an API and
a component, at least one test has to cross those seams or the passing count is decorative.

## "+" plus ten digits is a US number missing its country code, not a foreign one
2026-09-25. Ten contacts are stored as "+6463164592": a New York number (646) whose leading 1
was lost. Read greedily, +646 is New Zealand, so the dialer announced "It's 6:42am in Auckland"
about someone in Manhattan, stated as fact. NANP area codes collide directly with country
codes: +612 looks like Australia, +917 like India, +551 like Brazil. Any E.164 parser in this
repo must special-case "+ and exactly ten digits whose first three are a real area code".

## Check a continent-wide claim against the country, not the continent
2026-09-25. GoHighLevel's timezone was accepted whenever it was "America/*", which spans UTC-3
to UTC-10, so a Phoenix number was happily placed in Sao Paulo, four hours out. A region prefix
is not a validation. Compare against the set of zones the number's own country can actually be
in.

## Offering half-hours in a picker means honouring them in the engine
2026-09-25. The calling-hours UI offered 49 half-hour steps while the engine compared only the
integer hour, so Canada's 9:30pm legal close let a 9:50pm call through in silence, and an admin
setting 8:30am-5:30pm actually got 9:00am-5:59pm. The minutes were being requested from Intl and
then discarded. If a control lets someone pick a value, the code behind it has to be able to
mean it.

## One hardcoded sentence stops being true the moment a setting exists
2026-09-25. "Telemarketing is not permitted there on a Sunday" was correct while Australia's
Sunday ban was the only day-off that could exist. The instant admins could switch off any day,
turning off Saturday told the rep it was Sunday. When a constant becomes configurable, every
string derived from it has to be derived again.

## A settings screen that sends every field freezes every default
2026-09-25. The calling-hours form seeded all five regions and PATCHed the lot, so changing the
UK by 30 minutes wrote a snapshot of US, Canadian and Australian law into the database. A later
change to the statutory defaults in code would then have had no effect in production, silently.
Store only what actually differs from the default, and the default stays live.

## 2026-09-25: an apply script with no dry-run mode ran for real on `--help`
- **What happened:** `scripts/apply-0064-tracker-setters-on.mjs` was cloned from 0062, which has no
  flag handling. Running it with `--help` to "check" it applied the go-live switch to production
  (setters could see the Pay Tracker for ~2 minutes). Reverted by hand; no other data touched.
- **Rule:** every `scripts/apply-*.mjs` defaults to DRY RUN and only writes with an explicit
  `--apply`. Never invoke a script that writes to prod to "see what it does": read it first.

## 2026-09-25: the app-wide keepPreviousData default is wrong for per-person screens
- `providers/query-provider.tsx` sets `placeholderData: keepPreviousData` globally. On the Pay
  Tracker that showed Gage's pay under Kelsey's name while her month loaded. Any screen whose
  query key is a PERSON (pay, permissions, private data) must opt out: `placeholderData: () => undefined`.

## 2026-09-25: verify a spreadsheet's semantics against the data, not one example
- I inferred "the sheet files by call date" from one row (Archetype), then one row (Tyler Kreuzer)
  seemed to contradict it. Matching all 15 August rows to appointments settled it (12/15 exact call
  dates) and exposed two rule bugs (follow-ups suggested as bookings; Gage books for Kelsey's leads).
