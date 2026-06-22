import { NextRequest, NextResponse } from "next/server";
import { pusherTrigger } from "@/lib/pusher/server";
import { syncBoardFromClickupTask } from "@/lib/demo-boards/clickup-sync";

export const dynamic = "force-dynamic";

/**
 * ClickUp Webhook Receiver
 * ClickUp sends a webhook secret in the X-Signature header.
 * Register this URL in ClickUp → Settings → Integrations → Webhooks
 * URL: https://<your-domain>/api/webhooks/clickup
 * Events: taskCreated, taskUpdated, taskStatusUpdated
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventType = body?.event ?? "unknown";

    console.log("[ClickUp Webhook]", eventType);

    if (
      eventType === "taskCreated" ||
      eventType === "taskUpdated" ||
      eventType === "taskStatusUpdated"
    ) {
      await pusherTrigger(
        "demos",
        eventType === "taskCreated" ? "task.created" : "task.updated",
        { taskId: body?.task_id }
      );

      // Demo Boards two-way sync: reflect a tracked board's task status back onto
      // the board + backfill the board-link field. Non-fatal — never breaks the
      // existing demo-tracker pusher flow above.
      try {
        await syncBoardFromClickupTask(body);
      } catch (syncErr) {
        console.error("[ClickUp Webhook] board sync failed:", syncErr);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[ClickUp Webhook Error]", err);
    return NextResponse.json({ received: true });
  }
}
