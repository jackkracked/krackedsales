import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { slackSettings, socialLeads } from "@/lib/db/schema";
import { createBoardFromDemo } from "@/lib/demo-boards/create";
import { promoteMetaLeadToGhl, OpportunityLookupFailed, type MetaPlatform } from "@/lib/leads/promote-meta-lead";
import { getSessionUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/activity/logger";

const META_PLATFORMS: MetaPlatform[] = ["instagram", "facebook", "tiktok"];

export const dynamic = "force-dynamic";

const FALLBACK_WEBHOOK_URL =
  process.env.N8N_DEMO_WEBHOOK_URL ??
  "https://aiposnow.app.n8n.cloud/webhook/405581cc-3cc2-4cb2-a6a4-cc8ae63719e3";

export async function POST(req: NextRequest) {
  try {
    // AUTH FIRST. Despite living under /api/webhooks/, nothing external posts here: this is a
    // first-party endpoint used only by components/shared/create-demo-modal.tsx, and no GHL or
    // Meta signature is verified. The session gate used to sit further down, guarding only the
    // GHL block, which left an anonymous caller able to fire the production n8n workflow (telling
    // the design team to build a demo) and mint a public /board/[token] URL with attacker-supplied
    // contact details. Everything below now requires a real logged-in rep.
    const actor = await getSessionUser().catch(() => null);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    // WHO submitted this demo: resolved at the top of the handler now that auth gates the whole
    // route. Kelsey works the unresponsive list and creates demos all day; this is the only
    // record that it was her.

    let boardToken: string | null = null;
    try {
      const board = await createBoardFromDemo(body, actor?.id ?? null);
      boardToken = board.token;
    } catch (boardErr) {
      console.error("[demo webhook] board auto-create failed:", boardErr);
    }

    // The demo-created audit event. This, not demo_boards, is what the rep leaderboard counts:
    // the board is a side effect that can fail, the event is the fact that it happened.
    if (actor) {
      logActivity({
        userId: actor.id,
        userName: actor.name ?? actor.email,
        userEmail: actor.email,
        action: "demo.created",
        entityType: "contact",
        entityId: String(body["Contact ID"] ?? body["Comment Lead ID"] ?? body["Opportunity ID"] ?? "") || "unknown",
        entityName: String(body["Contact Name"] || body["Brand Name"] || "Demo").trim(),
        metadata: {
          emailType: String(body["Email Type"] ?? "") || null,
          leadPlatform: String(body["Lead Platform"] ?? "") || null,
          boardToken,
        },
      });
    }

    // Meta/TikTok conversation → promote to a REAL GHL lead (AD funnel, Demo In
    // Progress, source-tagged) + mirror locally. Only fires when opened from a Meta
    // conversation (Lead Platform set) and there's no existing GHL opportunity. Non-fatal:
    // a promotion failure must never break the demo that already succeeded in n8n.
    let metaLeadCreated = false;
    const platform = String(body["Lead Platform"] ?? "").toLowerCase();
    const hasExistingOpp = !!String(body["Opportunity ID"] ?? "").trim();
    // The contact id the app already holds. Its presence is what makes this safe: the promoter
    // reuses that contact instead of creating a second one.
    const knownContactId = String(body["Contact ID"] ?? "").trim() || null;
    const isSocial = (META_PLATFORMS as string[]).includes(platform);
    // This route is public (Meta inbound webhooks share the /api/webhooks/ prefix), so
    // gate the GHL lead creation behind a real session — the demo modal is always used by
    // a logged-in rep. Prevents anonymous GHL contact/opportunity spam.
    // Fires for a social DM (as before) OR for any contact the app submitted a demo for that has
    // no opportunity yet — Jack, 2026-08-24: "they're not a lead in any of the pipelines, then we
    // will create that opportunity". Duplicate protection lives in promoteMetaLeadToGhl.
    let promotionDeferred = false;
    const commentLeadId = String(body["Comment Lead ID"] ?? "").trim();
    if (!hasExistingOpp && (isSocial || knownContactId)) {
      try {
        const name = String(
          body["Contact Name"] || body["Brand Name"] || body["Social Media Handle"] || "Lead",
        ).trim();
        const email = String(body["Email"] ?? "").trim() || null;
        const phone = String(body["Phone"] ?? "").trim() || null;
        const website = String(body["Website"] ?? "").trim() || null;
        const source = String(body["Lead Source"] ?? "") || platform;
        const participantId = String(body["Participant ID"] ?? "").trim() || null;

        // ── Read back what we already promoted ────────────────────────────────────────────
        // The modal cannot supply a contact id from a DM or comment conversation (neither
        // carries one), so a SECOND demo for the same person would otherwise create a second
        // GHL contact. social_leads already records the ids from the first promotion; use them.
        let seedContactId = knownContactId;
        let alreadyPromoted: { contactId: string; opportunityId: string } | null = null;
        const priorRow = commentLeadId
          ? (await db().select({
              c: socialLeads.ghlContactId, o: socialLeads.ghlOpportunityId,
            }).from(socialLeads).where(eq(socialLeads.id, commentLeadId)).limit(1))[0]
          : participantId
          ? (await db().select({
              c: socialLeads.ghlContactId, o: socialLeads.ghlOpportunityId,
            }).from(socialLeads).where(and(
              eq(socialLeads.commenterId, participantId), eq(socialLeads.platform, platform),
            )).limit(1))[0]
          : undefined;
        if (priorRow?.c && priorRow?.o) alreadyPromoted = { contactId: priorRow.c, opportunityId: priorRow.o };
        else if (priorRow?.c) seedContactId = seedContactId ?? priorRow.c;

        const { contactId, opportunityId } = alreadyPromoted ?? await promoteMetaLeadToGhl({
          name, email, phone, website, source,
          platform: isSocial ? (platform as MetaPlatform) : null,
          existingContactId: seedContactId,
        });

        if (commentLeadId) {
          // Existing comment lead → promote it (this is what makes it count as a lead).
          await db()
            .update(socialLeads)
            .set({ demoStartedAt: new Date(), ghlContactId: contactId, ghlOpportunityId: opportunityId })
            .where(eq(socialLeads.id, commentLeadId));
        } else if (isSocial && !priorRow) {
          // DM (no comment lead row yet) → create the local mirror so it follows the
          // same dedup + attribution path as comment leads. Skipped for ordinary contacts:
          // social_leads is a social mirror and an email lead does not belong in it.
          await db().insert(socialLeads).values({
            name,
            platform,
            commentText: "(Direct message)",
            keyword: "dm",
            commenterId: participantId,
            email, phone, website,
            demoStartedAt: new Date(),
            ghlContactId: contactId,
            ghlOpportunityId: opportunityId,
          });
        }
        metaLeadCreated = true;
      } catch (metaErr) {
        // A lookup we could not complete is NOT evidence that no opportunity exists, so we
        // deliberately do not create one. The demo itself already succeeded in n8n; the rep is
        // told the pipeline entry is pending rather than silently getting a duplicate.
        if (metaErr instanceof OpportunityLookupFailed) {
          promotionDeferred = true;
          console.error("[demo webhook] promotion deferred, could not verify opportunities:", metaErr);
        } else {
          console.error("[demo webhook] meta lead promotion failed:", metaErr);
        }
      }
    }

    return NextResponse.json({ ok: true, boardToken, metaLeadCreated, promotionDeferred });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[demo webhook] fetch threw:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
