import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { GoogleGenerativeAI, SchemaType, type Tool, type Part } from "@google/generative-ai";
import { ghl, locationId } from "@/lib/ghl/client";
import { fetchAllOpportunities } from "@/lib/ghl/paginate";
import { clickup, demoListId } from "@/lib/clickup/client";
import { mapStageToBucket } from "@/lib/utils/demo-stage";
import type { ClickUpTasksResponse } from "@/lib/clickup/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Helpers ────────────────────────────────────────────────────────────────────

function normaliseDomain(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function extractSearchTerms(query: string): string[] {
  const terms = new Set<string>();
  terms.add(query.trim());

  // If it looks like a URL, extract domain and brand name
  if (query.includes("://") || query.includes(".com") || query.includes(".co") || query.includes(".io")) {
    const domain = normaliseDomain(query);
    terms.add(domain);
    // Also add just the brand part (before the TLD)
    const brand = domain.split(".")[0];
    if (brand && brand.length > 1) terms.add(brand);
  }

  return [...terms].filter(Boolean);
}

type GHLContactRaw = {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  tags?: string[];
  source?: string;
  website?: string;
};

function formatContact(c: GHLContactRaw) {
  return {
    id: c.id,
    name: (c.fullName ?? [c.firstName, c.lastName].filter(Boolean).join(" ")) || "Unknown",
    email: c.email ?? null,
    phone: c.phone ?? null,
    company: c.companyName ?? null,
    tags: c.tags ?? [],
    source: c.source ?? null,
    website: c.website ?? null,
    url: `/contacts/${c.id}`,
  };
}

// ── Tool implementations ───────────────────────────────────────────────────────

async function searchContacts(query: string) {
  try {
    const terms = extractSearchTerms(query);
    const seen = new Set<string>();
    const results: ReturnType<typeof formatContact>[] = [];

    // Try each term — stop early if we get hits
    for (const term of terms) {
      const data = await ghl.get<{ contacts: GHLContactRaw[] }>(
        `/contacts/?locationId=${locationId()}&query=${encodeURIComponent(term)}&limit=10`
      );
      for (const c of data.contacts ?? []) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          results.push(formatContact(c));
        }
      }
      if (results.length >= 3) break;
    }

    if (results.length > 0) return { found: results.length, contacts: results, searched: terms };

    // No contacts found — automatically fall back to conversation search
    // Use the most specific term (brand name if extracted, otherwise full query)
    const fallbackTerm = terms[terms.length - 1] ?? query;
    const convos = await searchConversations(fallbackTerm);
    if ("conversations" in convos && convos.found > 0) {
      return {
        found: 0,
        contacts: [],
        searched: terms,
        conversationFallback: convos,
      };
    }

    return { found: 0, contacts: [], searched: terms };
  } catch {
    return { found: 0, error: "Could not search contacts" };
  }
}

async function searchConversations(query: string, channelType?: string) {
  try {
    const CHANNEL_MAP: Record<string, string> = {
      instagram: "TYPE_INSTAGRAM",
      messenger: "TYPE_FB",
      facebook: "TYPE_FB",
      fb: "TYPE_FB",
      sms: "TYPE_SMS",
      email: "TYPE_EMAIL",
      whatsapp: "TYPE_WHATSAPP",
      tiktok: "TYPE_TIKTOK",
    };

    const params = new URLSearchParams({
      locationId: locationId(),
      limit: "10",
      sortBy: "last_message_date",
      sortOrder: "desc",
    });

    if (query) params.set("query", query);

    // Map plain-English channel names to GHL type codes
    const resolvedType = channelType
      ? (CHANNEL_MAP[channelType.toLowerCase()] ?? channelType)
      : null;
    if (resolvedType) params.set("type", resolvedType);

    const data = await ghl.get<{
      conversations: Array<{
        id: string;
        contactId: string;
        contactName?: string;
        lastMessageBody?: string;
        lastMessageDate?: string;
        type?: string;
        unreadCount?: number;
      }>;
    }>(`/conversations/search?${params.toString()}`);

    const convos = data.conversations ?? [];
    if (convos.length === 0) return { found: 0, conversations: [] };

    return {
      found: convos.length,
      conversations: convos.map((c) => ({
        contactId: c.contactId,
        contactName: c.contactName ?? "Unknown",
        channel: c.type ?? "unknown",
        lastMessage: c.lastMessageBody ?? "",
        date: c.lastMessageDate ?? null,
        url: `/inbox?contact=${c.contactId}`,
      })),
    };
  } catch {
    return { found: 0, error: "Could not search conversations" };
  }
}

