# Google Workspace Setup — Waiting on Co-founder

## Status: BLOCKED — Step 2 needs co-founder (Google Workspace Admin access)

---

## Steps already done
- [x] googleapis npm package installed
- [x] DB migration run (calls, user_calendars, booking_automation_rules tables live)
- [x] lib/google/client.ts created
- [x] Calls page, Calendar page, all API routes built
- [x] Sync cron added to vercel.json (runs hourly)

---

## Steps completed by Jack
- [x] Step 1 — Google Cloud project created, Calendar API + Meet API enabled, service account created, JSON key downloaded

## Waiting on co-founder
- [ ] Step 2 — Google Workspace Admin → Security → API controls → Domain-wide delegation
  - Client ID: from the "client_id" field in the downloaded JSON key file
  - Scopes: https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/meetings.space.readonly

## Still to do (Jack, after co-founder completes Step 2)
- [ ] Step 3 — Add to .env.local:
  ```
  GOOGLE_SERVICE_ACCOUNT_EMAIL=client_email from the JSON file
  GOOGLE_SERVICE_ACCOUNT_KEY=base64:$(base64 -i ~/Downloads/service-account.json | tr -d '\n')
  GOOGLE_WORKSPACE_DOMAIN=yourdomain.com
  ```
- [ ] Step 4 — Add same 3 vars to Vercel → Settings → Environment Variables → Redeploy
- [ ] Step 5 — Settings → Calendars → add each rep (name, Google email, GHL calendar ID, color)
- [ ] Step 6 — Hit Sync button on the Calls page to do first pull
- [ ] Step 7 (optional) — Settings → Calendars → Booking Automation Rules
