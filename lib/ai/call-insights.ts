/**
 * AI extraction of structured insights from Google Meet call transcripts.
 * Uses Gemini flash to keep cost low — transcripts are typically short.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@/lib/db";
import { callInsights } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const MODEL = "gemini-2.5-flash";

export interface CallInsightResult {
  wantsText: string | null;
  objectionsText: string | null;
  nextStepsText: string | null;
  redFlagsText: string | null;
  sentimentScore: number | null;  // 1–5
  sentimentLabel: string | null;  // "positive" | "neutral" | "negative"
  suggestedOutcome: string | null; // one of the call disposition outcomes, or null
  suggestedNotes: string | null;   // brief summary for the rep to confirm
}

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

/** Extract structured insights from a raw transcript string */
export async function analyzeTranscript(
  transcriptText: string
): Promise<CallInsightResult> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL });

  const prompt = `You are analysing a sales call transcript for an email design agency called Kracked Sales.
Extract the following from the transcript and return ONLY valid JSON. Use null for fields where there is not enough information.

{
  "wantsText": "What the prospect wants / their goals (1-2 sentences)",
  "objectionsText": "Objections or hesitations raised (1-2 sentences, null if none)",
  "nextStepsText": "Agreed next steps from the call (1-2 sentences)",
  "redFlagsText": "Any red flags: budget concerns, competitor mentions, disinterest (1-2 sentences, null if none)",
  "sentimentScore": <integer 1–5 where 1=very negative, 3=neutral, 5=very positive>,
  "sentimentLabel": <"positive" | "neutral" | "negative">,
  "suggestedOutcome": "<one of: closed, preparing_proposal, sent_proposal, rebooked, not_interested, budget_objection, needs_time, or null if unclear>",
  "suggestedNotes": "<1-2 sentence summary of the call outcome for the rep's notes, or null>"
}

Transcript:
${transcriptText.slice(0, 12000)}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // Strip markdown code fences if present
  const json = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  const parsed = JSON.parse(json) as CallInsightResult;
  return parsed;
}

/**
 * Transcribe call audio (Gemini accepts the audio inline) into a diarized
 * transcript. Returns null when there's no discernible speech (voicemail, ringing,
 * an unanswered/rejected call).
 */
export async function transcribeAudio(base64: string, mimeType: string): Promise<string | null> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL });
  const prompt = `This is the audio recording of an outbound sales phone call for an email design agency. Transcribe it verbatim as a diarized transcript. Put each speaker turn on its own line, prefixed with "Rep:" (the salesperson who placed the call) or "Prospect:" (the person who was called). Do not add any commentary. If there is no discernible conversation (voicemail greeting only, ringing, silence, or the call was not answered), reply with exactly: NO_SPEECH`;
  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType, data: base64 } },
  ]);
  const text = result.response.text().trim();
  if (!text || /^NO_SPEECH\.?$/i.test(text) || text.length < 4) return null;
  return text;
}

/**
 * Convert a diarized "Rep:/Prospect:" transcript into the JSON shape the calls
 * transcript route reads (Fathom-compatible), so dialer transcripts render there.
 */
export function diarizedToStored(text: string): string {
  const items = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(Rep|Prospect|Agent|Caller|Speaker\s*\d*)\s*[:\-]\s*(.*)$/i);
      return { speaker: { display_name: m ? m[1] : "Speaker" }, text: m ? m[2] : line, timestamp: "" };
    });
  return JSON.stringify(items);
}

/** Generate insights for a call and persist to callInsights table. Idempotent. */
export async function generateAndStoreInsights(
  callId: string,
  contactId: string | null,
  transcriptText: string
): Promise<CallInsightResult | null> {
  const client = db();

  // Skip if already analysed
  const existing = await client
    .select({ id: callInsights.id })
    .from(callInsights)
    .where(eq(callInsights.callId, callId))
    .limit(1);
  if (existing.length > 0) return null;

  try {
    const insights = await analyzeTranscript(transcriptText);

    await client.insert(callInsights).values({
      callId,
      contactId,
      wantsText: insights.wantsText,
      objectionsText: insights.objectionsText,
      nextStepsText: insights.nextStepsText,
      redFlagsText: insights.redFlagsText,
      sentimentScore: insights.sentimentScore,
      sentimentLabel: insights.sentimentLabel,
      suggestedOutcome: insights.suggestedOutcome,
      suggestedNotes: insights.suggestedNotes,
    });

    return insights;
  } catch (err) {
    console.error("[call-insights] Analysis failed for call", callId, err);
    return null;
  }
}
