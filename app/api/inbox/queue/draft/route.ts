/**
 * POST /api/inbox/queue/draft
 *
 * Generates a short AI reply draft for a specific conversation in the queue.
 * Uses the last message for context. Returns a single short message.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const dynamic = "force-dynamic";

const MODEL = "gemini-2.5-flash";

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

interface DraftBody {
  contactName: string;
  lastMessage: string;
  channel: string;   // "GHL" | "Meta" | "TikTok"
  platform?: string; // "facebook" | "instagram"
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json() as DraftBody;
    const { contactName, lastMessage, channel } = body;

    if (!contactName || !lastMessage) {
      return NextResponse.json({ error: "contactName and lastMessage required" }, { status: 400 });
    }

    const firstName = contactName.split(" ")[0];
    const isSMS = channel === "GHL";
    const isDM = channel === "Meta" || channel === "TikTok";

    const prompt = `You are a sales rep at Kracked, an email design agency. Write a short, warm reply to this prospect.

Prospect name: ${contactName}
Their last message: "${lastMessage}"
Channel: ${isSMS ? "SMS / GHL" : isDM ? "Instagram/Facebook DM" : "message"}

Rules:
- Max 2 sentences for DMs/SMS, max 3 for other channels
- Sound like a real human, not a bot
- Use their first name (${firstName}) once at the start if natural, but only if it flows well
- Do NOT start with "I"
- No em-dashes, no bullet points, no exclamation marks unless absolutely natural
- If the last message is a question, answer it directly
- Keep it warm but professional

Return ONLY the message text, nothing else.`;

    const client = getClient();
    const model = client.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);
    const draft = result.response.text().trim().replace(/^["']|["']$/g, "");

    return NextResponse.json({ draft });
  } catch (err) {
    console.error("[POST /api/inbox/queue/draft]", err);
    return NextResponse.json({ error: "Failed to generate draft" }, { status: 500 });
  }
}
