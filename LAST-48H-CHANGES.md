# Kracked Sales — What we built in the last 48 hours

Plain-English summary of every change shipped to the live app (Jun 22–23).

---

## 1. The Calls page (the biggest one)

**What it does:** One page that lists every call — booked Google Meet calls, plus
inbound/outbound phone calls from the GoHighLevel dialer — past and upcoming, for
the whole team.

- **Fixed "Unknown" everywhere.** Every booked call used to show "Unknown" for the
  person. Now it shows the real contact name. (The system was reading the name from
  an empty field and ignoring the one that actually had it.)
- **Smart status.** Each call now shows Upcoming, Completed, or No-show. The
  no-shows are pulled from the outcomes the reps actually set, so it reflects reality.
- **Fixed the times.** Every booked call was showing 7 hours off. Corrected all 241
  of them.
- **Cleaner look.** Contact avatars, colour-coded status pills, tidy layout.
- **Click any call → a full detail window opens** (see point 3 below).

## 2. Fathom is now connected (recordings + transcripts)

**What it does:** Whenever a call is recorded in Fathom, the app automatically pulls
back the recording, the full transcript, and the AI summary, and attaches them to
the right call in our system.

- **It was completely broken before** and silently pulled nothing — one tiny mismatch
  in how we read Fathom's data. Now fixed.
- **It attaches to the existing call** (matched by the Google Meet link), so the
  recording shows up on the same call the rest of the app already knows about — not a
  duplicate.
- It also grabs Fathom's AI summary, "Wants / Objections / Next Steps / Red Flags"
  insights, and a sentiment score (e.g. "Positive 4/5").
- Runs automatically every day. Backfilled the existing recordings (incl. the test
  call with you and Gage).
- **Note:** only calls actually recorded with Fathom get this — older calls without
  Fathom stay blank, which is expected.

## 3. The call detail window (opens when you click a call)

**What it does:** A big, clean pop-up with everything about that call in one place.

- The **recording plays inside the app** (top-left).
- The **full transcript** sits next to it, with timestamps and who said what.
- **Click any line in the transcript and the video jumps to that exact moment.**
- The transcript **highlights the line being spoken** as the recording plays
  (follow-along).
- The **AI summary** and the **insight cards** (Wants / Objections / Next Steps / Red
  Flags) are right there too.
- For upcoming calls it shows a "Join Google Meet" button instead.

## 4. Each call tile shows what the call is FOR

On the dashboard, every upcoming-call tile now shows which calendar it was booked
through — e.g. "Email Design Demo | Intro Call" or "Audit Review" — so the rep knows
what to prepare for before they jump on.

## 5. Pre-call prep tidy-up

On the dashboard call tiles, the pre-call prep used to open if you clicked anywhere
on the tile. Now it only opens from its own little icon, so you don't trigger it by
accident.

## 6. Contacts — new filter system

**What it does:** Replaced the clunky old rule-builder with simple tap-to-toggle
filter pills.

- Live count at the top (e.g. "3,131 → 1,861 match") as you filter.
- **Pipeline first, then stage:** you pick a pipeline, and only that pipeline's
  stages show. Before, every stage from every pipeline was dumped in one messy list.
- Filters save into the web address, so you can bookmark / share a filtered view.

## 7. Contact vs Opportunity windows now look different

**What it does:** The "contact" window (a person) and the "opportunity" window (a
deal) used to look identical, which was confusing.

- **Contact = navy, round avatar, "CONTACT" tag.**
- **Opportunity = gold, square tile, "OPPORTUNITY" tag, with the deal value shown.**
- You now know at a glance which one you're looking at.

## 8. Call outcomes show in the activity history

When a rep marks a call outcome (no-show, closed, etc.), it now appears in that
contact's activity timeline AND on the opportunity — colour-coded — so the last
thing you see is "did not attend" or "closed", at a glance.

## 9. Audit tracking (built out fully)

**What it does:** When the team creates an account audit, the app now tracks it end
to end.

- Premium redesign of the "Create Audit" pop-up (cleaner fields, auto-fills the
  creator's name).
- Wired up two buttons that were dead and did nothing.
- Records every audit in our database, links it to the contact.
- A new **"Audit delivered"** filter on the contacts list, kept up to date by a
  daily check against ClickUp.

---

## Honest notes / still to confirm

- **The in-app video player** for Fathom recordings: built and the data is perfect,
  but it needs a quick check in a real Chrome browser (the automated test tool I use
  can't play video, so I couldn't verify playback myself). If it ever can't play, it
  shows a "Watch on Fathom" button as a fallback.
- **Dialer (phone) calls:** only inbound calls are currently being captured, and none
  since early April. That's a separate GoHighLevel sync issue to look into.
- **Rep name** is still blank on some calls where GoHighLevel didn't record who was
  assigned — improvement in progress.

Everything above is live on the real app now.
