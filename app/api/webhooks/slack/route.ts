import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { GoogleGenerativeAI, SchemaType, type FunctionDeclaration } from "@google/generative-ai";
import { db } from "@/lib/db";
import { slackSettings } from "@/lib/db/schema";
import { createHmac, timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Auth cache ────────────────────────────────────────────────────────────────
let _cachedSecret: string | null = null;
let _secretExp = 0;
async function getSigningSecret(): Promise<string | null> {
  if (_cachedSecret && Date.now() < _secretExp) return _cachedSecret;
  const rows = await db().select({ signingSecret: slackSettings.signingSecret }).from(slackSettings).limit(1);
  _cachedSecret = rows[0]?.signingSecret ?? null;
  _secretExp = Date.now() + 60_000;
  return _cachedSecret;
}

function verifySignature(secret: string, body: string, ts: string, sig: string): boolean {
  if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(ts, 10)) > 300) return false;
  const hmac = createHmac("sha256", secret);
  hmac.update(`v0:${ts}:${body}`);
  const computed = `v0=${hmac.digest("hex")}`;
  try { return timingSafeEqual(Buffer.from(computed), Buffer.from(sig)); } catch { return false; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function base() { return process.env.NEXT_PUBLIC_APP_URL ?? "https://kracked-sales.vercel.app"; }
function ih(): Record<string, string> { return { "x-internal-secret": process.env.CRON_SECRET ?? "" }; }
function ihJson(): Record<string, string> { return { ...ih(), "Content-Type": "application/json" }; }

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function lastMonth() {
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}
function currentWeekRange(): { since: string; until: string } {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun — use UTC to avoid server-timezone shifts
  const monOffset = (day + 6) % 7;
  const monMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - monOffset);
  const sunMs = monMs + 6 * 86_400_000;
  return {
    since: new Date(monMs).toISOString().slice(0, 10),
    until: new Date(sunMs).toISOString().slice(0, 10),
  };
}
function monthRange(month?: string): { since: string; until: string } {
  const m = month ?? currentMonth();
  const [y, mo] = m.split("-");
  const yr = parseInt(y), moNum = parseInt(mo);
  // Last day of month: day 0 of the next month, computed in UTC
  const lastDay = new Date(Date.UTC(yr, moNum, 0)).toISOString().slice(0, 10);
  return { since: `${y}-${mo}-01`, until: lastDay };
}

// ── Slack helpers ─────────────────────────────────────────────────────────────
async function slackPost(token: string, channel: string, text: string, threadTs?: string) {
  const body: Record<string, string> = { channel, text };
  if (threadTs) body.thread_ts = threadTs;
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) console.error("[Slack] postMessage error:", data.error);
}

