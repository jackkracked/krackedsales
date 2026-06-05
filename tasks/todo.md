# KPI Page Overhaul — Execution Plan

## Phase 1: Data Layer
- [ ] 1.1 Create `offer_funnels` table (name, pipelineIds, campaignFilter, adPlatform)
- [ ] 1.2 Create `manual_expenses` table (name, amount, month, category)
- [ ] 1.3 Create `kpi_visibility` table (section, metricKey, visible, position)
- [ ] 1.4 Run migrations

## Phase 2: API Layer — Metrics Computation
- [ ] 2.1 Rewrite `/api/kpis/business` — Cash Collected, Outstanding, Total MRR, Total Expenses, Net P/L
- [ ] 2.2 New `/api/kpis/management` — Mgmt MRR, New Mgmt MRR, Churned MRR, # Clients, Retention Rate
- [ ] 2.3 New `/api/kpis/project` — New Project Value, # Active Projects (manual override)
- [ ] 2.4 New `/api/kpis/sales` — Proposal values sent/lost by type, Ad Spend total + by channel
- [ ] 2.5 Rewrite `/api/kpis/offer` — funnel-aware with pipeline mapping + campaign filter
- [ ] 2.6 CRUD endpoints: offer funnels, manual expenses, kpi visibility toggles

## Phase 3: UI — Complete Page Rebuild
- [ ] 3.1 New MetricCell component (section-band layout, not floating cards)
- [ ] 3.2 New MetricSection component (header + responsive fill-width grid)
- [ ] 3.3 Rebuild kpis-client.tsx — all sections + offer funnels + period picker
- [ ] 3.4 Settings panel (right slide — metric toggles + offer funnel config)
- [ ] 3.5 Manual expense entry (Total Expenses card → manage panel)
- [ ] 3.6 Inline manual entry for # Active Projects

## Phase 4: Health Page
- [ ] 4.1 Rebuild health-client to mirror new metric sections (full-width layout)
- [ ] 4.2 Update health definitions for all new metrics + source systems

## Phase 5: Verification & Deploy
- [ ] 5.1 Type-check, verify all metrics compute correctly
- [ ] 5.2 Deploy to production