async function getPipeline() {
  try {
    const pipelinesData = await ghl.get<{
      pipelines: Array<{ id: string; name: string; stages?: Array<{ id: string; name: string }> }>;
    }>(`/opportunities/pipelines?locationId=${locationId()}`);
    const pipelines = pipelinesData.pipelines ?? [];
    if (pipelines.length === 0) return { pipelines: [] };

    const results = await Promise.all(
      pipelines.slice(0, 3).map(async (p) => {
        try {
          const opps = await fetchAllOpportunities(
            `/opportunities/search?location_id=${locationId()}&pipeline_id=${p.id}`,
          );
          const open = opps.filter((o) => o.status === "open");
          const stageCounts = new Map<string, number>();
          let totalValue = 0;
          for (const o of open) {
            stageCounts.set(o.pipelineStageId, (stageCounts.get(o.pipelineStageId) ?? 0) + 1);
            totalValue += o.monetaryValue ?? 0;
          }
          const stages = (p.stages ?? [])
            .filter((s) => stageCounts.has(s.id))
            .map((s) => ({ name: s.name, count: stageCounts.get(s.id)! }));
          return { name: p.name, openDeals: open.length, totalValue, stages };
        } catch {
          return { name: p.name, openDeals: 0, totalValue: 0, stages: [] };
        }
      })
    );
    return { pipelines: results };
  } catch {
    return { pipelines: [], error: "Could not fetch pipeline" };
  }
}

async function getDemoTracker() {
  try {
    const listId = demoListId();
    const data = await clickup.get<ClickUpTasksResponse>(
      `/list/${listId}/task?include_closed=false&subtasks=false&order_by=created&reverse=true&page=0`
    );
    const tasks = (data.tasks ?? []).filter((t) => !t.parent);

    const counts = { IN_PROGRESS: 0, WAITING_TO_SEND: 0, DEMO_SENT: 0 };
    const byBucket: Record<string, Array<{ name: string; status: string; assignee: string | null; url: string }>> = {
      IN_PROGRESS: [],
      WAITING_TO_SEND: [],
      DEMO_SENT: [],
    };

    for (const task of tasks) {
      const bucket = mapStageToBucket(task.status.status);
      counts[bucket]++;
      byBucket[bucket].push({
        name: task.name,
        status: task.status.status,
        assignee: task.assignees[0]?.username ?? null,
        url: task.url,
      });
    }

    return {
      total: tasks.length,
      inProgress: counts.IN_PROGRESS,
      waitingToSend: counts.WAITING_TO_SEND,
      demoSent: counts.DEMO_SENT,
      tasks: {
        inProgress: byBucket.IN_PROGRESS.slice(0, 10),
        waitingToSend: byBucket.WAITING_TO_SEND.slice(0, 10),
        demoSent: byBucket.DEMO_SENT.slice(0, 10),
      },
    };
  } catch {
    return { error: "Could not fetch demo tracker data" };
  }
}

async function executeTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "search_contacts":
      return searchContacts(String(args.query ?? ""));
    case "search_conversations":
      return searchConversations(
        String(args.query ?? ""),
        args.channel ? String(args.channel) : undefined
      );
    case "get_pipeline":
      return getPipeline();
    case "get_demo_tracker":
      return getDemoTracker();
    case "navigate_to":
      return { url: String(args.path ?? "/dashboard"), action: "navigate" };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── Tool declarations ──────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "search_contacts",
        description: "Search for contacts/leads by ANY identifier: name, email, phone, website URL, domain name, brand name, or company. Handles full URLs like https://tkave.com — automatically extracts the domain and brand name. Always try this first when a user asks about a specific person or brand.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Any identifier: name, email, phone, URL, domain, brand name, or company name" },
          },
          required: ["query"],
        },
      },
      {
        name: "search_conversations",
        description: "Search GHL conversations by any text query and/or channel type. Use when the user asks about a conversation, message, or wants to find leads from a specific channel (Instagram, Messenger, Facebook, SMS, email, WhatsApp, TikTok). Can search message content, contact names, or filter by channel. Use this when search_contacts returns no results.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Text to search in conversations and contact names. Can be empty if filtering by channel only." },
            channel: { type: SchemaType.STRING, description: "Optional channel filter: instagram, messenger, facebook, sms, email, whatsapp, tiktok" },
          },
          required: [],
        },
      },
      {
        name: "get_pipeline",
        description: "Get the current state of all sales pipelines — open deals per stage, total value, deal counts.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: "get_demo_tracker",
        description: "Get the current state of the Demo Tracker — how many demos are in progress, waiting to send, or already sent. Use for any question about demos, demo status, demo counts, or what's being worked on.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: "navigate_to",
        description: "Return a navigation link when the user asks to go somewhere or view a page.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            path: { type: SchemaType.STRING, description: "App path e.g. /contacts, /pipeline, /inbox" },
          },
          required: ["path"],
        },
      },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFunctionResponseParts(
  responses: Array<{ name: string; result: unknown }>
): Part[] {
  return responses.map((r) => ({
    functionResponse: {
      name: r.name,
      response: { result: JSON.stringify(r.result) },
    },
  }));
}

