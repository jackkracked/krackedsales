import { NextRequest, NextResponse } from "next/server";
import { pusherTrigger } from "@/lib/pusher/server";
import { db } from "@/lib/db";
import { pipelineStageEvents, followupSends, bookingAutomationRules } from "@/lib/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import { notifyAdmins } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * GHL Webhook Receiver
 * Receives real-time events from GoHighLevel and:
 *  1. Pushes to Pusher so the browser invalidates TanStack Query keys
 *  2. Persists OpportunityStageUpdate events for tracked stages to the DB
 *     so KPI counts are 100% accurate regardless of future stage moves
 *
 * Register this URL in GHL → Settings → Webhooks
 * URL: https://<your-domain>/api/webhooks/ghl
 * Events to enable: OpportunityStageUpdate (+ others as needed)
 */

// Stage IDs we want to permanently record every entry for.
// Add more here as needed (e.g. "Intro Call (Booked)" if you want exact booked counts too).
const TRACKED_STAGE_IDS = new Set([
  "8ffee91a-402a-4591-84cd-2dcb0023fbaa", // Intro Call (No-Show) — AD FUNNEL
  "16b9d798-cfb8-4474-8a8b-f9b6a1acd6e6", // No-Show Intro — ORGANIC FUNNEL
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventType = body?.type ?? body?.event ?? "unknown";

    console.log("[GHL Webhook]", eventType, body?.id ?? "");

    // ── 1. Real-time Pusher broadcast ──────────────────────────────────────────

    if (
      eventType === "OpportunityCreate" ||
      eventType === "OpportunityUpdate" ||
      eventType === "OpportunityStageUpdate" ||
      eventType === "OpportunityStatusUpdate"
    ) {
      await pusherTrigger(
        "ghl-pipeline",
        eventType === "OpportunityCreate" ? "opportunity.created" : "opportunity.updated",
        { opportunityId: body?.opportunityId ?? body?.id }
      ).catch((err) => console.error("[GHL Webhook] Pusher error:", err));

      // New lead notification — dedup by opportunityId so duplicate webhooks don't spam
      if (eventType === "OpportunityCreate") {
        const oppId = body?.id ?? body?.opportunityId;
        const contactName = body?.contactName ?? body?.fullName ?? body?.name ?? "New lead";
        const monetaryValue = body?.monetaryValue ? ` — $${Number(body.monetaryValue).toLocaleString("en-US")}` : "";
        notifyAdmins(
          "new_lead",
          `New lead: ${contactName}${monetaryValue}`,
          body?.pipelineStageName ? `Stage: ${body.pipelineStageName}` : undefined,
          oppId ? `/pipeline` : undefined,
          oppId
        ).catch((err) => console.error("[GHL Webhook] notify error:", err));
      }
    }

    if (
      eventType === "InboundMessage" ||
      eventType === "OutboundMessage" ||
      eventType === "ConversationUnreadUpdate"
    ) {
      await pusherTrigger("ghl-inbox", "message.received", {
        conversationId: body?.conversationId,
        contactId: body?.contactId,
      }).catch((err) => console.error("[GHL Webhook] Pusher error:", err));
    }

    // ── 2. Persist stage entries for tracked stages ────────────────────────────

    if (eventType === "OpportunityStageUpdate") {
      const stageId      = body?.pipelineStageId ?? body?.stageId;
      const opportunityId = body?.id ?? body?.opportunityId;

      if (stageId && opportunityId && TRACKED_STAGE_IDS.has(stageId)) {
        const enteredAt = new Date(
          body?.dateUpdated ?? body?.dateAdded ?? body?.timestamp ?? Date.now()
        );

        // Deduplicate: skip if we already have an entry for this opp+stage within the last 24h
        // (GHL sometimes fires duplicate webhooks for the same event)
        const oneDayAgo = new Date(enteredAt.getTime() - 24 * 60 * 60 * 1000);
        const recent = await db()
          .select({ id: pipelineStageEvents.id })
          .from(pipelineStageEvents)
          .where(
            and(
              eq(pipelineStageEvents.opportunityId, opportunityId),
              eq(pipelineStageEvents.stageId, stageId),
              gte(pipelineStageEvents.enteredAt, oneDayAgo)
            )
          )
          .limit(1);

        if (recent.length === 0) {
          await db().insert(pipelineStageEvents).values({
            opportunityId,
            contactId:  body?.contactId ?? null,
            pipelineId: body?.pipelineId ?? null,
            stageId,
            stageName:  body?.pipelineStageName ?? body?.stageName ?? stageId,
            enteredAt,
            source:     "webhook",
          });
          console.log(`[GHL Webhook] Recorded stage entry: opp=${opportunityId} stage=${stageId}`);
        } else {
          console.log(`[GHL Webhook] Duplicate stage entry skipped for opp=${opportunityId}`);
        }
      }
    }

    // ── 3. Track inbound replies for follow-up contacts ───────────────────────
    // When a contact we've followed up with replies, mark the most recent send
    // as resultedInResponse so the UI knows they're warm.

    if (eventType === "InboundMessage") {
      const contactId = body?.contactId;
      if (contactId) {
        try {
          // Find the most recent outbound follow-up send for this contact
          const recent = await db()
            .select({ id: followupSends.id })
            .from(followupSends)
            .where(eq(followupSends.ghlContactId, contactId))
            .orderBy(desc(followupSends.sentAt))
            .limit(1);

          if (recent.length > 0) {
            await db()
              .update(followupSends)
              .set({ resultedInResponse: true })
              .where(eq(followupSends.id, recent[0].id));

            console.log(
              `[GHL Webhook] Marked follow-up send as replied for contact=${contactId}`
            );
          }
        } catch (e) {
          // Non-fatal — don't let this break the webhook response
          console.error("[GHL Webhook] Failed to mark follow-up reply:", e);
        }
      }
    }

    // ── 4. Booking automation — move opportunity stage on appointment events ──

    if (eventType === "AppointmentBooked" || eventType === "AppointmentUpdated") {
      const calendarId = body?.calendarId;
      const contactId  = body?.contactId;

      // Determine which trigger this event maps to
      let trigger: "call_booked" | "call_confirmed" | null = null;
      if (eventType === "AppointmentBooked") {
        trigger = "call_booked";
      } else if (eventType === "AppointmentUpdated" && body?.status === "confirmed") {
        trigger = "call_confirmed";
      }

      if (calendarId && contactId && trigger) {
        try {
          // Find active automation rules for this calendar + trigger
          const rules = await db()
            .select()
            .from(bookingAutomationRules)
            .where(
              and(
                eq(bookingAutomationRules.ghlCalendarId, calendarId),
                eq(bookingAutomationRules.trigger, trigger),
                eq(bookingAutomationRules.isActive, true)
              )
            );

          if (rules.length > 0) {
            // Find the contact's opportunity in GHL
            type OpportunitySearchResult = {
              opportunities: Array<{ id: string }>;
            };
            const searchResult = await ghl.get<OpportunitySearchResult>(
              `/opportunities/search?location_id=${locationId()}&contact_id=${contactId}`
            );
            const opportunity = searchResult.opportunities?.[0];

            if (!opportunity) {
              console.log(
                `[GHL Webhook] No opportunity found for contact=${contactId}, skipping booking automation`
              );
            } else {
              for (const rule of rules) {
                try {
                  await ghl.patch(`/opportunities/${opportunity.id}`, {
                    pipelineStageId: rule.stageId,
                  });
                  console.log(
                    `[GHL Webhook] Booking automation: moved opportunity=${opportunity.id} to stage=${rule.stageName} (trigger=${trigger}, calendar=${calendarId})`
                  );
                } catch (ruleErr) {
                  console.error(
                    `[GHL Webhook] Booking automation failed for rule=${rule.id} opportunity=${opportunity.id}:`,
                    ruleErr
                  );
                }
              }
            }
          }
        } catch (e) {
          // Non-fatal — don't let this break the webhook response
          console.error("[GHL Webhook] Booking automation error:", e);
        }
      } else {
        console.log(
          `[GHL Webhook] AppointmentUpdated skipped — status=${body?.status ?? "unknown"} (not confirmed)`
        );
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[GHL Webhook Error]", err);
    // Always return 200 so GHL doesn't retry unnecessarily
    return NextResponse.json({ received: true });
  }
}
