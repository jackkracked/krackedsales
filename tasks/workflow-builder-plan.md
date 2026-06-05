# Workflow Builder — Meticulous Implementation Plan

> Status: PLANNING — do not touch code until Jack approves this document.

---

## 1. What We're Building

A fully custom, production-grade visual workflow automation builder embedded inside the Kracked Sales System. Think N8N — but faster, more opinionated, and far more beautiful. It lives at `/workflows` and lets Gage's team build automations that connect every part of the system (proposals, GHL, Slack, email, SMS, HTTP) using a drag-and-drop infinity canvas.

**Non-goals (for now):** We are not building a marketplace, external integrations (Zapier, Airtable, Salesforce), or multi-tenancy. Everything serves one agency, one team.

---

## 2. Technical Decisions

### Canvas Library
**@xyflow/react v12** — already installed. This is what N8N uses under the hood. Supports infinite canvas, custom nodes, custom edges, TypeScript, minimap, controls. No install needed.

### State Management  
**Zustand v5** — already installed. We'll use a single canvas store for nodes/edges/selection/viewport, separate from server state (TanStack Query for workflow list/runs).

### Auto-layout
**@dagrejs/dagre** — already installed. Powers the "auto-arrange" button so nodes lay themselves out in a clean top-down DAG.

### Code editor (for Code nodes)
**Monaco Editor** — will install `@monaco-editor/react`. Lightweight, same editor as VS Code.

### Execution
Server-side, invoked by event hooks already in the codebase (Stripe webhook, GHL webhook, proposal routes). A workflow run is a server-side async function that walks the node graph and executes each action sequentially. No external queue needed — Vercel functions with a 300s timeout handle everything.

---

## 3. Database Schema (4 new tables)

