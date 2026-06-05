import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CallPrepSections } from "./types";
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
  websiteContent: string | null;
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

  const contactContext = buildContactContext(input.contact);
  const historyContext = buildHistoryContext(input.callHistory, isIntro);
  const websiteContext = input.websiteContent
    ? `\n## Website Content (scraped)\n${input.websiteContent}`
    : "\n## Website Content\nCould not be retrieved.";
  const demoContext = buildDemoContext(input.demoStatus);
  const proposalContext = input.proposalStatus
    ? `\nProposal Status: ${input.proposalStatus.status} ($${input.proposalStatus.amount})`
    : "";
  const messagesContext = buildMessagesContext(input.recentMessages);

  const prompt = `You are preparing a call brief for a sales rep at Kracked, an email design agency. This is a${isIntro ? "n INTRO" : " FOLLOW-UP"} call.

${contactContext}
${websiteContext}
${historyContext}
${demoContext}
${proposalContext}
${messagesContext}

Generate a comprehensive call preparation brief. Respond with ONLY valid JSON matching this exact structure (no markdown, no explanation):

{
  "executiveSummary": "2-3 sentences: who they are, where they're at in the pipeline, what this call is about",
  "callAgenda": ["talking point 1", "talking point 2", "...up to 5 numbered items"],
  "brandResearch": ${input.websiteContent ? '{"summary": "what the business does", "audience": "who their customers are", "currentMarketing": "their current email/marketing presence and opportunities"}' : "null"},
  "qualification": {
    "budget": "assessment based on available data or 'Unknown'",
    "timeline": "assessment or 'Unknown'",
    "decisionMaker": "assessment or 'Unknown'",
    "fit": "High/Medium/Low with brief reasoning"
  },
  "objectionPlaybook": [
    {"objection": "likely objection", "response": "suggested response"},
    {"objection": "...", "response": "..."}
  ]${!isIntro ? `,
  "previousInteractions": {
    "lastCallSummary": "summary of what was discussed in the last call",
    "recentMessages": [{"channel": "SMS/Email/etc", "body": "message preview", "date": "date"}],
    "promisesMade": ["any commitments from last interaction"]
  }` : ""}
}

Rules:
- Be specific to THIS contact and brand, not generic
- For intro calls: focus on brand research, qualification, and demo walkthrough prep
- For follow-up calls: focus on what happened last time, what changed, and next steps
- Call agenda items should be actionable conversation points, not headers
- Objections should be realistic for an email design agency selling to this type of business
- Keep the executive summary punchy; the rep has 30 seconds
- If data is missing, make reasonable inferences from what's available rather than saying "unknown"`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim().replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(text);
    return {
      executiveSummary: parsed.executiveSummary ?? "",
      callAgenda: parsed.callAgenda ?? [],
      brandResearch: parsed.brandResearch ?? null,
      qualification: parsed.qualification ?? {
        budget: "Unknown",
        timeline: "Unknown",
        decisionMaker: "Unknown",
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
  if (contact.monetaryValue) lines.push(`Deal Value: $${contact.monetaryValue}`);
  if (contact.source) lines.push(`Lead Source: ${contact.source}`);

  const fields = Object.entries(contact.customFields);
  if (fields.length) {
    lines.push("\nCustom Fields:");
    for (const [k, v] of fields) {
      lines.push(`  ${k}: ${v}`);
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
