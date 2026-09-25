# ACTIVE: Setter tracker, see tasks/setter-tracker-plan.md (2026-09-25)

# Plan: Instagram handle, contact quick actions, inbox search

Written 2026-08-24. Three items from Jack and Gage, in dependency order.

---

## Item 1 — Inbox search finds nothing (Gage: "it seems like it doesn't exist")

### Root cause (confirmed, not guessed)

`components/inbox/inbox-client.tsx:62-86`.

```ts
const unreadOnly = status === "unread";
const { data } = useConversations(channel, unreadOnly);   // server returns ONLY unread
...
list = list.filter(/* search */)                          // search filters that subset
```

Two compounding faults:

1. **Search is scoped to the active tab.** Gage searched `saude.supps` while the UNREAD tab
   was selected. The API had been called with `unreadOnly=true`, and his inbox was at zero
   unread, so the search ran against an empty array. "No matches" was literally true and
   completely misleading.
2. **Search is client-side over the already-loaded page.** Even on ALL, it only filters
   conversations already fetched. Any conversation outside that page is unfindable.

The contact exists: `saude.supps` = `XL2AWzcJusGKHlDiox9v` in `local_contacts`. Nothing is missing
from the data; the search simply never looked at it.

### Fix

- Add a server-side conversation search endpoint that ignores `status`/`unreadOnly` whenever a
  query is present, and searches the whole mirror rather than one page.
- Search across name, email, phone, and message body, per Jack: "every single piece of information
  from a contact should be searchable".
- When a query is present, the tab filters (UNREAD/RECENT/STARRED) must not narrow results.
  Searching is a global act, not a filter within a view.
- Empty state must distinguish "no results for this search" from "nothing in this tab".

### Verification
- Search `saude.supps` from the UNREAD tab returns the conversation.
- Search by email and by phone each return the right contact.
- Clearing the search restores the tab's normal contents.

---

## Item 2 — Quick actions missing on the contact modal (Gage)

Gage: *"If we can add a place here where we can submit a demo for people that aren't opportunities
yet made in GHL, because when we submit demo it will auto add them as a lead regardless."*

The dialer cockpit already has exactly this (`components/dialer/contact-cockpit.tsx`): Task, Demo
and Audit modals, all taking `contactId` + name/email/phone. The inbox drawer has a quick-actions
row too. The **contact modal does not**, which is the surface Gage lives in.

### Fix
- Reuse the existing `CreateTaskModal`, `CreateDemoModal`, `CreateAuditModal`. No new modals.
- Add a quick-actions row to the contact modal in the empty area Gage circled.
- Works for contacts with no opportunity, which is the entire point of his request.

### Verification
- Open a Meta-sourced contact with no opportunity, submit a demo, confirm the ClickUp task is
  created and linked to that contact id.
- Confirm no duplicate contact is created in GHL.

---

## Item 3 — Instagram handle on the contact (BLOCKED, needs a decision)

### What was proven today
- The `website` field on an Instagram profile is real and readable. Meta returned our own:
  `krackedretention` -> `http://krackedretention.com`.
- **958 contacts** carry an Instagram attribution, and all 958 carry the Instagram-scoped user id
  (`raw_data.attributions[].mediumId`), so identity linking is solid.
- The contact NAME is not the handle. Samples: "besto | natural pesto", "vipe vintage", "vanessa".

### The blocker
Every route to the actual handle needs Meta **Advanced Access**, which we do not have:

| Attempt | Result |
|---|---|
| `business_discovery` on oleboybrand / nike / shopify | `#10 Application does not have permission` |
| `GET /{igsid}?fields=username` | `#200 App does not have Advanced Access to instagram_manage_messages` |
| `/{page}/conversations` participants | `username: (none)` — Messenger only, no usernames |

The token itself is fine: it already holds `instagram_basic`, `pages_read_engagement`,
`pages_show_list`, `instagram_manage_messages`. The gate is app-level Standard vs Advanced Access.