```sql
-- The workflow definition (nodes + edges stored as JSON)
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  nodes JSONB NOT NULL DEFAULT '[]',   -- ReactFlow node objects (id, type, data, position)
  edges JSONB NOT NULL DEFAULT '[]',   -- ReactFlow edge objects (id, source, target, sourceHandle, targetHandle)
  viewport JSONB,                       -- { x, y, zoom } — saved canvas position
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- One row per workflow execution
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_event TEXT NOT NULL,   -- "proposal.paid", "opportunity.created", "webhook", etc.
  trigger_data JSONB,            -- The full event payload that started the run
  status TEXT NOT NULL DEFAULT 'running',  -- "running" | "success" | "error" | "partial"
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  error TEXT                     -- top-level error if the run itself crashed
);

-- One row per node execution within a run
CREATE TABLE workflow_run_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,         -- ReactFlow node id
  node_type TEXT NOT NULL,       -- "trigger.proposal.paid", "action.send_email", etc.
  node_name TEXT,                -- User-given name ("Send welcome email")
  status TEXT NOT NULL,          -- "success" | "error" | "skipped"
  input_data JSONB,              -- What was passed into this node
  output_data JSONB,             -- What this node produced
  error TEXT,
  duration_ms INTEGER,
  executed_at TIMESTAMP DEFAULT NOW()
);

-- Webhook trigger registrations (for trigger.webhook nodes)
CREATE TABLE workflow_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,         -- Which trigger node this belongs to
  slug TEXT NOT NULL UNIQUE,     -- URL-safe slug: /api/workflows/webhook/[slug]
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 4. Complete Node Catalog

### TRIGGERS (what starts a workflow)

| Node Type | Event | Data Available |
|---|---|---|
| `trigger.proposal.paid` | Stripe invoice paid | proposal, contactName, amount, currency, createdBy user |
| `trigger.proposal.signed` | Client signs agreement | proposal, contactName, signedAt, signatureData |
| `trigger.proposal.sent` | Proposal marked sent | proposal, contactName, contactEmail, amount |
| `trigger.proposal.created` | New proposal created in DB | proposal, contactName, type, amount |
| `trigger.opportunity.created` | GHL OpportunityCreate webhook | contactName, pipelineStageName, monetaryValue, contactId |
| `trigger.opportunity.stage_changed` | GHL OpportunityStageUpdate | contactName, newStage, oldStage, contactId |
| `trigger.opportunity.won` | GHL opportunity marked "won" | contactName, contactId, monetaryValue |
| `trigger.webhook` | Custom HTTP POST to a generated URL | Full request body (any shape) |
| `trigger.schedule` | Cron expression | runAt timestamp |

Multiple trigger nodes in a single workflow are supported — each is an independent entry point that shares the same action graph downstream.

---

### ACTIONS (what a workflow does)

**Communication**

| Node Type | What it does | Config fields |
|---|---|---|
| `action.send_email` | Sends via Resend | to, subject, body (HTML or markdown), from name, reply-to |
| `action.send_sms` | Sends via GHL conversation API | contactId (from trigger data), message body |
| `action.slack_message` | POST to a Slack incoming webhook URL | webhook URL, message (supports variables) |
| `action.http_request` | Arbitrary HTTP call | method, URL, headers (key/value), body, timeout |

**Data / Control**

| Node Type | What it does | Config fields |
|---|---|---|
| `action.create_task` | Creates task in internal DB | title, notes, priority, dueDate, assign to (userId) |
| `action.set` | Define/transform variables for downstream nodes | key/value pairs with expression support |
| `action.wait` | Pause execution N seconds | duration (seconds, max 240 to fit within Vercel timeout) |
| `action.code` | Run arbitrary JS (sandboxed via `vm2` or `Function()`) | code editor (Monaco), input variables available as `$input`) |

**Control Flow**

| Node Type | What it does | Config fields |
|---|---|---|
| `control.if` | Branch on a condition | condition expression (e.g. `{{trigger.amount}} > 1000`), true handle → next node, false handle → different node |
| `control.switch` | Multi-way branch | field to switch on, case values + output handles |

**System**

| Node Type | What it does | Config fields |
|---|---|---|
| `action.ghl_update_opportunity` | Move opp to a different pipeline stage | contactId, pipelineId, stageId |
| `action.ghl_add_note` | Add a note to a GHL contact | contactId, note body (supports variables) |
| `action.http_response` | Return HTTP response (only valid in webhook-triggered workflows) | status code, body |

**Deferred (require additional setup — documented, available but flagged)**

| Node Type | Requires |
|---|---|
| `action.slack_create_channel` | Slack OAuth bot token with `channels:write` scope |
| `action.send_sms` (fully featured) | GHL location SMS number configured |

---

## 5. Variable System

Every node output is stored in the run context. Variables are referenced as:

```
{{trigger.contactName}}
{{trigger.amount}}
{{set_node_1.myVar}}
{{http_request_1.body.id}}
```

**Drag-and-drop**: In the node configuration panel, the right side shows a live "Output" tree of the previous node's data. Each field has a pill chip. Dragging a chip into a text field inserts `{{node_name.field.path}}`. When a value is already typed into the field, a small preview tooltip renders the interpolated result using the last run's data (or mock data on first use).

**Expression evaluation**: Simple dot-path access for variables. The `action.if` node supports comparisons (`==`, `!=`, `>`, `<`, `contains`, `exists`).

---

## 6. UI Architecture

### Pages

```
/workflows                  — List view: all workflows, status, last run, run count, enable toggle
/workflows/new              — Name + description modal → redirects to /workflows/[id]
/workflows/[id]             — The canvas editor (full screen, no sidebar)
/workflows/[id]/runs        — Run history: list of executions with status
/workflows/[id]/runs/[rid]  — Run detail: each node's input/output, timing, errors
```

### Canvas Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [← Back]  Workflow Name (editable inline)   [Enabled ○]  [Save] [Run] │  ← Top bar
├──────┬──────────────────────────────────────────────────────┤
│      │                                                      │
│ Node │           Infinite Canvas (ReactFlow)                │  ← Canvas fills screen
│ Menu │                                                      │
│      │   [Trigger] ──→ [Action] ──→ [If] ──→ [Action]      │
│ (L)  │                              └──→ [Action]           │
│      │                                                      │
└──────┴───────────────────┬──────────────────────────────────┘
                           │
                  ┌────────┴────────┐
                  │  Node Panel (R) │  ← slides in when node selected
                  │  Input | Output │
                  └─────────────────┘
```

