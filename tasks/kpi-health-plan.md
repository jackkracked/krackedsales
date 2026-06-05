# KPI Health & Trust System — Implementation Plan

## Goal
Founders can open `/kpis/health`, see every KPI with plain-English explanations, verify each one is pulling correct data, spot problems instantly, and override values when needed. Every KPI card on the dashboard also shows a small trust indicator.

## Architecture
- **New page:** `/kpis/health` — KPI health dashboard
- **New DB table:** `kpi_health_log` — records every fetch with status, value, errors
- **New API:** `GET /api/kpis/health` — returns health status for all metrics
- **New API:** `POST /api/kpis/verify/[key]` — re-fetches one metric from source, compares
- **Modified:** `/api/kpis/business` — fix Stripe subscription error handling bug
- **Modified:** KPI card component — add inline trust dot
- **Existing:** `/api/kpi/overrides` — already supports CRUD for manual overrides

## File Map

### Create
- `lib/kpi-health/definitions.ts` — plain-English definitions + source descriptions
- `lib/kpi-health/check.ts` — health check engine
- `app/api/kpis/health/route.ts` — health status endpoint
- `app/api/kpis/verify/[key]/route.ts` — single metric verification
- `app/(app)/kpis/health/page.tsx` — page wrapper
- `components/kpis/health/kpi-health-client.tsx` — main health page
- `components/kpis/health/health-row.tsx` — individual KPI row

### Modify
- `lib/db/schema.ts` — add kpiHealthLog table, add note to kpiOverrides
- `app/api/kpis/business/route.ts` — fix Stripe error handling
- `app/api/kpi/overrides/route.ts` — accept note field
- `app/api/dashboard/kpis/route.ts` — auto-log health on every fetch
- `components/dashboard/kpi-widget/kpi-card.tsx` — inline trust dot
- `components/kpis/kpis-client.tsx` — trust dots + link to health page

---

## Tasks

### Step 1: DB schema
- [ ] Add `kpiHealthLog` table + `note` column to `kpiOverrides`
- [ ] Push migration

### Step 2: Plain-English KPI definitions
- [ ] Create `lib/kpi-health/definitions.ts` with all 15 metrics

### Step 3: Fix Stripe subscription error handling
- [ ] Wrap subscription queries in try-catch in `/api/kpis/business`

### Step 4: Health check engine
- [ ] Create `lib/kpi-health/check.ts` — per-metric fresh fetch + validation

### Step 5: Health API endpoints
- [ ] Create `/api/kpis/health` + `/api/kpis/verify/[key]`

### Step 6: Health page UI
- [ ] Build the page + health rows with all states

### Step 7: Override flow with notes
- [ ] Update override API + UI to include reason

### Step 8: Inline trust dots on dashboard
- [ ] Add green/amber/red dots to KPI cards

### Step 9: Auto-logging from existing KPI fetches
- [ ] Log health on every dashboard KPI computation

### Step 10: Link from KPIs page + deploy
- [ ] Add navigation + build + deploy
