import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { slackSettings, socialLeads } from "@/lib/db/schema";
import { createBoardFromDemo } from "@/lib/demo-boards/create";
import { promoteMetaLeadToGhl, type MetaPlatform } from "@/lib/leads/promote-meta-lead";
import { getSessionUser } from "@/lib/auth/session";

const META_PLATFORMS: MetaPlatform[] = ["instagram", "facebook", "tiktok"];

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

    console.log("[demo webhook] posting to:", webhookUrl);

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });

    const responseText = await res.text().catch(() => "");
    console.log("[demo webhook] n8n status:", res.status, "body:", responseText);

    if (!res.ok) {
      return NextResponse.json(
        { error: `n8n returned ${res.status}`, detail: responseText },
        { status: 502 }
      );
    }

    // Auto-create the demo board for this prospect. Non-fatal: a board-create
    // failure must never break the demo request that already succeeded in n8n.
    let boardToken: string | null = null;
    try {
      const board = await createBoardFromDemo(body);
      boardToken = board.token;
    } catch (boardErr) {
      console.error("[demo webhook] board auto-create failed:", boardErr);
    }

    // Meta/TikTok conversation → promote to a REAL GHL lead (AD funnel, Demo In
    // Progress, source-tagged) + mirror locally. Only fires when opened from a Meta
    // conversation (Lead Platform set) and there's no existing GHL opportunity. Non-fatal:
    // a promotion failure must never break the demo that already succeeded in n8n.
    let metaLeadCreated = false;
    const platform = String(body["Lead Platform"] ?? "").toLowerCase();
    const hasExistingOpp = !!String(body["Opportunity ID"] ?? "").trim();
    // This route is public (Meta inbound webhooks share the /api/webhooks/ prefix), so
    // gate the GHL lead creation behind a real session — the demo modal is always used by
    // a logged-in rep. Prevents anonymous GHL contact/opportunity spam.
    const sessionUser = await getSessionUser();
    if (sessionUser && (META_PLATFORMS as string[]).includes(platform) && !hasExistingOpp) {
      try {
        const name = String(
          body["Contact Name"] || body["Brand Name"] || body["Social Media Handle"] || "Lead",
        ).trim();
        const email = String(body["Email"] ?? "").trim() || null;
        const phone = String(body["Phone"] ?? "").trim() || null;
        const website = String(body["Website"] ?? "").trim() || null;
        const source = String(body["Lead Source"] ?? "") || platform;

        const { contactId, opportunityId } = await promoteMetaLeadToGhl({
          name, email, phone, website, platform: platform as MetaPlatform, source,
        });

        const commentLeadId = String(body["Comment Lead ID"] ?? "").trim();
        if (commentLeadId) {
          // Existing comment lead → promote it (this is what makes it count as a lead).
          await db()
            .update(socialLeads)
            .set({ demoStartedAt: new Date(), ghlContactId: contactId, ghlOpportunityId: opportunityId })
            .where(eq(socialLeads.id, commentLeadId));
        } else {
          // DM (no comment lead row yet) → create the local mirror so it follows the
          // same dedup + attribution path as comment leads.
          await db().insert(socialLeads).values({
            name,
            platform,
            commentText: "(Direct message)",
            keyword: "dm",
            commenterId: String(body["Participant ID"] ?? "") || null,
            email, phone, website,
            demoStartedAt: new Date(),
            ghlContactId: contactId,
            ghlOpportunityId: opportunityId,
          });
        }
        metaLeadCreated = true;
      } catch (metaErr) {
        console.error("[demo webhook] meta lead promotion failed:", metaErr);
      }
    }

    return NextResponse.json({ ok: true, boardToken, metaLeadCreated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[demo webhook] fetch threw:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