### Node Panel (right slide-in)

When a node is clicked, a 420px panel slides in from the right:
- **Left half**: Input — shows the data that flowed INTO this node (from the upstream node or trigger)
- **Right half**: Output — shows what this node produced on its last run (or a schema preview if never run)
- **Config section** (middle): The node's editable fields — shown between the input/output panes

All field inputs support `{{variable}}` syntax. When you start typing `{{`, an autocomplete dropdown appears with all available upstream variables.

### Node Library (left panel)

A 260px collapsible left panel. Sections:
- Triggers (purple)
- Actions — Communication (blue)
- Actions — Data (green)
- Control Flow (amber)
- System (grey)

Click to add a node to the canvas at center, or drag onto the canvas. Can be dismissed to maximize canvas space.

### Canvas Interactions

**Connections**:
- Draw connections by dragging from a node's output handle to another's input handle
- Hover over a connection line → a small trash icon appears mid-line → click to delete the edge (not the nodes)
- `control.if` nodes have two output handles: ✓ True and ✗ False (color coded green/red)

**Between-node insertion**:
- Hover over any edge → a `+` button appears at the midpoint → click to open the node-type picker → selecting a type inserts a new node and rewires the edge automatically

**Minimap**: Bottom right. Styled to match the dark canvas, not the ugly white default.

**Canvas controls**: Zoom in/out, fit to view, auto-layout (runs Dagre to arrange nodes in a top-down graph).

### Node Visual Design

Each node is a compact card (~240px wide):

```
┌──────────────────────────┐  ← coloured top border (purple=trigger, blue=action, amber=control)
│ ⚡ Trigger: Proposal Paid │  ← icon + type label (small, muted)
│                          │
│  "When a proposal is..." │  ← user-given name (editable inline, click to edit)
│                          │
│                     ○──→ │  ← output handle (right)
└──────────────────────────┘
```

Action nodes:
```
  ←──○                      ← input handle (left)
┌──────────────────────────┐
│ ✉ Action: Send Email     │
│  "Send welcome email"    │
│                     ○──→ │
└──────────────────────────┘
```

If nodes:
```
  ←──○
┌──────────────────────────┐
│ ⑂ If: Amount > $1,000    │
│  Condition branch        │
│              ✓ True ○──→ │
│             ✗ False ○──→ │
└──────────────────────────┘
```

**Status indicators on nodes** (shown during/after a run):
- Grey ring = not yet run
- Spinning ring = currently executing
- Green check = success
- Red X = error

---

## 7. Execution Engine

```
/lib/workflows/executor.ts
```

The executor is a pure TypeScript module (no framework dependencies). It:

1. Loads the workflow definition from DB
2. Builds an adjacency map from edges
3. Finds all trigger nodes that match the current event
4. Creates a `workflow_runs` record
5. Performs a breadth-first walk starting from matched trigger nodes
6. For each node, calls the appropriate handler from `/lib/workflows/nodes/[type].ts`
7. Each handler receives `{ config, input, context }` and returns `{ output }`
8. Output is merged into `context` under the node's id key
9. Variables in config strings are interpolated just before execution
10. Logs each node to `workflow_run_logs` with timing
11. On `control.if` nodes: evaluates the condition, follows only the matching handle's edges
12. Updates `workflow_runs.status` and `completed_at` when done

**Error handling**: If a node throws, the run logs the error, marks that node "error", and stops processing that branch. Other parallel branches continue. The run status becomes "partial" if some branches succeeded.

**Trigger registration**: Each trigger type registers itself in a central map:

