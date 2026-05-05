import { NextRequest, NextResponse } from "next/server";
import { generateCopilotResponse } from "@/lib/ai/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { userMessage, conversationHistory, salesContext } = body as {
    userMessage: string;
    conversationHistory: Array<{ role: "user" | "model"; text: string }>;
    salesContext: string;
  };

  if (!userMessage?.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  try {
    const stream = await generateCopilotResponse({
      userMessage,
      conversationHistory: conversationHistory ?? [],
      salesContext: salesContext ?? "No sales data available.",
    });

    // Stream the response as plain text
    // GenerateContentStreamResult exposes .stream (the AsyncIterable)
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream.stream) {
            const text = chunk.text();
            if (text) controller.enqueue(encoder.encode(text));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[POST /api/ai/copilot]", err);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 }
    );
  }
}
