import PusherServer from "pusher";

let _pusher: PusherServer | null = null;

export function getPusherServer(): PusherServer {
  if (_pusher) return _pusher;

  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    throw new Error("Pusher environment variables are not set");
  }

  _pusher = new PusherServer({ appId, key, secret, cluster, useTLS: true });
  return _pusher;
}

/** Trigger a Pusher event — used in webhook handlers */
export async function pusherTrigger(
  channel: string,
  event: string,
  data: unknown
) {
  try {
    const pusher = getPusherServer();
    await pusher.trigger(channel, event, data);
  } catch (err) {
    // Non-fatal — log and continue (polling fallback will catch up)
    console.error("[Pusher] Failed to trigger event:", err);
  }
}
