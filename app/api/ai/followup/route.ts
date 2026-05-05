import { NextRequest, NextResponse } from "next/server";
import { generateFollowUpMessage } from "@/lib/ai/gemini";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { contactName, demoType, platform, daysSinceDemo, channel, previousFollowUps } =
    body as {
      contactName: string;
      demoType: string;
      platform: string;
      daysSinceDemo: number;
      channel: string;
      previousFollowUps: number;
    };

  if (!contactName || !demoType) {
    return NextResponse.json(
      { error: "contactName and demoType are required" },
      { status: 400 }
    );
  }

  try {
    const message = await generateFollowUpMessage({
      contactName,
      demoType,
      platform: platform ?? "Klaviyo",
      daysSinceDemo: daysSinceDemo ?? 3,
      channel: channel ?? "SMS",
      previousFollowUps: previousFollowUps ?? 0,
    });

    return NextResponse.json({ message });
  } catch (err) {
    console.error("[POST /api/ai/followup]", err);
    return NextResponse.json(
      { error: "Failed to generate message" },
      { status: 500 }
    );
  }
}
