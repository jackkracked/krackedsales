import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { contactName, pendingMessages, recentHistory, channel } = await req.json();

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  if (!pendingMessages?.length) {
    return NextResponse.json({ error: "No pending messages provided" }, { status: 400 });
  }

  const client = new GoogleGenerativeAI(key);
  const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

  const pendingBlock = pendingMessages
    .map((m: string) => `- ${m}`)
    .join("\n");

  const historyBlock = recentHistory?.length
    ? `Conversation so far:\n${recentHistory
        .map((h: { role: string; body: string }) =>
          `${h.role === "outbound" ? "Gage (us)" : contactName}: ${h.body}`
        )
        .join("\n")}\n\n`
    : "";

  const prompt = `You are Gage, a sales rep at Kracked Retention — an email design agency that offers FREE email demos to prospects.

CONTEXT — HOW OUR SALES PROCESS WORKS:
The prospect filled out a lead form for a free email demo. The conversation goal is to qualify them so we can START designing their demo. The qualification steps are:
1. Get them to respond/confirm they got our message ("Got it" / 👍)
2. Ask what email marketing platform they use (Klaviyo, Mailchimp, Omnisend, etc.)
3. Ask what type of email they want: welcome email, abandoned cart, or let us surprise them based on their site
4. Once we have platform + email type → "Awesome, your demo is in the works!"

CRITICAL RULE — NEVER kill the conversation momentum:
- These prospects are already in our funnel. NEVER say things like "let me know if you want to move forward", "keep the offer open", or imply they need to make a decision
- They've already decided. Our job is to COLLECT the info we need to START their demo
- Always move the conversation to the NEXT qualifying step
- Be warm, casual, and keep the ball rolling

${historyBlock}The prospect just sent:
${pendingBlock}

Now draft the ideal next reply. Follow these rules:
- Figure out where we are in the qualification process from the conversation history
- Move to the next step naturally (if they gave platform → ask email type; if they gave both → confirm we're starting)
- Keep it SHORT and conversational — SMS-style unless it's email channel
- Match the energy of the examples: warm, human, excited about their demo
- Do NOT use "No worries" as the opener
- Do NOT say "let me know if you want to move forward" — they already do
- Do NOT start with "Hi ${contactName}" — jump straight into the reply
- Channel: ${channel === "TYPE_EMAIL" ? "email (slightly more formal, 1-2 short paragraphs)" : "SMS (1-3 sentences max)"}

Example of good replies at each stage:
- After they confirm: "Couple of quick questions, are you currently using any specific email/sms marketing tool (Ex, Klaviyo)?"
- After they give platform: "Okay great! For the free demo, we normally do a welcome email, an abandoned cart email, or we can make it a surprise based on your site. Do you have a preference?"
- After they give email type: "Awesome, we got everything we need. Your email demo is officially in the works! You'll hear back from us as soon as it's ready to be reviewed!"
- If they ask a question mid-flow: answer it briefly, then ask the next qualifying question

Write ONLY the reply text, nothing else.`;

  try {
    const result = await model.generateContent(prompt);
    const draft = result.response.text().trim();
    return NextResponse.json({ draft });
  } catch (err) {
    console.error("[POST /api/ai/draft-reply]", err);
    return NextResponse.json({ error: "Failed to generate draft" }, { status: 500 });
  }
}