// ── Route ──────────────────────────────────────────────────────────────────────

interface ChatMessage { role: "user" | "assistant"; content: string; }
interface CopilotPageContext { page: string; pageTitle: string; entityType?: string; entityId?: string; entityName?: string; }

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "AI not configured" }, { status: 503 });

  const body = await req.json() as { messages: ChatMessage[]; context: CopilotPageContext };
  const { messages, context } = body;
  if (!messages?.length) return NextResponse.json({ error: "messages required" }, { status: 400 });

  const today = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const pageCtx = context?.entityName
    ? `${context.pageTitle} — viewing ${context.entityType ?? "item"}: ${context.entityName}`
    : context?.pageTitle ?? "Dashboard";

  const systemPrompt = `You are K — the AI co-pilot embedded in Kracked Sales CRM for Kracked Retention, an email design agency.
Today is ${today}. The user is on: ${pageCtx}.

CAPABILITIES:
- Search contacts/leads by ANY query: name, email, phone, website URL, domain (e.g. tkave.com), brand name, company. Full URLs are supported — you extract the domain automatically.
- Search conversations by message content or channel (Instagram, Messenger, Facebook, SMS, Email, WhatsApp, TikTok).
- Fetch pipeline data (stages, deal counts, values).
- Fetch Demo Tracker data (in-progress demos, waiting to send, demos sent — from ClickUp).
- Navigate the user to any page.
- Answer questions about the business, sales process, and data.

SEARCH STRATEGY:
1. Always try search_contacts first with the user's query (including full URLs).
2. search_contacts automatically falls back to conversations when no contacts match — check for a "conversationFallback" key in the result and surface those matches to the user.
3. If asking about a channel (Instagram, Messenger etc.) use search_conversations with that channel filter.
4. Never say "I can only search by name/email/phone" — you can search by anything.

RESPONSE FORMAT:
- Markdown. **Bold** key values. Bullet lists for multiple items.
- For contacts/deals, include links: [Name](/contacts/ID)
- Sharp and direct. One paragraph for simple answers, structured lists for complex ones.
- If a search returns partial results, suggest the user check the Contacts or Inbox pages directly.

BUSINESS CONTEXT:
Kracked Retention sells email design services to DTC ecommerce brands.
Sales flow: Instagram/FB DM → demo call → proposal → close.
Key metrics: demos booked, calls made, deals closed, revenue.`;

  try {
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: TOOLS,
      systemInstruction: systemPrompt,
    });

    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === "user" ? "user" as const : "model" as const,
      parts: [{ text: m.content }],
    }));
    const lastMessage = messages[messages.length - 1];
    const chat = model.startChat({ history });

    // Resolve tool calls with non-streaming calls (up to 3 rounds)
    let currentInput: string | Part[] = lastMessage.content;
    for (let round = 0; round < 3; round++) {
      const result = await chat.sendMessage(currentInput);
      const parts = result.response.candidates?.[0]?.content?.parts ?? [];
      const fnCalls = parts.filter((p) => p.functionCall);

      if (fnCalls.length === 0) {
        // No tool calls — stream the text we already have back to the client
        const text = result.response.text();
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            // Send in small chunks so the client renders progressively
            const CHUNK = 6;
            for (let i = 0; i < text.length; i += CHUNK) {
              controller.enqueue(encoder.encode(text.slice(i, i + CHUNK)));
              // Yield to allow the runtime to flush each chunk
              await Promise.resolve();
            }
            controller.close();
          },
        });
        return new NextResponse(readable, {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
        });
      }

      // Execute tools in parallel
      const fnResults = await Promise.all(
        fnCalls.map(async (part) => {
          const { name, args } = part.functionCall!;
          const output = await executeTool(name, args as Record<string, unknown>);
          return { name, result: output };
        })
      );
      currentInput = makeFunctionResponseParts(fnResults);
    }

    // After tool rounds, get a streaming final response
    const encoder = new TextEncoder();
    const streamResult = await chat.sendMessageStream(currentInput);
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamResult.stream) {
            const text = chunk.text();
            if (text) controller.enqueue(encoder.encode(text));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  } catch (err) {
    console.error("[POST /api/copilot/chat]", err);
    return NextResponse.json({ error: "Failed to generate response" }, { status: 500 });
  }
}