async function getThreadHistory(token: string, channel: string, threadTs: string) {
  const res = await fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=30`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.ok || !data.messages) return [];
  const history = (data.messages as Array<{ bot_id?: string; text?: string }>)
    .slice(0, -1) // exclude current message
    .map(m => ({ role: (m.bot_id ? "model" : "user") as "user" | "model", text: m.text ?? "" }));

  // Gemini requires history to start with a 'user' turn.
  // Threads that begin with the bot's daily summary start with 'model' — drop those.
  const firstUserIdx = history.findIndex(m => m.role === "user");
  return firstUserIdx >= 0 ? history.slice(firstUserIdx) : [];
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS: FunctionDeclaration[] = [
  // ── READ ──
  {
    name: "get_pipelines",
    description: "Get all sales pipelines with their names, IDs, and stage names. Use this first whenever the user asks about leads, pipeline, or opportunities so you can offer them a choice of which pipeline.",
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: "get_pipeline_leads",
    description: "Get leads/opportunities in a specific pipeline, with a count per stage. Use this after the user has told you which pipeline they want to check. Supports date filtering — use since/until to get leads added in a specific date range (e.g. yesterday, last 7 days).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        pipelineId: { type: SchemaType.STRING, description: "The pipeline ID to query" },
        stageName:  { type: SchemaType.STRING, description: "Optional: filter by a specific stage name" },
        since:      { type: SchemaType.STRING, description: "Optional: only return leads created on or after this date (YYYY-MM-DD)" },
        until:      { type: SchemaType.STRING, description: "Optional: only return leads created on or before this date (YYYY-MM-DD)" },
      },
      required: ["pipelineId"],
    },
  },
  {
    name: "get_ad_spend",
    description: "Get Meta ad spend, CPL, and Meta form lead count for any date range. Note: the leads here are Meta form submissions only — for total leads (including comment/trigger-word leads) use get_kpis instead.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        since:  { type: SchemaType.STRING, description: "Start date YYYY-MM-DD (use for specific/custom ranges)" },
        until:  { type: SchemaType.STRING, description: "End date YYYY-MM-DD inclusive (use for specific/custom ranges)" },
        period: { type: SchemaType.STRING, description: "Shorthand: 'week' | 'month' | 'last_month' (ignored if since/until provided)" },
        month:  { type: SchemaType.STRING, description: "Specific month YYYY-MM (only with period=month)" },
      },
      required: [],
    },
  },
  {
    name: "get_calls_data",
    description: "Get booked calls and no-show counts for any date range. Prefer explicit since/until for specific dates.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        since:  { type: SchemaType.STRING, description: "Start date YYYY-MM-DD" },
        until:  { type: SchemaType.STRING, description: "End date YYYY-MM-DD inclusive" },
        period: { type: SchemaType.STRING, description: "Shorthand: 'week' | 'month' | 'last_month' (ignored if since/until provided)" },
        month:  { type: SchemaType.STRING, description: "Specific month YYYY-MM (only with period=month)" },
      },
      required: [],
    },
  },
  {
    name: "get_kpis",
    description: "Get all KPIs: cash collected, net profit, ad spend, ROAS, leads, deals closed, costs — including targets and overrides. Supports any date range via since/until, or shorthand period.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        since:  { type: SchemaType.STRING, description: "Start date YYYY-MM-DD (use for 'today', 'last 7 days', custom ranges)" },
        until:  { type: SchemaType.STRING, description: "End date YYYY-MM-DD inclusive" },
        period: { type: SchemaType.STRING, description: "Shorthand: 'month' | 'last_month' | 'week' | YYYY-MM (ignored if since/until provided)" },
      },
      required: [],
    },
  },
  {
    name: "get_demos_count",
    description: "Get the number of email demos created/started from ClickUp for a given period. Defaults to current month. Use period=last_month for last month.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        period: { type: SchemaType.STRING, description: "'month' | 'last_month' | 'week'" },
        month:  { type: SchemaType.STRING, description: "Specific month YYYY-MM (only with period=month)" },
      },
      required: [],
    },
  },
  {
    name: "get_tasks",
    description: "Get all open internal tasks.",
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: "get_followup_stats",
    description: "Get follow-up contact statistics: demos sent, response rates, conversions.",
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },

  // ── WRITE (always confirm before calling) ──
  {
    name: "create_demo",
    description: "Submit a new demo request to the system via the n8n webhook. Only call AFTER explicit user confirmation. Required: brandName, website, emailType, leadSource.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        brandName:     { type: SchemaType.STRING, description: "Brand or company name" },
        website:       { type: SchemaType.STRING, description: "Brand website URL" },
        emailType:     { type: SchemaType.STRING, description: "Welcome | Abandoned Cart | Browse Abandonment | Post-Purchase | Campaign | Product Release | Winback" },
        leadSource:    { type: SchemaType.STRING, description: "INSTAGRAM (MAIN ACCOUNT) | INSTAGRAM (BTS ACCOUNT) | GHL | LinkedIn | Manual | TikTok" },
        email:         { type: SchemaType.STRING, description: "Contact email (optional)" },
        phone:         { type: SchemaType.STRING, description: "Contact phone (optional)" },
        designNotes:   { type: SchemaType.STRING, description: "Design notes or brief (optional)" },
        contactMethod: { type: SchemaType.STRING, description: "Social Media | Email | Phone | WhatsApp (optional)" },
      },
      required: ["brandName", "website", "emailType", "leadSource"],
    },
  },
  {
    name: "add_no_show",
    description: "Record a no-show in the system. Only call AFTER explicit user confirmation.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        contactName: { type: SchemaType.STRING, description: "Name of the contact (optional)" },
        date:        { type: SchemaType.STRING, description: "YYYY-MM-DD, defaults to today" },
      },
      required: [],
    },
  },
  {
    name: "set_kpi",
    description: "Manually set a KPI value (override). Only call AFTER explicit user confirmation. Keys: cash-collected | ad-spend | processing-fees | ads-mgmt | software-cost | team-fulfillment | net-profit | deals-closed | new-mrr | audits-completed.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        metricKey: { type: SchemaType.STRING },
        value:     { type: SchemaType.NUMBER },
        period:    { type: SchemaType.STRING, description: "YYYY-MM, defaults to current month" },
      },
      required: ["metricKey", "value"],
    },
  },
  {
    name: "create_task",
    description: "Create a new internal task. Only call AFTER explicit user confirmation. Required: title.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title:       { type: SchemaType.STRING },
        notes:       { type: SchemaType.STRING, description: "Optional notes" },
        dueDate:     { type: SchemaType.STRING, description: "YYYY-MM-DD (optional)" },
        contactName: { type: SchemaType.STRING, description: "Related contact name (optional)" },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as complete. Only call AFTER explicit user confirmation.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        taskId: { type: SchemaType.STRING, description: "The task UUID" },
      },
      required: ["taskId"],
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────
async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const b = base();

  async function get(url: string) {
    const res = await fetch(`${b}${url}`, { headers: ih() });
    if (!res.ok) return { error: `GET ${url} failed (${res.status})` };
    return res.json();
  }
  async function post(url: string, body: unknown) {
    const res = await fetch(`${b}${url}`, { method: "POST", headers: ihJson(), body: JSON.stringify(body) });
    if (!res.ok) return { error: `POST ${url} failed (${res.status})` };
    return res.json();
  }

  function range(period?: string, month?: string, since?: string, until?: string): { since: string; until: string } {
    if (since && until) return { since, until };
    if (since) return { since, until: new Date().toISOString().slice(0, 10) };
    if (period === "week") return currentWeekRange();
    if (period === "last_month") return monthRange(lastMonth());
    if (month) return monthRange(month);
    return monthRange(currentMonth());
  }

  try {
    switch (name) {

      case "get_pipelines": {
        const data = await get("/api/ghl/pipelines") as { pipelines?: Array<{ id: string; name: string; stages?: Array<{ id: string; name: string }> }> };
        if ("error" in data) return data;
        return {
          pipelines: (data.pipelines ?? []).map(p => ({
            id: p.id,
            name: p.name,
            stages: (p.stages ?? []).map(s => ({ id: s.id, name: s.name })),
          })),
        };
      }

      case "get_pipeline_leads": {
        const pipelineId = args.pipelineId as string;
        const stageFilter = args.stageName as string | undefined;
        const sinceFilter = args.since as string | undefined;
        const untilFilter = args.until as string | undefined;
        let oppsUrl = `/api/ghl/opportunities?pipelineId=${encodeURIComponent(pipelineId)}`;
        if (sinceFilter) oppsUrl += `&since=${encodeURIComponent(sinceFilter)}`;
        if (untilFilter) oppsUrl += `&until=${encodeURIComponent(untilFilter)}`;
        const data = await get(oppsUrl) as { opportunities?: Array<{ name?: string; pipelineStageId_name?: string; status?: string; monetaryValue?: number; contactName?: string }> };
        if ("error" in data) return data;
        const opps = data.opportunities ?? [];
        // Group by stage
        const byStage: Record<string, number> = {};
        for (const o of opps) {
          const s = o.pipelineStageId_name ?? "Unknown";
          byStage[s] = (byStage[s] ?? 0) + 1;
        }
        const filtered = stageFilter
          ? opps.filter(o => o.pipelineStageId_name?.toLowerCase().includes(stageFilter.toLowerCase()))
          : opps;
        return {
          total: opps.length,
          byStage,
          leads: filtered.slice(0, 20).map(o => ({ name: o.name, contact: o.contactName, stage: o.pipelineStageId_name, value: o.monetaryValue })),
        };
      }

      case "get_ad_spend": {
        const { since, until } = range(args.period as string | undefined, args.month as string | undefined, args.since as string | undefined, args.until as string | undefined);
        const data = await get(`/api/meta/ads?since=${since}&until=${until}`);
        return data;
      }

      case "get_calls_data": {
        const { since, until } = range(args.period as string | undefined, args.month as string | undefined, args.since as string | undefined, args.until as string | undefined);
        const [booked, noShows] = await Promise.all([
          get(`/api/ghl/opportunities/booked-calls?since=${since}&until=${until}`) as Promise<{ count?: number }>,
          get(`/api/ghl/opportunities/no-show-calls?since=${since}&until=${until}`) as Promise<{ count?: number }>,
        ]);
        const b2 = (booked as { count?: number }).count ?? 0;
        const ns = (noShows as { count?: number }).count ?? 0;
        const showRate = b2 > 0 ? ((b2 - ns) / b2 * 100).toFixed(1) : "0";
        return { period: `${since} to ${until}`, bookedCalls: b2, noShows: ns, showRate: `${showRate}%` };
      }

      case "get_kpis": {
        const periodArg = args.period as string | undefined;
        const sinceArg = args.since as string | undefined;
        const untilArg = args.until as string | undefined;
        const p = periodArg === "last_month" ? lastMonth() : periodArg === "week" ? currentMonth() : (periodArg ?? currentMonth());
        const overrides = await get(`/api/kpi/overrides?period=${encodeURIComponent(p)}`) as { overrides?: Array<{ metricKey: string; value: number }> };
        const { since, until } = sinceArg ? { since: sinceArg, until: untilArg ?? new Date().toISOString().slice(0, 10) } : periodArg === "week" ? currentWeekRange() : monthRange(p);
        const [adData, booked, noShows, commentLeads] = await Promise.all([
          get(`/api/meta/ads?since=${since}&until=${until}`),
          get(`/api/ghl/opportunities/booked-calls?since=${since}&until=${until}`) as Promise<{ count?: number }>,
          get(`/api/ghl/opportunities/no-show-calls?since=${since}&until=${until}`) as Promise<{ count?: number }>,
          get(`/api/comment-leads/count?since=${since}&until=${until}`) as Promise<{ count?: number }>,
        ]);
        const ov = Object.fromEntries(((overrides as { overrides?: Array<{ metricKey: string; value: number }> }).overrides ?? []).map(o => [o.metricKey, o.value]));
        const adSpend = (adData as { spend?: number }).spend ?? ov["ad-spend"] ?? 0;
        const metaFormLeads = (adData as { leads?: number }).leads ?? 0;
        const commentLeadCount = (commentLeads as { count?: number }).count ?? 0;
        const totalLeads = metaFormLeads + commentLeadCount;
        const cash = ov["cash-collected"] ?? 0;
        const roas = adSpend > 0 ? (cash / adSpend).toFixed(2) : "—";
        const netProfit = cash - adSpend - (ov["processing-fees"] ?? 0) - (ov["ads-mgmt"] ?? 0) - (ov["software-cost"] ?? 0) - (ov["team-fulfillment"] ?? 0);
        return {
          period: p, periodRange: `${since} → ${until}`,
          cashCollected: ov["cash-collected"] ?? 0,
          adSpend, roas: `${roas}x`,
          processingFees: ov["processing-fees"] ?? 0,
          adsManagement: ov["ads-mgmt"] ?? 0,
          softwareCost: ov["software-cost"] ?? 0,
          teamFulfillment: ov["team-fulfillment"] ?? 0,
          netProfit,
          dealsClosed: ov["deals-closed"] ?? 0,
          newMRR: ov["new-mrr"] ?? 0,
          auditsCompleted: ov["audits-completed"] ?? 0,
          bookedCalls: (booked as { count?: number }).count ?? 0,
          noShows: (noShows as { count?: number }).count ?? 0,
          leadsTotal: totalLeads,
          leadsFromMetaForms: metaFormLeads,
          leadsFromComments: commentLeadCount,
          manualOverrides: ov,
        };
      }

      case "get_demos_count": {
        const { since, until } = range(args.period as string | undefined, args.month as string | undefined);
        return get(`/api/clickup/demos/count?since=${since}&until=${until}`);
      }
      case "get_tasks": return get("/api/tasks");
      case "get_followup_stats": return get("/api/analytics/followups");

      case "create_demo":
        return post("/api/webhooks/demo", {
          "Brand Name": args.brandName, "Website": args.website, "Email Type": args.emailType,
          "Lead Source": args.leadSource, "Email": args.email ?? "", "Phone": args.phone ?? "",
          "Email Design Notes": args.designNotes ?? "", "Preferred Contact Method": args.contactMethod ?? "",
        });

      case "add_no_show":
        return post("/api/ghl/opportunities/no-show-calls", { contactName: args.contactName, date: args.date });

      case "set_kpi":
        return post("/api/kpi/overrides", { metricKey: args.metricKey, period: args.period ?? currentMonth(), value: args.value });

      case "create_task":
        return post("/api/tasks", { title: args.title, notes: args.notes, dueDate: args.dueDate, contactName: args.contactName });

      case "complete_task": {
        const res = await fetch(`${b}/api/tasks/${args.taskId}`, { method: "PATCH", headers: ihJson(), body: JSON.stringify({ completed: true }) });
        return res.ok ? { ok: true } : { error: "Failed to complete task" };
      }

      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`[Slack agent] Tool ${name} threw:`, err);
    return { error: `${name} threw an exception` };
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(): string {
  const today = new Date();
  // All dates expressed in CST (UTC-6) — Jack's working timezone
  const cstOffset = -6 * 60;
  const cstNow = new Date(today.getTime() + (cstOffset - today.getTimezoneOffset()) * 60_000);
  const todayCST = cstNow.toISOString().slice(0, 10);
  const yesterdayCST = new Date(cstNow.getTime() - 86_400_000).toISOString().slice(0, 10);
  const dateStr = cstNow.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const thisMonth = cstNow.toLocaleString("en-GB", { month: "long", year: "numeric" });
  const lastMonthStr = new Date(cstNow.getFullYear(), cstNow.getMonth() - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });

  return `You are the Kracked Sales AI — a smart, helpful assistant built into Slack for the Kracked Sales team. You have full access to every part of the system.

Today is ${dateStr} (CST). Today's date: ${todayCST}. Yesterday's date: ${yesterdayCST}. Current month: ${thisMonth}. Last month: ${lastMonthStr}.
The user is in Central Standard Time (CST, UTC-6). Always use these exact date strings when the user says "today" or "yesterday".

PERSONALITY & TONE:
- Talk like a knowledgeable colleague, not a chatbot. Short, natural sentences. No bullet points, no markdown, no asterisks, no numbered lists unless explicitly listing options for the user to choose from.
- When you give numbers, give context. Don't just say "38 booked calls" — say something like "you've had 38 booked calls this month, which is 127% of your 30-call target."
- Be warm but efficient. Don't pad with filler like "Great question!" or "Certainly!".

GATHERING INFORMATION:
- When a user wants to do something that needs multiple pieces of information, ask for one piece at a time. Never dump all required fields at once.
- If they've already given you some info in their message, skip those questions entirely.
- Example flow for a new demo: if they say "new demo for Nike", you already have the brand name — next ask for the website, then email type, then lead source. Don't ask for brand name again.
- For pipeline queries, first call get_pipelines to see what pipelines exist, then offer them the options clearly (just names, no IDs) and ask which one they want.

DATE RANGES — YOU CAN QUERY ANY DATE RANGE:
- "This week" → ALWAYS use period="week". Never self-compute the week dates — the tool handles it correctly.
- "This month" → use period="month"
- "Last month" → use period="last_month"
- "Today" → since=today's YYYY-MM-DD, until=today's YYYY-MM-DD
- "Yesterday" → since=yesterday's date, until=yesterday's date (pass both to get_pipeline_leads too)
- "New leads from yesterday / today / last X days" → always pass since/until to get_pipeline_leads so it filters by creation date
- "Last 7 days" → since=7 days ago, until=today (use explicit since/until, NOT period="week")
- "April 1-15" or any custom range → use explicit since/until in YYYY-MM-DD format
- For "this week" and "this month" always use the period shorthand — never compute the dates yourself.

BEFORE ANY WRITE ACTION:
- Always summarise exactly what you're about to do and ask the user to confirm before calling any write tool (create_demo, add_no_show, set_kpi, create_task, complete_task).
- Example: "Right, so I'll add a no-show for today — that'll bring your April total to 8. Shall I go ahead?"
- Only call the write tool after they say yes, confirm, or equivalent in the thread.

CALCULATIONS YOU KNOW HOW TO DO:
- ROAS = Cash Collected ÷ Ad Spend
- Net Profit = Cash Collected − Ad Spend − Processing Fees − Ads Management − Software Cost − Team Fulfillment
- Show-up Rate = (Booked Calls − No Shows) ÷ Booked Calls × 100
- For "what should our ROAS be next month" — use current ROAS and trends to give a realistic target, not just a guess.

DATA SOURCES:
- Ad spend, ROAS, CPL: live from Meta Ads API
- Booked calls: live from GHL calendar
- No-shows: tracked in our pipeline stage events
- All other KPIs (cash collected, costs, etc.): manual overrides stored per period
- Pipeline leads: live from GHL
- Demos: ClickUp

NEVER say "I don't have access to that" — you have tools for everything. If a tool returns an error, tell the user briefly and offer to try again.`;
}

// ── AI core ───────────────────────────────────────────────────────────────────
async function processMessage(
  text: string,
  channelId: string,
  threadTs: string | undefined,
  botToken: string,
  botUserId: string,
  preloadedHistory?: Array<{ role: "user" | "model"; text: string }>,
) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY environment variable is not set");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: buildSystemPrompt(),
    tools: [{ functionDeclarations: TOOLS }],
    generationConfig: { temperature: 0.7 },
  });

  // Reuse preloaded history (fetched at gate check) to avoid a second Slack API call
  const history = preloadedHistory ?? (threadTs ? await getThreadHistory(botToken, channelId, threadTs) : []);
  const chat = model.startChat({
    history: history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
  });

  type GeminiContent = string | Array<{ functionResponse: { name: string; response: unknown } }>;
  let msg: GeminiContent = text;
  let reply = "";

  for (let i = 0; i < 8; i++) {
    const result = await chat.sendMessage(msg as string);
    const parts = result.response.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter(p => p.functionCall);

    if (!calls.length) { reply = result.response.text(); break; }

    const responses = await Promise.all(
      calls.map(async p => ({
        functionResponse: { name: p.functionCall!.name, response: await runTool(p.functionCall!.name, (p.functionCall!.args ?? {}) as Record<string, unknown>) },
      }))
    );
    msg = responses as GeminiContent;
  }

  if (!reply) reply = "Something went wrong on my end — give it another go.";

  // Strip any markdown that slipped through
  reply = reply.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1");

  await slackPost(botToken, channelId, reply, threadTs);
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Ignore Slack retries — the original request is still processing via waitUntil.
  // Without this, slow DB/AI responses cause Slack to retry and the bot double-replies.
  if (req.headers.get("x-slack-retry-num")) return NextResponse.json({ ok: true });

  const rawBody = await req.text();
  const ts  = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }

  if (body.type === "url_verification") return NextResponse.json({ challenge: body.challenge });

  // Verify signature using cached secret (in-memory, no DB call)
  const secret = await getSigningSecret();
  if (!secret || !verifySignature(secret, rawBody, ts, sig)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Quick event-type filter — no DB needed
  const event = body.event as Record<string, unknown> | undefined;
  if (!event || (event.type !== "message" && event.type !== "app_mention")) return NextResponse.json({ ok: true });
  if (event.bot_id || event.subtype === "bot_message") return NextResponse.json({ ok: true });

  const text = ((event.text as string) ?? "").trim();
  if (!text) return NextResponse.json({ ok: true });

  // Return 200 to Slack immediately — all remaining work (DB, AI) runs in the background.
  // This ensures we always respond within Slack's 3-second window.
  waitUntil(
    (async () => {
      let _botToken: string | undefined;
      let _channelId: string | undefined;
      let _threadTs: string | undefined;
      try {
        _channelId = event.channel as string;
        _threadTs  = (event.thread_ts ?? event.ts) as string | undefined;

        const rows = await db()
          .select({ botToken: slackSettings.botToken, channelId: slackSettings.channelId, enabled: slackSettings.enabled, botUserId: slackSettings.botUserId })
          .from(slackSettings).limit(1);
        const settings = rows[0];

        // Log why we're bailing out — helps diagnose silent failures
        if (!settings?.enabled) { console.warn("[Slack agent] bot not enabled"); return; }
        if (!settings.botToken) { console.warn("[Slack agent] no bot token"); return; }
        if (settings.channelId !== _channelId) {
          console.warn(`[Slack agent] channel mismatch: got=${_channelId} expected=${settings.channelId}`);
          return;
        }

        _botToken = settings.botToken;
        const botUserId = settings.botUserId ?? "";
        const mentionRe = botUserId ? new RegExp(`<@${botUserId}>`) : null;
        const hasMention = mentionRe ? mentionRe.test(text) : true;

        // Is this a reply inside a thread (not the root message)?
        const isThreadReply = !!(event.thread_ts && event.thread_ts !== event.ts);

        let preloadedHistory: Array<{ role: "user" | "model"; text: string }> | undefined;

        if (!hasMention) {
          // No @mention — only respond if this is a thread reply where the bot has already participated
          if (!isThreadReply) return;
          const history = await getThreadHistory(settings.botToken, _channelId, event.thread_ts as string);
          if (!history.some(m => m.role === "model")) return;
          preloadedHistory = history; // reuse in processMessage — no second fetch needed
        }

        const cleaned = text.replace(new RegExp(`<@${botUserId}>\\s*`, "g"), "").trim();
        if (!cleaned) return;

        await processMessage(cleaned, _channelId, _threadTs, settings.botToken, botUserId, preloadedHistory);
      } catch (err) {
        console.error("[Slack agent] error:", err);
        // Notify the user in Slack so failures aren't invisible
        if (_botToken && _channelId) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await slackPost(_botToken, _channelId, `Hit an error: ${errMsg}`, _threadTs).catch(() => {});
        }
      }
    })()
  );

  return NextResponse.json({ ok: true });
}
