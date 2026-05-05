import { NextRequest, NextResponse } from "next/server";
import { pusherTrigger } from "@/lib/pusher/server";

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
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[ClickUp Webhook Error]", err);
    return NextResponse.json({ received: true });
  }
}
