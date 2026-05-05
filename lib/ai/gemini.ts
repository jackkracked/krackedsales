import { GoogleGenerativeAI } from "@google/generative-ai";

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

const MODEL = "gemini-2.5-flash";

/** Generate a single follow-up message for a contact */
export async function generateFollowUpMessage(params: {
  contactName: string;
  demoType: string;
  platform: string;
  daysSinceDemo: number;
  channel: string;
  previousFollowUps: number;
}): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL });

  const prompt = `You are a sales rep for an email design agency called Kracked. Write a short, casual, human follow-up message.

Context:
- Contact name: ${params.contactName}
- We created a free ${params.demoType} email demo for them (platform: ${params.platform})
- It's been ${params.daysSinceDemo} days since we sent the demo and they haven't responded
- This is follow-up number ${params.previousFollowUps + 1}
- Channel: ${params.channel}

Rules:
- Keep it under 3 sentences
- Sound human, not salesy
- Reference the specific demo type
- Ask a simple question to prompt a response
- Do NOT use emojis unless it's Instagram
- Do NOT say "I hope this message finds you well"
- For SMS: very short (under 160 chars if possible)
- First follow-up: gentle check-in. Second: add value. Third+: urgency.

Write ONLY the message text, nothing else.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

/** Categorize a brand as DTC ecommerce or something else */
export async function categorizeBrand(params: {
  domain: string;
  content: string;
}): Promise<{ category: string; reason: string }> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL });

  const prompt = `You are helping a DTC email design agency qualify leads. Analyze this website and categorize the business.

Domain: ${params.domain}
Website content (first 6000 chars): ${params.content || "(could not fetch — use domain name only)"}

Categorize as ONE of:
- "ecommerce": DTC/CPG brand selling physical products directly to consumers online (Shopify, beauty, food/beverage, apparel, supplements, home goods, pet products, etc). THIS IS THE IDEAL CLIENT.
- "service": Service-based business (agency, coach, consultant, freelancer, SaaS, software, therapist, etc.)
- "local": Local/brick-and-mortar business (restaurant, salon, gym, clinic, real estate, etc.)
- "b2b": B2B company selling primarily to other businesses
- "other": Anything else

Respond with ONLY valid JSON, no markdown, no explanation:
{"category":"...","reason":"one sentence"}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim().replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(text);
  } catch {
    return { category: "other", reason: "Could not parse response" };
  }
}

/** Generate a streaming copilot response */
export async function generateCopilotResponse(params: {
  userMessage: string;
  salesContext: string;
  conversationHistory: Array<{ role: "user" | "model"; text: string }>;
}) {
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL });

  const history = params.conversationHistory
    .map((h) => `${h.role === "user" ? "You" : "Assistant"}: ${h.text}`)
    .join("\n");

  const prompt = `SYSTEM: You are an internal AI sales analytics assistant for Kracked — an email design agency.
This is a PRIVATE internal tool for the sales team. Do NOT act as a marketing chatbot or try to sell services.
Your ONLY job is to help the sales team understand their own sales data and performance.

You have access to this sales context:
${params.salesContext}

Previous conversation:
${history}

User question: ${params.userMessage}

Instructions:
- Answer ONLY about sales analytics, pipeline data, demo tracker, follow-ups, and performance metrics
- Be direct and data-driven. Reference specific numbers when available.
- Keep responses under 3 sentences unless detail is genuinely needed
- If asked about something unrelated to sales analytics, redirect to what you can help with
- Do NOT offer to boost marketing, create campaigns, or act as a customer-facing tool`;

  return model.generateContentStream(prompt);
}
