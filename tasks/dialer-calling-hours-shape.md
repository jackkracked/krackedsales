# Dialer calling-hours warning: shape brief

Created 2026-09-25. Status: CONFIRMED and built. Reviewed 2026-09-25; findings fixed; 50/50 proofs passing.

Jack, 2026-09-25: "Kelsey accidentally dialed someone in Australia at 4:00 a.m. Our system
would recognise that, warn her, and then she can continue if she chooses to bypass that."

## What the data actually supports, measured 2026-09-25

| Signal | Coverage | Verdict |
|---|---|---|
| `country` field | 5,797 of 6,083 | **USELESS.** 5,794 say "US", including every Australian and UK number. A default, not data. |
| GoHighLevel `timezone` | 534 of 6,083 (9%) | Exact IANA zones. Rare but perfect where present. |
| **Phone country code** | **3,879 of 3,881 numbers** | **The signal.** +1 (3,345), +44 (238), +61 (223), other (73), none (2). |

So the warning reads the phone number, and prefers GoHighLevel's timezone when it has one.

## The hours, which are law rather than etiquette

- **US (TCPA):** 8am to 9pm local. Breaching it carries statutory penalties per call.
- **Australia (ACMA):** 9am to 8pm Mon-Fri, 9am to 5pm Sat, **nothing on Sunday**.
- **UK:** 8am to 9pm.
- Anywhere else: 8am to 9pm as the safe default.

Admin-editable later if Jack wants, but shipped with these as the defaults because they are the
actual rules.

## How a prospect's local time is decided, and when we stay quiet

In order, stopping at the first that answers:

1. **GoHighLevel's timezone field.** Exact. 9% of contacts.
2. **US/Canada area code.** The three digits after +1 place them in one of six zones.
3. **Single-timezone country.** +44 is Europe/London, and most countries are like this.
4. **Multi-zone country with no finer signal** (Australia on a mobile, an unrecognised US area
   code): use the country's most populous zone and label the warning as approximate.
5. **Nothing usable:** SAY NOTHING. No warning, no guess.

Rule 5 matters more than the rest. A warning that fires wrongly teaches Kelsey to dismiss it
without reading, and then it fails on the one call that mattered. Silence beats a false alarm.

## What Kelsey sees

Nothing at all, on the overwhelming majority of calls. The dial button behaves exactly as it
does today.

When the local time is outside hours, pressing Dial opens a small dialog before anything
connects:

> **It is 4:12am for this contact**
> Sydney, Australia. Calling is restricted to 9am-8pm there on weekdays.
> [ Call anyway ]  [ Cancel ]

- The prospect's **local time is the headline**, because that is the fact that changes her mind.
- The rule is named, so it reads as a real constraint rather than an opinion.
- **Cancel is the default action**, focused, and Escape cancels.
- **"Call anyway" always works.** This is a warning, never a block. Jack was explicit.
- A bypass is NOT recorded. Doing so means threading a flag through Twilio's call parameters
  and the telephony webhook, and that live path is not worth disturbing for a logging nicety.
  Deferred deliberately, not forgotten.

Where it is approximate, the wording says so: "roughly 4:12am (Australia spans three
timezones)". Never a false precision.

## Where it hooks in

One place. `startDial()` in components/dialer/dialer-client.tsx is the single point every call
passes through, manual dial and campaign alike, so the guard cannot be sidestepped by accident.

## Deliberately NOT in this build

- Blocking a call outright. It warns, she decides.
- Auto-skipping out-of-hours contacts in a campaign queue. That silently reorders her day and is
  a much bigger change; worth discussing separately once this is proven.
- Admin-editable hours. The legal defaults ship first.

## Validation before it ships

- A pure function with unit proofs: every US zone, Australia on a Sunday, UK, an unknown number,
  a missing area code, and both sides of every boundary (7:59am, 8:00am, 8:59pm, 9:00pm).
- Daylight saving handled by the platform's own timezone database, proven across a DST change.
- A staff review of the diff.
- Rendered and looked at, not just typechecked.