### Options for Jack
- **(a) Manual field now.** Editable "Instagram" field on the contact, renders as a one-click link
  to `instagram.com/<handle>`. Zero Meta dependency. Gage fills it when he has it.
- **(b) Apply for Advanced Access**, then auto-fill all 958 in one backfill.
- **(c) Both**: ship (a), submit for (b), and (a)'s manual step disappears if approved.

Recommended: (c).

---

## Order
1. Item 1 (search) — a real bug, actively misleading the team.
2. Item 2 (quick actions) — small, high value, reuses existing modals.
3. Item 3 — needs Jack's decision first.

## Review notes (staff review, 2026-08-24)

The review corrected the plan on three points and found one live bug. Revised conclusions:

### My root cause for Item 1 was mechanically WRONG
`unreadOnly` is never sent to the server. `lib/hooks/use-conversations.ts:55-67` sends only
`limit=100`; the unread filter is applied CLIENT-side at `use-conversations.ts:78-79`. So there
are TWO independent narrowings in two different files, and fixing the endpoint alone leaves the
bug intact.

### Item 1, further constraints found
- The 100 cap CANNOT be paged: `lib/inbox/mirror-source.ts:5-7` records that GHL's
  `/conversations/search` is hard-capped at 100 and ignores the cursor. Server-side search must
  read `local_conversations`, not GHL live.
- A search endpoint ALREADY EXISTS and is dead code: `app/api/inbox/search/route.ts`, no callers.
  Decide: extend or delete. Note `message_index` has no indexes, so a leading-wildcard ilike is a
  full scan.
- Search results must merge `conversation_flags` or soft-deleted threads resurrect and everything
  shows as unstarred (`app/api/ghl/conversations/route.ts:99-122`).
- Copy the haystack from `app/api/contacts/route.ts:455-473`, which already searches custom fields
  because Gage previously could not find brands by a URL held in a custom field.

### Item 2 is NOT small, and is a duplicate-data risk
`lib/leads/promote-meta-lead.ts:49-56` posts a bare `ghl.post("/contacts")` with NO dedupe and
does not use the contact id we already hold. So from the contact modal:
- without `platform` -> no lead created, Gage's request silently no-ops
- with `platform` -> duplicate GHL contact AND duplicate opportunity for anyone who already exists

Also `CreateDemoModal` never sends `contactId` to the server
(`components/shared/create-demo-modal.tsx:236-255`), so demo boards are recorded with an
OPPORTUNITY id in the `ghl_contact_id` column, or null in exactly Gage's case.
`CreateAuditModal:379` does it correctly and is the model to copy.

PREREQUISITE: add an `existingContactId` short-circuit to `promoteMetaLeadToGhl` and forward the
contact id from the demo modal, BEFORE any UI work.

Reuse, do not rebuild: `contacts-client.tsx:262-265` already has `handleQuickAction`, and the
quick-actions row exists identically in `meta-conversations.tsx:1247-1271` and
`lead-details-sidebar.tsx:393-420`. Extract to `components/shared/`.

### LIVE BUG found (not in the original plan)
`components/inbox/meta-conversations.tsx:1209-1212` asserts *"IG 'name' IS the @handle"* and feeds
it into real demo submissions as the social handle. Measured against production: of 958
Instagram-attributed contacts, **515 (54%) have a name that cannot be a valid Instagram handle**
(spaces, pipes, >30 chars). So roughly half of Instagram demo submissions carry a junk handle such
as "besto | natural pesto". Fix independently of Item 3.

### Revised order
0. Fix `promoteMetaLeadToGhl` dedupe + demo-modal contact id (prerequisite, data integrity).
1. Item 1, inbox search (mirror-backed, both narrowings).
2. Item 2, quick actions (reusing `handleQuickAction`, extracted row).
3. Live handle bug above.
4. Item 3, pending Jack's decision.

Gates 5 and 6 apply to steps 0 and 1 (GHL write path; user input into a DB query).
