# Leads Centre — Design Brief (impeccable shape)

**Register:** product · **Fidelity:** production-ready, shipped · **Date:** 2026-08-07

---

## 1. Purpose

Gage currently works leads across three tools: Meta Leads Centre (to read the lead and set a stage), GoHighLevel (to find the contact), and Kracked Sales (to do the work). This collapses that into one surface.

The second, less obvious purpose: Meta's stage dropdown is what Gage *believes* feeds ad optimisation. It largely doesn't — for a Conversion Leads campaign the algorithm learns from the Conversions API event. So this feature must **send the real signal** as it replaces the ritual.

**Success:** Gage never opens Meta Leads Centre again, and Meta receives a Qualified event within minutes of him setting one.

## 2. Users

Gage, daily, working a queue. Alice and other reps secondarily. State of mind: **focused triage** — batch-processing a list, not exploring. Speed and keyboard flow beat discoverability. PRODUCT.md: "Built for people who know what they're doing. No hand-holding."

## 3. Scope

| | |
|---|---|
| Location | New top-level **Leads** page, sidebar position between Dashboard and Pipeline (funnel order) |
| Tabs | **Form Leads** (Meta lead ads via GHL) · **Comment Leads** (`social_leads`) |
| Out of scope | DM leads (not stored anywhere; they live in Inbox) |
| Visual direction | Copy Meta's Leads Centre structure closely. Kracked tokens for colour/type — a Facebook-blue button inside Kracked is a bug, not fidelity. |

## 4. Data

**Form Leads** — source of truth is GHL (`local_contacts`), filtered to Meta-attributed. Enriched from `facebook_leads` on email for the Meta lead ID.

```
identity     full_name, email, phone
attribution  utmAdId, utmCampaignId, mediumId (= Meta form id),
             utmCampaign, utmContent (ad name), isFirst/isLast
answers      custom_fields [{id, value}] — resolve ids to question labels via GHL, cached
meta lead id facebook_leads.leadgen_id, joined on email (may be absent)
```

**Comment Leads** — `social_leads`: name, platform, comment_text, keyword, post/comment id, editable email/phone/website/notes, contacted_at, demo_started_at.

**Ranges:** 55–248 leads/month; 5,270 contacts total. Table must stay fluid at 1,000+ rows. Meta's own counts run to 187 in a stage.

## 5. Stage model — TWO fields, deliberately

| Field | Values | Fires CAPI | Lives on |
|---|---|---|---|
| **Meta lead stage** (new) | Intake · Need More Info · Qualified · Disqualified · Converted · Lost · Not Qualified | **Yes, on Qualified** | Every lead AND every opportunity |
| GHL pipeline stage (existing) | unchanged | No | Opportunities |

They sit side by side. Neither overwrites the other. Changing the Meta lead stage writes back to GHL as a custom field and emits the Conversions API event.

**Meta's Leads Centre chip will NOT change** — Meta exposes no write API for it. Accepted: the chip becomes vestigial once Gage stops opening it.

## 6. Layout — mirrors Meta

```
Leads                                    [Export] [Settings]
─────────────────────────────────────────────────────────────
 Form Leads (13)   Comment Leads (10)
─────────────────────────────────────────────────────────────
 Intake leads 13 ↑6.8%   Qualified 62   Conversion rate 26.6%
─────────────────────────────────────────────────────────────
 All | Unread |  Intake 13 › Need More Info 0 › Qualified 62 ›
                 Disqualified 0 › Converted 187
─────────────────────────────────────────────────────────────
 [Campaign ▾] [Form ▾] [Dates ▾] [Source ▾] [Assigned ▾]
─────────────────────────────────────────────────────────────
 Date added │ Name          │ Stage    │ Source │ Assigned │ Ad
 6 Aug      │ Jeremy Conti  │[Intake ▾]│ Paid   │ Gage ▾   │ …
```

### The drawer — EXTEND the existing one, do not fork

`components/inbox/lead-details-sidebar.tsx` (893 lines) already exists and is used by
`inbox-client.tsx` and `meta-conversations.tsx`. It carries Contact / Deal value / Lead
details / Source, plus quick actions **Task · Demo · Audit** (lines 313-315) that work today.

The Leads Centre becomes its **third consumer**. New sections render only when their data is
present, so the Inbox is untouched:

