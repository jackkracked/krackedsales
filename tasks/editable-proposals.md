# Editable Proposals + Templates

North star: phenomenally beautiful, 100% functionally flawless, nothing broken in the UI. One deploy at the end. Visual rich-text (Tiptap). Structured line-by-line deliverables.

## Architecture (approved by Jack 2026-07-27)
- `proposals.deliverables` JSONB: `{ packageId, packageName, emails, popUps, items:[{id,label,detail?,group:"included"|"exclusive"|"custom",order}] }`
- `proposals.content` JSONB: per-proposal SNAPSHOT of copy sections (intro, scopeIntro, additionalScopeIntro, additionalRates[], acceptance, terms, signature). Captured from active template at draft creation, then editable inline. Doc renders from this snapshot (immutable after send). Legacy (null) -> template -> hardcoded.
- `proposal_templates` table: `type` unique (management|project), `sections` JSONB (content shape) + `deliverablesDefaults` JSONB, `updatedAt`. Seed from current hardcoded copy + existing agreement_templates.body -> sections.terms.
- Rich text stored as sanitized HTML; sanitized again on render (admin-authored but still sanitize).

## Phase 1 - Foundation
- [ ] lib/proposals/content.ts: types (Deliverables, ProposalContent, TemplateSections) + MANAGEMENT_DEFAULTS/PROJECT_DEFAULTS extracted verbatim from current copy
- [ ] schema.ts: proposals.deliverables, proposals.content, proposal_templates table
- [ ] Migration 0043 (additive/idempotent) + apply-0043 script; seed proposal_templates

## Phase 2 - Structured deliverables end-to-end
- [ ] Builder: build structured deliverables from selected package; POST it
- [ ] Create API: persist deliverables + snapshot content from active template
- [ ] Client render: deliverables line-by-line, grouped, counts row, balanced; fallback to serviceDescription
- [ ] PDF: render structured deliverables

## Phase 3 - Full inline editing on the live document
- [ ] Reusable RichText (Tiptap) modeled on email-editor.tsx
- [ ] PATCH whitelist: all draft-editable fields (deliverables, content, price, discount, dates, payment, deposit/split, cc/billing) validated
- [ ] Inline editors (draft only): deliverables (add/edit/remove/reorder dnd-kit), pricing/terms controls, rich-text copy, signature; autosave keepalive; Saved/Saving/Failed; Send locks

## Phase 4 - Settings > Proposal Templates
- [ ] API app/api/settings/proposal-templates/route.ts (GET both, PATCH one) requireAdmin
- [ ] Component components/settings/proposal-templates.tsx (Mgmt/Project switch, sectioned rich-text + live preview, save, restore-default)
- [ ] Wire tab into settings-tabs.tsx

## Phase 5 - Polish, harden, verify, deploy
- [ ] Polish (R10N, balanced, no layout jump); Harden (long/empty, 30+ lines, huge numbers, slow net, errors, sent/signed locked, RTL)
- [ ] tsc clean; verify; ONE deploy; Gate 5/6; memory update

## Review notes
(fill as work completes)
