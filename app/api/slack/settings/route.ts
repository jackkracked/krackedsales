import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { slackSettings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** GET — return current Slack settings; bot token is masked for security */
export async function GET() {
  try {
    const rows = await db().select().from(slackSettings).limit(1);
    const row = rows[0];

    if (!row) {
      return NextResponse.json({ settings: null });
    }

    return NextResponse.json({
      settings: {
        id: row.id,
        // Only return first 8 chars of the token so the UI can show "configured"
        botToken: row.botToken ? row.botToken.slice(0, 8) + "..." : null,
        signingSecret: row.signingSecret ? "••••••••" : null,
        channelId: row.channelId,
        channelName: row.channelName,
        enabled: row.enabled,
        demoWebhookUrl: row.demoWebhookUrl ?? null,
        updatedAt: row.updatedAt,
      },
    });
  } catch (err) {
    console.error("[Slack Settings GET]", err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

interface SlackSettingsBody {
  botToken?: string;
  signingSecret?: string;
  channelId?: string;
  channelName?: string;
  enabled?: boolean;
  demoWebhookUrl?: string;
}

/** POST — upsert Slack settings. Omit a field to leave it unchanged. */
export async function POST(req: NextRequest) {
  try {
    const body: SlackSettingsBody = await req.json();

    const existing = await db().select().from(slackSettings).limit(1);

    if (existing.length === 0) {
      // Auto-fetch bot user ID if a token is provided
      let botUserId: string | null = null;
      if (body.botToken) {
        try {
          const authRes = await fetch("https://slack.com/api/auth.test", { headers: { Authorization: `Bearer ${body.botToken}` } });
          const authData = await authRes.json();
          if (authData.ok && authData.user_id) botUserId = authData.user_id;
        } catch { /* non-fatal */ }
      }
      // First-time insert
      await db().insert(slackSettings).values({
        botToken: body.botToken ?? null,
        signingSecret: body.signingSecret ?? null,
        channelId: body.channelId ?? null,
        channelName: body.channelName ?? null,
        botUserId,
        enabled: body.enabled ?? false,
        demoWebhookUrl: body.demoWebhookUrl ?? null,
        updatedAt: new Date(),
      });
    } else {
      // Build update object — only overwrite fields that were actually sent
      const updates: Partial<typeof slackSettings.$inferInsert> = {
        updatedAt: new Date(),
      };

      // Only update token/secret if the caller sent a real value (not the masked placeholder)
      if (body.botToken && !body.botToken.endsWith("...")) {
        updates.botToken = body.botToken;
        // Auto-fetch the bot's Slack user ID so the webhook can strip @mentions
        try {
          const authRes = await fetch("https://slack.com/api/auth.test", {
            headers: { Authorization: `Bearer ${body.botToken}` },
          });
          const authData = await authRes.json();
          if (authData.ok && authData.user_id) updates.botUserId = authData.user_id;
        } catch { /* non-fatal */ }
      }
      if (body.signingSecret && body.signingSecret !== "••••••••") {
        updates.signingSecret = body.signingSecret;
      }
      if (body.channelId !== undefined) updates.channelId = body.channelId;
      if (body.channelName !== undefined) updates.channelName = body.channelName;
      if (body.enabled !== undefined) updates.enabled = body.enabled;
      if (body.demoWebhookUrl !== undefined) updates.demoWebhookUrl = body.demoWebhookUrl || null;

      await db().update(slackSettings).set(updates);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Slack Settings POST]", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
