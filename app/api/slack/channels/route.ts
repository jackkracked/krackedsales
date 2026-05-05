import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { slackSettings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

interface SlackChannel { id: string; name: string; }
interface SlackListResponse {
  ok: boolean;
  channels?: SlackChannel[];
  error?: string;
  response_metadata?: { next_cursor?: string };
}

export async function GET() {
  try {
    const rows = await db().select({ botToken: slackSettings.botToken }).from(slackSettings).limit(1);
    const token = rows[0]?.botToken;
    if (!token) return NextResponse.json({ error: "No Slack bot token configured" }, { status: 400 });

    const all: SlackChannel[] = [];
    let cursor = "";

    // Paginate through all channels
    while (true) {
      const url = `https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200&exclude_archived=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return NextResponse.json({ error: "Slack API request failed" }, { status: 502 });
      const data: SlackListResponse = await res.json();
      if (!data.ok) return NextResponse.json({ error: data.error ?? "Slack API error" }, { status: 400 });

      for (const c of data.channels ?? []) all.push({ id: c.id, name: c.name });

      cursor = data.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }

    // Sort alphabetically
    all.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ channels: all });
  } catch (err) {
    console.error("[Slack Channels GET]", err);
    return NextResponse.json({ error: "Failed to fetch channels" }, { status: 500 });
  }
}
