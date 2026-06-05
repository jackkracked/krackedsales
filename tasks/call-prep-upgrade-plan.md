# Pre-Call Prep — "1000x" Upgrade Plan

## Problem (root causes, confirmed in code)
1. **Website is never read.** `FIRECRAWL_API_KEY` is unset → `gather.ts scrapeWebsite()` returns null on line 1 every time → Gemini guesses from the contact NAME. (Proven: "desert glow ranch → hospitality/ranch business" is wrong; it's a DTC skincare brand.)
2. **$1000 default leaks as budget.** `generate.ts:125` feeds `Deal Value: $1000` (the system default on every new lead) → model invents budget constraints.
3. **Prompt orders guessing.** `generate.ts:86`: "make reasonable inferences rather than saying 'unknown'" → "likely/suggests".

## Requirements (locked with Jack)
- Research engine: **Gemini 2.5 Pro + Google Search grounding** + direct multi-page site fetch. Existing `GEMINI_API_KEY`, no new keys.
- External numbers: **only with a real source** (definitive-or-omit, never guess).
- Regenerate: **desert glow ranch first (Jack reviews), then all**.
- Quality over speed (~20-40s/prep), honest progress.

## Grounding API (verified against live docs + installed SDK)
- Installed `@google/generative-ai@0.24.1` (legacy) supports ONLY `googleSearchRetrieval` (Gemini-1.5 era). Gemini 2.5 needs the `google_search` tool.
- Use the current **`@google/genai`** SDK for the grounded research call. Read sources from `response.candidates[0].groundingMetadata` (`groundingChunks` {uri,title}). Keep legacy SDK for existing flash calls (non-grounded).

---

## PHASE A — Backend research + prompt (the 1000x; NO UI change, ships within existing UI)

- [ ] A1. Add `@google/genai` dependency. Verify its grounding API against docs before use.
- [ ] A2. New `lib/call-prep/research.ts`:
  - `fetchSitePages(website)`: plain fetch homepage (reuse categorize-brand's extractText, no key), discover internal links matching about|story|product|shop|collection|pricing|faq, fetch up to ~4 more, concatenate (cap ~12k chars).
  - `researchCompany({website, companyName, contactName, siteText})`: Gemini 2.5 Pro + `google_search`. Returns structured facts WITH sources: whatTheySell, productsAndPricing, targetCustomer, positioningVoice, maturity ("emerging"|"established" + evidence), salesChannel, emailPresence, publicNumbers[] (each {claim, sourceUrl} — omit if no source), and confirmOnCall[] (specific unknowns). Definitive-or-omit; no hedging.
- [ ] A3. Rewrite `generate.ts` prompt:
  - Feed the structured research (not raw markdown).
  - BAN hedge words (likely/probably/suggests/maybe/could/appears/seems). Instruction + a post-process guard that flags them.
  - DROP monetaryValue entirely (remove line 125). Add explicit note: "Lead/deal value is a system default; ignore for budget."
  - Unknowns → `confirmOnCall` action items, never guesses.
  - Fit = reasoned from real signals (DTC + email-capture-but-no-flows = strong fit for an email agency).
  - Switch model to gemini-2.5-pro for the synthesis (or keep flash if research is rich — decide after test).
- [ ] A4. `orchestrate.ts`: call new research module; add `force?: boolean` to bypass the `status==="ready"` cache short-circuit (line 44) for regeneration.
- [ ] A5. Stash sources/research onto the stored sections (within existing `sections` JSON; surface sources as text inside brandResearch/qualification so NO UI change is required yet).
- [ ] A6. Honest progress: pass real `onStep` values (fetching site → researching company → writing brief). (Generation-screen currently fakes 2.5s — minimal change to consume real steps; if it needs JSX work, defer to Phase B.)

## PHASE A verification
- [ ] tsc 0 errors. Deploy to prod (only env with keys).
- [ ] Regenerate desert glow ranch (find its calendarEventId/contactId; force-regen) → Jack reviews the live prep.
- [ ] On approval: regenerate all existing preps (script over callPreps table with force=true).

## PHASE B — UI enrichment (LATER, needs `/impeccable shape` per Gate 2)
- Dedicated prep-document sections: company snapshot, maturity badge (emerging/established), products/pricing list, sources/citations, "Confirm on call" checklist.
- Honest multi-step generation screen.

## Notes
- Default-value detection: don't special-case $1000; simply never use deal value as budget (it's a CRM field, not the prospect's budget).
- Cron (`app/api/cron/call-prep`) will use the new engine for upcoming calls automatically.
- Cost/latency: grounded 2.5-pro ~20-40s/prep. Cron runs ahead of calls, so latency is hidden; cost is per booked call (low volume).
