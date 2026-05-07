# Calls Page + Calendar Page

## Status: Complete — needs DB migration + Google setup

### Phase 1 — Foundation ✓
- [x] Install googleapis package
- [x] Add calls, user_calendars, booking_automation_rules tables to schema
- [x] Create lib/google/client.ts (service account + delegation)

### Phase 2 — Calls data ✓
- [x] POST /api/calls/sync (+ named runSync export)
- [x] GET /api/calls (filters + metrics)
- [x] GET /api/calls/[id]/transcript
- [x] POST /api/cron/sync-calls

### Phase 3 — Calendar data ✓
- [x] GET /api/calendar/events
- [x] POST /api/calendar/book
- [x] CRUD /api/settings/user-calendars + [id]
- [x] CRUD /api/settings/booking-rules + [id]
- [x] GET /api/ghl/contacts/search

### Phase 4 — Calls page UI ✓
- [x] app/(app)/calls/page.tsx
- [x] components/calls/calls-client.tsx
- [x] components/calls/transcript-drawer.tsx

### Phase 5 — Calendar page UI ✓
- [x] app/(app)/calendar/page.tsx
- [x] components/calendar/calendar-client.tsx (week/month/day)
- [x] components/calendar/event-panel.tsx
- [x] components/calendar/book-call-drawer.tsx

### Phase 6 — Settings + Automation ✓
- [x] components/settings/user-calendars-settings.tsx
- [x] components/settings/booking-rules-settings.tsx
- [x] Settings page Calendars tab
- [x] GHL webhook: AppointmentBooked/Updated → booking automation rules

### Phase 7 — Navigation ✓
- [x] Calls + Calendar added to sidebar (Work section)

---

## What you need to do

### 1. Run DB migration
In /Users/jackpointer/Projects/kracked-sales with .env.local active:
```
npx drizzle-kit push
```
This creates 3 new tables: calls, user_calendars, booking_automation_rules.

### 2. Set up Google service account (for Meet + Calendar)
In Google Workspace Admin → Security → API Controls → Domain-wide delegation, add service account with these scopes:
- https://www.googleapis.com/auth/calendar
- https://www.googleapis.com/auth/meetings.space.readonly

Add to .env.local:
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY=base64:<base64-encoded-service-account-json>
GOOGLE_WORKSPACE_DOMAIN=yourworkspace.com
```

To base64-encode the JSON key file:
```
base64 -i service-account-key.json | tr -d '\n'
```
Then prefix with "base64:" in the env var.

### 3. Add reps to calendar settings
Go to /settings → Calendars tab and add each rep's name, Google email, and GHL calendar ID.

### 4. Add calls sync cron to Vercel
In vercel.json or project settings, add a cron that hits POST /api/cron/sync-calls with Authorization: Bearer {CRON_SECRET} header, on whatever schedule you want (e.g. every hour).