```typescript
// lib/workflows/triggers.ts
export async function dispatchWorkflowEvent(
  event: string,    // "proposal.paid"
  data: Record<string, unknown>
) {
  const workflows = await db().select().from(workflowsTable)
    .where(eq(workflowsTable.enabled, true));
  
  for (const workflow of workflows) {
    const triggerNodes = workflow.nodes.filter(n => n.data.triggerEvent === event);
    if (triggerNodes.length > 0) {
      executeWorkflow(workflow, triggerNodes, data).catch(console.error); // fire-and-forget
    }
  }
}
```

Then in the Stripe webhook, GHL webhook, proposal send route, etc. — one line:
```typescript
dispatchWorkflowEvent("proposal.paid", { proposal, contactName, amount });
```

---

## 8. Implementation Phases

### Phase 1 — Data Model & API Layer (Day 1)
- [ ] Write Drizzle schema additions (4 new tables)
- [ ] Generate and run migration
- [ ] `GET/POST /api/workflows` — list + create
- [ ] `GET/PATCH/DELETE /api/workflows/[id]` — fetch, save canvas state, delete
- [ ] `GET /api/workflows/[id]/runs` — run history
- [ ] `GET /api/workflows/[id]/runs/[rid]` — run detail with node logs
- [ ] `POST /api/workflows/webhook/[slug]` — custom webhook trigger endpoint

### Phase 2 — Execution Engine (Day 1–2)
- [ ] `lib/workflows/executor.ts` — walk engine
- [ ] `lib/workflows/triggers.ts` — dispatchWorkflowEvent + registration
- [ ] Node handlers: trigger types (these just return their input as output)
- [ ] Node handlers: action.send_email, action.send_sms, action.slack_message
- [ ] Node handlers: action.create_task, action.set, action.wait
- [ ] Node handlers: action.http_request
- [ ] Node handlers: control.if (condition evaluation)
- [ ] Node handlers: action.ghl_update_opportunity, action.ghl_add_note
- [ ] Node handlers: action.code (sandboxed JS via `new Function()`)
- [ ] Wire dispatchWorkflowEvent into: Stripe webhook (paid/signed events), GHL webhook (OpportunityCreate/Won), proposal send route, proposal sign route
- [ ] Test each node handler with unit-level tests (via direct function calls)

### Phase 3 — Canvas UI Foundation (Day 2–3)
- [ ] `/app/(app)/workflows/page.tsx` — list page with status, last run, enable toggle
- [ ] `/app/(app)/workflows/[id]/page.tsx` — canvas wrapper (force full-screen, no app sidebar)
- [ ] `components/workflows/canvas/WorkflowCanvas.tsx` — ReactFlow setup with custom controls, minimap, background grid
- [ ] Custom node components: TriggerNode, ActionNode, IfNode, CodeNode, SetNode
- [ ] Custom edge component with hover-to-delete trash icon
- [ ] Between-edge `+` insert button on hover
- [ ] Node library left panel (collapsible, grouped by type)
- [ ] Top bar: name (inline edit), enabled toggle, Save, Run Now buttons
- [ ] Zustand store for canvas state (nodes, edges, selected node, dirty flag)

### Phase 4 — Node Configuration Panels (Day 3–4)
- [ ] Right slide-in panel with Input / Config / Output tabs
- [ ] Config forms for every node type (React Hook Form)
- [ ] `{{variable}}` autocomplete in text fields (show upstream variable tree)
- [ ] Monaco editor for Code nodes
- [ ] Key/value editor for Set and HTTP header nodes
- [ ] Handle selector for If branches

### Phase 5 — Variable Drag & Drop (Day 4)
- [ ] Output panel renders a collapsible tree of the last run's output (or a schema if no runs yet)
- [ ] Each leaf value renders as a draggable chip
- [ ] Drop into any text field inserts `{{node_id.field.path}}`
- [ ] Live interpolation preview tooltip on fields containing variables

### Phase 6 — Run History & Debug UI (Day 4–5)
- [ ] `/workflows/[id]/runs` — table of runs (status, trigger event, duration, started at)
- [ ] `/workflows/[id]/runs/[rid]` — the run replay: same canvas but nodes show their status (green/red/skipped), click a node to see its logged input/output
- [ ] Toast notification on "Run Now" with link to the run once complete