```
  Name (click -> opens contact modal)        [NEW behaviour, benefits Inbox too]
  ─────────────────────────────────────
  Quick actions:  Task · Demo · Audit        [EXISTING, kept exactly]
  ─────────────────────────────────────
  Contact          phone · email             [EXISTING]
  Lead management  Assigned to · Stage ▾     [NEW — stage fires CAPI]
  Form answers     question + answer         [NEW — Meta/GHL form responses]
  Source           campaign · ad · form      [EXISTING, enriched]
  Deal value                                 [EXISTING]
  Notes                                      [NEW]
```

**Why extend rather than fork:** two drawers drift apart. That is the same
two-sources-of-truth pattern that produced both the billing failure and the Cheeky
$10,800 display bug. One drawer, optional sections.

**Name is a link** → opens the existing contact modal. The drawer does not do this today;
adding it to the shared component improves the Inbox at the same time.

## 7. States (all required before ship)

- **Loading:** skeleton rows, never a centred spinner
- **Empty:** per stage tab, teaches the filter rather than "nothing here"
- **Error:** inline retry, never a blank table
- **Stage change:** optimistic, with rollback + toast on failure — CAPI must never silently fail
- **Long text:** 60-char names, 15-question forms, missing email or phone
- **Volume:** 1,000+ rows without jank

## 8. Anti-goals

- Not a second pipeline. Comment leads stay OUT of the pipeline until a demo is submitted (existing, correct behaviour).
- No duplicate leads. `facebook_leads` enriches, it never creates a row.
- Not a CRM rebuild. Clicking a name hands off to the existing contact card.
- No Facebook chrome. Structure copied, styling is Kracked's.

## 9. Biggest risk

Gage stops updating Meta's chip, and CAPI isn't live or isn't matching. Then the optimisation signal he creates today **disappears**. Mitigation: CAPI ships in the same release as the UI, with a visible per-lead "signal sent" indicator so failure is observable.

## 10. Dependencies — RESOLVED 2026-08-07

| | |
|---|---|
| **Pixel / Dataset ID** | **969023258488979** — "Emails by Kracked Retention", already live on Conversions API (411 events) |
| **Campaign objective** | Confirmed **"Maximise number of qualified leads"**, conversion location Instant forms. Campaigns already report Results as *Qualified leads* at $117–$337 each. Nothing to switch. |
| **Event to send** | The Qualified-lead event these campaigns already optimise for |
| Still to do | GHL custom-field id → question-label mapping (one fetch, cached) |

---

## 11. BUILD STATE — updated 2026-08-07 (chat was cleared mid-build; this is the resume point)

### Shipped and live on kracked-sales.vercel.app
- `/leads` page, both tabs (Form Leads · Comment Leads)
- `GET /api/leads` — Meta-attributed feed, stage counts, paging, form-answer resolution
- `PATCH /api/leads/[id]/stage` — persist → GHL write-back → CAPI, in that order
- `components/leads/stage-select.tsx` — portalled menu, optimistic with rollback
- Signal column (`sent` / `not sent` / `not configured` / `From Meta`)
- Drawer = the EXISTING `lead-details-sidebar`, as specified (not a fork)
- Migration `0045_meta_lead_stage.sql` applied to prod

### Added this session
- **Stage rail** (§6) — `All | Untriaged · Intake › Need More Info › Qualified › Disqualified › Converted › Lost › Not Qualified`, with counts. Replaces the native `<select>`, which rendered the raw OS popup inside the product and hid every count.
- **Layout fix** — the metric strip rendered ABOVE the tabs while only applying to Form Leads, so the whole header vanished and the tabs jumped when you switched to Comment Leads. Strip and rail now sit below the tabs.
- **`scripts/import-meta-stages.mjs`** — the cutover stage import. See §12.

### NOT built (deferred from §6, none of it blocks the cutover)
- `Assigned to` column + filter (Meta has it; we have no rep assignment on leads yet)
- Filter row: Campaign ▾ · Form ▾ · Dates ▾ · Source ▾
- Export button
- "Unread" concept (we have `Untriaged` instead, which is the useful equivalent)

### Git state
The whole feature is still **untracked** — `app/(app)/leads/`, `app/api/leads/`, `components/leads/`, `lib/meta/capi.ts`, `lib/leads/`, `db/migrations/0045_*`, `scripts/import-meta-stages.mjs`. Nothing committed. Commit before the next context loss.

## 12. Stage parity with Meta — how, and why it is a one-time import

Meta's Graph API **cannot read a lead's Leads Centre stage.** Proven by exhaustive probe on
2026-08-07, not assumed: 30+ field names, every plausible edge on the lead / page / business
nodes, across v17–v25, with a token holding `leads_retrieval` + `ads_management` +
`business_management`. The write direction was already closed. So there is no sync, in either
direction, ever. The stages come across **once**, from a CSV export, at cutover.

