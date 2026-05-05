# Settings → KPI Cost Automation — Plan

## Goal
1. Settings: add Software Costs section (name + monthly cost, list of entries)
2. Settings: add Cost Per Email field (single value)
3. KPIs: auto-calculate `software-cost` = sum of all active software costs
4. KPIs: auto-calculate `team-fulfillment` = costPerEmail × completed demos that month

Both KPI cards already exist in the UI — they just need live data instead of zeroes.

---

## DB Schema (2 new tables)

**`software_costs`**
- id (uuid PK)
- name (text) — e.g. "GoHighLevel"
- monthly_cost (doublePrecision)
- active (bool, default true)
- created_at (timestamp)

**`cost_settings`**
- id (uuid PK)
- cost_per_email (doublePrecision) — cost per completed demo
- updated_at (timestamp)
(Single-row table — always upsert the one row)

---

## Steps

- [ ] 1. Add both tables to `lib/db/schema.ts`
- [ ] 2. User runs `npx drizzle-kit push`
- [ ] 3. Create `/api/settings/software-costs` (GET list, POST create)
- [ ] 4. Create `/api/settings/software-costs/[id]` (DELETE)
- [ ] 5. Create `/api/settings/cost-settings` (GET + POST upsert)
- [ ] 6. Create `/api/kpi/computed-costs?since=&until=` 
        Returns: { softwareCost: number, teamFulfillment: number }
        - softwareCost = sum of active monthly costs (same every month, not date-filtered)
        - teamFulfillment = costPerEmail × emailDemosStarted for the period
- [ ] 7. Build `components/settings/software-costs.tsx`
        - List entries (name + £X/mo), delete button per row
        - Add form: name + cost
        - Shows total at bottom
- [ ] 8. Build cost-per-email field inside a small "Cost Settings" card
        `components/settings/cost-settings.tsx`
- [ ] 9. Add both to settings page (row below the top grid)
- [ ] 10. Update `kpis-client.tsx` — add query for `/api/kpi/computed-costs`
         Inject into `data.detail.softwareCost` and `data.detail.teamFulfillment`
- [ ] 11. DB push + deploy

---

## Notes
- "Completed demos" = `emailDemosStarted` count (same API already used in KPIs)
- Software cost is not date-scoped — it's the same monthly total regardless of period
  (For weekly/quarterly views the KPI page will show the same monthly total, which is fine — it reflects their fixed monthly overhead)
- Manual overrides in the KPI page still work on top of these calculated values
