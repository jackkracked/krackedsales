import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CallPrepSections } from "./types";
import type { CompanyResearch } from "./research";
import type {
  GatheredContact,
  CallHistory,
  DemoInfo,
  RecentMessage,
} from "./gather";

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

const MODEL = "gemini-2.5-flash";

interface GenerateInput {
  contact: GatheredContact;
  callType: "intro" | "follow_up";
  callHistory: CallHistory;
  research: CompanyResearch | null;
  demoStatus: DemoInfo | null;
  proposalStatus: { status: string; amount: number } | null;
  recentMessages: RecentMessage[];
}

export async function generateCallPrep(
  input: GenerateInput
): Promise<CallPrepSections> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL });

  const isIntro = input.callType === "intro";
  const hasResearch = !!input.research && !input.research.degraded;

  const contactContext = buildContactContext(input.contact);
  const researchContext = buildResearchContext(input.research);
  const historyContext = buildHistoryContext(input.callHistory, isIntro);
  const demoContext = buildDemoContext(input.demoStatus);
  const proposalContext = input.proposalStatus
    ? `\nProposal Status: ${input.proposalStatus.status} ($${input.proposalStatus.amount})`
    : "";
  const messagesContext = buildMessagesContext(input.recentMessages);

  const prompt = `You are preparing a call brief for a sales rep at Kracked, an email design agency. This is a${isIntro ? "n INTRO" : " FOLLOW-UP"} call.

${contactContext}
${researchContext}
${historyContext}
${demoContext}
${proposalContext}
${messagesContext}

Generate a comprehensive call preparation brief. Respond with ONLY valid JSON matching this exact structure (no markdown, no explanation):

{
  "executiveSummary": "2-3 sentences: who this company definitively is (what they sell), their maturity, and what this call is about. State facts, not guesses.",
  "callAgenda": ["talking point 1", "talking point 2", "...up to 5 numbered items"],
  "brandResearch": ${hasResearch ? '{"summary": "what they sell + their maturity, definitively", "audience": "their target customer", "currentMarketing": "their current email presence and the concrete opportunity for Kracked; append source URLs in parentheses if available"}' : "null"},
  "qualification": {
    "budget": "Do NOT estimate a budget. Write exactly: 'Confirm on call — lead value in the CRM is a system default, not a real budget signal.'",
    "timeline": "A specific question to confirm on the call (from the unknowns), e.g. 'Confirm on call: are they planning a launch or campaign soon?'",
    "decisionMaker": "State the known contact and, if the decision-maker is unconfirmed, 'Confirm on call: is ${input.contact.name} the decision-maker?'",
    "fit": "High/Medium/Low with DEFINITIVE reasoning from the research (e.g. DTC brand with email capture but no flows = strong fit for an email agency). No hedging."
  },
  "objectionPlaybook": [
    {"objection": "likely objection for THIS specific business", "response": "suggested response grounded in their actual situation"},
    {"objection": "...", "response": "..."}
  ]${!isIntro ? `,
  "previousInteractions": {
    "lastCallSummary": "summary of what was discussed in the last call",
    "recentMessages": [{"channel": "SMS/Email/etc", "body": "message preview", "date": "date"}],
    "promisesMade": ["any commitments from last interaction"]
  }` : ""}
}

CRITICAL RULES:
- BANNED WORDS: "likely", "probably", "appears", "seems", "suggests", "maybe", "could be", "might", "possibly". Every statement must be a definitive fact drawn from the research or call history below.
- Ground EVERY claim in the Company Research or Call History provided. Do not infer business type from the company's name.
- NEVER treat lead/deal value as a budget signal — it is a system default ($1000 on every new lead) and is meaningless. Do not mention a dollar budget.
- When something is genuinely unknown, do NOT guess — phrase it as a specific "Confirm on call: …" question. The provided "To confirm on the call" list is your source for these.
- Be specific to THIS company. Objections and agenda items must reflect their actual products, channel, and maturity.
- Keep the executive summary punchy; the rep has 30 seconds.
${!hasResearch ? "- NOTE: deep company research was unavailable for this lead. Be honest about what is unknown and lead the brief with confirm-on-call questions rather than inventing facts." : ""}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim().replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(text);
    return {
      executiveSummary: parsed.executiveSummary ?? "",
      callAgenda: parsed.callAgenda ?? [],
      brandResearch: parsed.brandResearch ?? null,
      qualification: parsed.qualification ?? {
        budget: "Confirm on call — lead value is a system default, not a budget signal.",
        timeline: "Confirm on call.",
        decisionMaker: "Confirm on call.",
        fit: "Unknown",
      },
      objectionPlaybook: parsed.objectionPlaybook ?? [],
      previousInteractions: parsed.previousInteractions ?? null,
      demoStatus: input.demoStatus
        ? { status: input.demoStatus.status, clickupLink: input.demoStatus.clickupLink }
        : null,
    };
  } catch {
    throw new Error("Failed to parse Gemini response as JSON");
  }
}

// ─── Context builders ────────────────────────────────────────────────────────

function buildContactContext(contact: GatheredContact): string {
  const lines = ["## Contact Information"];
  lines.push(`Name: ${contact.name}`);
  if (contact.email) lines.push(`Email: ${contact.email}`);
  if (contact.phone) lines.push(`Phone: ${contact.phone}`);
  if (contact.website) lines.push(`Website: ${contact.website}`);
  if (contact.companyName) lines.push(`Company: ${contact.companyName}`);
  if (contact.tags.length) lines.push(`Tags: ${contact.tags.join(", ")}`);
  if (contact.stage) lines.push(`Pipeline Stage: ${contact.stage}`);
  if (contact.source) lines.push(`Lead Source: ${contact.source}`);
  // Deliberately NOT including monetaryValue/deal value — it is a system default
  // ($1000 on every new lead) and must never be read as a budget signal.

  const fields = Object.entries(contact.customFields);
  if (fields.length) {
    lines.push("\nCustom Fields:");
    for (const [k, v] of fields) {
      lines.push(`  ${k}: ${v}`);
    }
  }

  return lines.join("\n");
}

function buildResearchContext(research: CompanyResearch | null): string {
  if (!research || research.degraded) {
    return "\n## Company Research\nDeep research was unavailable for this lead. Do not invent facts about the company.";
  }

  const lines = ["\n## Company Research (verified — state these as fact)"];
  if (research.whatTheySell) lines.push(`What they sell: ${research.whatTheySell}`);
  if (research.productsAndPricing) lines.push(`Products & pricing: ${research.productsAndPricing}`);
  if (research.targetCustomer) lines.push(`Target customer: ${research.targetCustomer}`);
  if (research.positioningVoice) lines.push(`Positioning & voice: ${research.positioningVoice}`);
  if (research.maturity) lines.push(`Maturity: ${research.maturity}`);
  if (research.salesChannel) lines.push(`Sales channel: ${research.salesChannel}`);
  if (research.emailPresence) lines.push(`Email presence & opportunity: ${research.emailPresence}`);

  if (research.publicNumbers.length) {
    lines.push("\nPublic numbers (sourced — safe to cite):");
    for (const n of research.publicNumbers) {
      lines.push(`  - ${n.claim} (source: ${n.sourceUrl})`);
    }
  }

  if (research.confirmOnCall.length) {
    lines.push("\nTo confirm on the call (do not guess these — turn them into questions):");
    for (const q of research.confirmOnCall) lines.push(`  - ${q}`);
  }

  if (research.sources.length) {
    lines.push("\nSources:");
    for (const s of research.sources.slice(0, 6)) {
      lines.push(`  - ${s.title ? `${s.title}: ` : ""}${s.uri}`);
    }
  }

  return lines.join("\n");
}

function buildHistoryContext(history: CallHistory, isIntro: boolean): string {
  if (isIntro && history.dispositions.length === 0) {
    return "\n## Call History\nNo previous calls. This is the first interaction.";
  }

  const lines = ["\n## Call History"];

  if (history.dispositions.length) {
    lines.push("Previous call outcomes:");
    for (const d of history.dispositions.slice(0, 5)) {
      const date = d.dispositionedAt.toLocaleDateString();
      lines.push(`  - ${date}: ${d.outcome}${d.notes ? ` — ${d.notes}` : ""}`);
    }
  }

  if (history.fathomSummaries.length) {
    lines.push("\nCall transcripts/summaries (most recent first):");
    for (const s of history.fathomSummaries.slice(0, 3)) {
      const date = s.startedAt.toLocaleDateString();
      lines.push(`  [${date}] ${s.summary.slice(0, 1500)}`);
    }
  }

  if (history.insights.length) {
    const latest = history.insights[0];
    lines.push("\nLatest call insights:");
    if (latest.wants) lines.push(`  Wants: ${latest.wants}`);
    if (latest.objections) lines.push(`  Objections: ${latest.objections}`);
    if (latest.nextSteps) lines.push(`  Next Steps: ${latest.nextSteps}`);
    if (latest.redFlags) lines.push(`  Red Flags: ${latest.redFlags}`);
    if (latest.sentiment) lines.push(`  Sentiment: ${latest.sentiment}`);
  }

  return lines.join("\n");
}

function buildDemoContext(demo: DemoInfo | null): string {
  if (!demo) return "\n## Demo Status\nNo demo created yet.";
  return `\n## Demo Status\nStatus: ${demo.status}${demo.clickupLink ? `\nClickUp: ${demo.clickupLink}` : ""}`;
}

function buildMessagesContext(messages: RecentMessage[]): string {
  if (!messages.length) return "\n## Recent Messages\nNo recent messages found.";

  const lines = ["\n## Recent Messages (newest first)"];
  for (const m of messages.slice(0, 8)) {
    const dir = m.direction === "inbound" ? "←" : "→";
    lines.push(`  ${dir} [${m.channel}] ${m.date}: ${m.body.slice(0, 200)}`);
  }
  return lines.join("\n");
}
