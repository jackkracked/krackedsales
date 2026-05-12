import { GoogleGenerativeAI } from "@google/generative-ai";

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

const MODEL = "gemini-2.5-flash";

export interface RecommendedMessage {
  subject?: string;
  body: string;
  channel: string;
  delayDays: number;
  angle: string;
}

export interface FollowUpRecommendation {
  type: "single" | "sequence" | "wait";
  reasoning: string;
  messages: RecommendedMessage[];
  nextCheckInDays?: number;
}

export type FollowUpZone = 1 | 2 | 3 | 4;

export interface FollowUpContext {
  contact: {
    name: string;
    firstName: string;
    website: string | null;
    channel: string; // EMAIL | SMS | INSTAGRAM | FACEBOOK
  };
  pipeline: {
    currentStage: string;
    zone: FollowUpZone;
    daysInStage: number;
    daysSinceLastContact: number;
    totalFollowUpsSent: number;
  };
  history: {
    hasEverReplied: boolean;
    lastReplyText: string | null;
    messagesSent: Array<{
      daysAgo: number;
      angle: string | null;
      preview: string;
    }>;
    previousGHLEmails?: Array<{
      daysAgo: number;
      subject: string | null;
      preview: string | null;
    }>;
  };
  notes?: string;
  callInsights?: {
    wantsText: string | null;
    objectionsText: string | null;
    nextStepsText: string | null;
    redFlagsText: string | null;
  } | null;
}

const ZONE_GOALS: Record<FollowUpZone, string> = {
  1: "Get them to book an intro call to review the email design we created for them",
  2: "Get them to reschedule the missed intro call — keep it warm, zero pressure, no awkwardness",
  3: "Move the deal forward gently. EXTREME CARE — max 1 message every 5 days, never pushy, never urgency language",
  4: "Revive a deal that has gone quiet — reference their business specifically, add real value, be direct",
};

const SYSTEM_PROMPT = `You are an AI assistant helping a one-person email design agency follow up with sales prospects.
Your job: recommend the best follow-up action and write the actual message(s).

The agency creates free custom email design demos (welcome emails, flow emails) for DTC brands on platforms like Klaviyo, Shopify Email, etc. The sales process is: lead comes in → free demo built → sent to contact → follow up to book intro call → call → proposal → close.

CRITICAL CONTEXT: Every single prospect in this system has ALREADY received a free custom email design demo built specifically for their brand. This is NOT cold outreach. They have seen a demo. Your messages must NEVER imply they haven't had a demo, ask if they'd like to see a demo, or treat them like a cold prospect. The demo exists. The goal is to get them to book a call to review it.

DECIDING single vs sequence vs wait:
- wait: messaged within last 3 days, OR active back-and-forth conversation → set nextCheckInDays
- single: last contact 3–14 days ago, or they replied recently then went quiet again
- sequence (2–3 messages, 3–5 days apart): 18+ days cold, or showed early interest then disappeared

WRITING MESSAGES — NON-NEGOTIABLE RULES:
1. Sound like a real human typing this on their phone
2. SMS: max 2 sentences. Email: max 4 sentences.
3. ONE question per message. Never two questions in one message.
4. Use their first name once at the very start. Never again in the message.
5. NEVER start a message with the word "I"
6. Use contractions: "I've", "we've", "can't", "it's", "don't"
7. Reference something SPECIFIC about their business — never write a generic message. Use the contact's website or business name if provided.
8. NEVER invent external signals you do not have. Do NOT fabricate things like "saw you're active on LinkedIn," "noticed your recent post," "saw you just launched X," or any signal about their behaviour unless it is explicitly provided in the context. If you have no specific signal, write around their business instead (e.g. their brand, product, niche).
9. FORBIDDEN PHRASES (never use these): hope this finds you well, I wanted to reach out, just checking in, circling back, touching base, as per my last, going forward, I hope you're doing well, don't hesitate, please feel free, at your earliest convenience, I look forward to, best regards, kind regards, leverage, synergies, value proposition, moving the needle, in terms of
9. NEVER use em-dashes (—). Use a comma or period instead.
10. STALE LEADS (90+ days since last contact): Do NOT reference the original demo as if it was recent ("did the demo land okay?" is wrong at 90+ days). Instead treat it like a fresh re-engagement — they have almost certainly moved on. Acknowledge the gap naturally or approach from a completely fresh angle focused on their business today.
11. No bullet points inside messages
12. No more than one exclamation mark per message
13. NEVER mention AI, templates, or automation
14. For SMS/DM: lowercase start is fine ("hey sarah" not "Hey Sarah,")

GOOD EXAMPLE (email):
Subject: heroeshonored.shop
Body: "Donale, checked your store. The product photos are great but the emails don't match the brand. Worth 20 minutes to fix that?"

BAD EXAMPLE (email):
"Hi Donale! I hope this message finds you well. I wanted to follow up on the email design demo I sent over — I'd love to leverage this opportunity to connect and discuss how we can move the needle on your email marketing going forward. Don't hesitate to reach out at your earliest convenience!"

Return ONLY valid JSON. No text outside the JSON object.`;

export async function generateFollowUpRecommendation(
  ctx: FollowUpContext
): Promise<FollowUpRecommendation> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: "application/json" },
  });

  const goal = ZONE_GOALS[ctx.pipeline.zone];

  const userPrompt = `CONTEXT:
${JSON.stringify(
  {
    contact: ctx.contact,
    pipeline: {
      ...ctx.pipeline,
      followUpGoal: goal,
    },
    history: ctx.history,
    notes: ctx.notes ?? "",
    ...(ctx.callInsights ? { callInsights: ctx.callInsights } : {}),
  },
  null,
  2
)}

Days since last contact: ${ctx.pipeline.daysSinceLastContact} (IMPORTANT: read the stale lead rule if this is 90+)

Based on this context, decide the best follow-up action and write the message(s).

Return JSON matching this schema exactly:
{
  "type": "single" | "sequence" | "wait",
  "reasoning": "2–3 sentences in plain English explaining your recommendation — what you noticed and why this approach",
  "messages": [
    {
      "subject": "(email only, omit for SMS/Instagram/Facebook)",
      "body": "the actual message text",
      "channel": "${ctx.contact.channel}",
      "delayDays": 0,
      "angle": "short_snake_case_label (e.g. store_observation, reschedule_easy, pattern_interrupt, value_add_case_study)"
    }
  ],
  "nextCheckInDays": 3
}

Rules:
- For "single": exactly 1 message, delayDays: 0
- For "sequence": 2–3 messages with delayDays like [0, 4, 8] — each message MUST use a different angle
- For "wait": empty messages array, set nextCheckInDays
- Each message in a sequence must stand alone — never reference a previous message`;

  const result = await model.generateContent([SYSTEM_PROMPT, userPrompt]);
  const raw = result.response.text().trim().replace(/```json|```/g, "").trim();
  return JSON.parse(raw) as FollowUpRecommendation;
}