**The clicks:** business.facebook.com → Leads Centre → the ⤓ download icon (top right).
- If the export has a **Stage** column, one file is enough.
- If it does not, filter to each stage in turn and download one file per stage.

**Then:**
```
node scripts/import-meta-stages.mjs ~/Downloads/*.csv            # dry run, writes nothing
node scripts/import-meta-stages.mjs ~/Downloads/*.csv --apply    # commit
node scripts/import-meta-stages.mjs --revert --apply             # undo
```
The dry run prints a per-stage distribution to compare line-by-line against Meta's own rail.

**It will not reconcile exactly, and that is correct.** Meta's rail counts ~407 (15 + 0 + 62 +
0 + 187, plus ~143 Not qualified) against our 553, because Meta's list includes Organic and
Messenger leads that our `utmAdId` filter does not treat as Meta-attributed, and our range runs
back to Aug 2024. Rows in the CSV that match no lead are written to
`meta-stage-import-unmatched.csv` rather than being silently dropped.

**It sends no Conversions API events, deliberately** — Meta is the source of these stages.
See tasks/lessons.md, 2026-08-07.

### Deployed 2026-08-07 16:5x — dpl_2TZbzBHmc1YYegqa54VEMmnBy7U7
Live and browser-verified on kracked-sales.vercel.app (headless Chrome, minted session cookie):
- Stage rail renders: `All 553 | Untriaged 350 · Intake 9 › Need More Info 0 › Qualified 59 › Disqualified 0 › Converted 135 › Lost 0 › Not Qualified 0`
- Pager: "1–50 of 553", Next visible + enabled, `elementFromPoint` at its centre returns the
  button itself (nothing overlaying it), clicking advances to Page 2 / "51–100 of 553"
- Drawer: ONE Qualification section carrying the real Meta form questions. "Klaviyo",
  "Under $3M", "Ready to move" each appear exactly 1×, was 2× before
- Signal column reads "From Meta" on the 203 imported leads
- Previous prod for rollback: kracked-sales-2wlrbjvvv-jack-5430s-projects.vercel.app

### STILL OPEN
1. **The Not qualified export.** Leads Centre's "All" tab excludes it — Jack measured 143 over
   8 Jul–6 Aug, the export has zero. Real membership = 264 + 143 = 407, not 264.
2. **Exact parity mechanism (designed, not built):** the importer stamps a `meta_leads_centre`
   membership flag; the Leads page shows that set plus anything arriving after cutover, so the
   export DEFINES membership and the page cannot drift.
3. **`isMetaLead` is loose** — a text search for `utmAdId` anywhere in the blob, while
   `pickAttribution()` reads only the last touch, so 78 Instagram DMs + 18 calendar bookings
   render as Form Leads with a blank campaign. Do NOT fix by tightening the filter: 55 of
   those 96 are in Meta's Leads Centre. Classify the row instead of excluding it.

### Not-qualified import — 2026-08-07 17:2x
Second export (`leads (1).csv`, 465 rows) was a CLEAN single-stage download: every row
`Not qualified`. That resolved the population question and REVERSED it.

**Meta Leads Centre actually holds 729 rows / 711 distinct people** — All tab 264 + Not
qualified 465. The "All" tab EXCLUDES Not qualified, which is why it looked like Meta had 264
against our 553. Meta's own API total (686 form leads) reconciles: 729 minus ~47 organic
DM leads ≈ 682. So we hold FEWER leads than Meta, not more.

Reconciliation, both files:
```
Meta distinct people      711
  matched to a lead       549   (545 staged + 4 stage-protected)
  not in our population   162   (DM leads with no email/phone, non-ad-attributed, GHL sync lag)
Our Meta-attributed       553
  staged                  545
  still untriaged           8   (in neither export)
```
App now: not_qualified 342 · converted 135 · qualified 59 · intake 9 · untriaged 8.
Verified live on prod. local_contacts still 5,270 rows (no inserts, no duplicates),
zero CAPI events ever sent, zero duplicate emails.

**New flag `--only-untriaged`** — never overwrites a stage already set. Four people are in
BOTH exports under different stages (2 converted, 2 qualified, all also Not qualified) because
Meta keeps one row per SUBMISSION while we keep one per PERSON. Without the flag the second
import would have demoted a converted customer to not_qualified, the row that fires BAD.