### Phase 7 — Polish (Day 5)
- [ ] Keyboard shortcuts: Cmd+S to save, Delete to remove selected node/edge, Cmd+Z undo
- [ ] Auto-layout button (Dagre)
- [ ] Node search in library (type to filter)
- [ ] Duplicate node
- [ ] Drag-to-select multiple nodes
- [ ] Connection validation (can't connect trigger output to trigger input, etc.)
- [ ] Empty state on /workflows page
- [ ] Mobile graceful degradation (canvas shows "use desktop" message, list page works fine)

---

## 9. What Needs Additional Setup (honest)

| Feature | Blocker | Resolution |
|---|---|---|
| `action.slack_create_channel` | Needs Slack bot token with `channels:write` — currently only have incoming webhook URL | Add Slack OAuth app, store `SLACK_BOT_TOKEN` env var |
| `action.send_sms` | GHL SMS available via `/conversations/{id}/messages` but requires a valid GHL phone number to send from | Configure GHL SMS number in settings |
| `trigger.schedule` | Needs cron registration — Vercel cron is static (defined in vercel.json) | Implement as a polling cron that checks enabled schedule workflows every minute |

These nodes will be visible in the builder but show a "Setup required" badge if their env/config is missing, and skip gracefully at execution time with a logged warning rather than crashing the run.

---

## 10. Questions for Jack Before Building

1. **Slack channels**: Do you want to add a Slack OAuth bot (lets us create channels programmatically) now, or just ship `slack_message` (posting to an existing webhook) first and add channel creation later?

2. **Code nodes**: Should JS code run server-side (on Vercel, limited to ~50ms before you should use wait) or is that fine?

3. **The canvas layout**: Should workflows open in a full-screen mode (hiding the app sidebar entirely) like N8N does? Or keep the sidebar? My recommendation is full-screen.

4. **"Run Now"**: When you manually trigger a workflow, do you pick which trigger to fire (if there are multiple), or does it always use mock/empty data?

5. **Who can build workflows?** Admin only, or should reps be able to view/create?

---

## 11. File Structure

```
app/(app)/workflows/
  page.tsx                        — list
  [id]/
    page.tsx                      — canvas (full screen)
    runs/
      page.tsx                    — run history
      [runId]/page.tsx            — run detail

app/api/workflows/
  route.ts                        — GET list, POST create
  [id]/route.ts                   — GET, PATCH, DELETE
  [id]/run/route.ts               — POST trigger manual run
  [id]/runs/route.ts              — GET run history
  [id]/runs/[runId]/route.ts      — GET run detail
  webhook/[slug]/route.ts         — POST custom webhook trigger

lib/workflows/
  executor.ts                     — main walk engine
  triggers.ts                     — dispatchWorkflowEvent
  interpolate.ts                  — {{variable}} resolution
  nodes/
    trigger.ts                    — all trigger node handlers
    action-email.ts
    action-sms.ts
    action-slack.ts
    action-http.ts
    action-task.ts
    action-ghl.ts
    action-set.ts
    action-code.ts
    action-wait.ts
    control-if.ts
    control-switch.ts

components/workflows/
  canvas/
    WorkflowCanvas.tsx
    WorkflowTopBar.tsx
    NodeLibrary.tsx
    NodePanel.tsx
    VariableTree.tsx
    nodes/
      TriggerNode.tsx
      ActionNode.tsx
      IfNode.tsx
      CodeNode.tsx
      SetNode.tsx
    edges/
      WorkflowEdge.tsx            — with hover-delete + midpoint insert
  list/
    WorkflowList.tsx
    WorkflowCard.tsx
  runs/
    RunHistory.tsx
    RunDetail.tsx

lib/db/schema.ts                  — 4 new tables added here
```

---

*Total estimated scope: 5 focused engineering days for a fully working, polished v1. The hardest parts are the execution engine (Phase 2) and the variable drag-and-drop (Phase 5). The canvas foundation (Phase 3) is actually the fastest because @xyflow/react does most of the heavy lifting.*

*Ready to begin Phase 1 on Jack's approval.*
