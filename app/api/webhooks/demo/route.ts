import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { slackSettings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const FALLBACK_WEBHOOK_URL =
  process.env.N8N_DEMO_WEBHOOK_URL ??
  "https://aiposnow.app.n8n.cloud/webhook/405581cc-3cc2-4cb2-a6a4-cc8ae63719e3";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Use the URL configured in Settings (so you can switch test ↔ prod without a redeploy)
    const rows = await db().select({ demoWebhookUrl: slackSettings.demoWebhookUrl }).from(slackSettings).limit(1);
    const webhookUrl = rows[0]?.demoWebhookUrl || FALLBACK_WEBHOOK_URL;

    // Send as form-encoded so n8n exposes fields at root $json level
    // (JSON bodies are nested under $json.body in n8n webhook nodes)
    const formBody = new URLSearchParams(
      Object.entries(body).map(([k, v]) => [k, String(v ?? "")])
    );

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[demo webhook] n8n responded", res.status, text);
      return NextResponse.json({ error: "Webhook failed" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[demo webhook]", err);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
