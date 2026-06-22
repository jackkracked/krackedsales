import { slackConfig } from "./integration-config";

/**
 * Thin Slack adapter for demo boards, aligned to Gage's two-channel setup: design
 * notifications (new request, ready-for-QA, prospect comments) go to the DESIGN
 * channel; sales outcomes (sent, booked) go to the SALES channel. Each posts to the
 * matching incoming webhook; a safe no-op when that webhook isn't set. Never throws —
 * a Slack outage must not break a board action. Copy lives in `integration-config.ts`.
 */
type Channel = "design" | "sales";

async function post(text: string, channel: Channel): Promise<void> {
  const url = channel === "sales" ? slackConfig.salesWebhookUrl() : slackConfig.designWebhookUrl();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[slack-adapter]", err);
  }
}

export const notifySlack = {
  newDemoRequest: (brand: string, emailType: string, pageUrl: string, taskUrl: string) =>
    post(slackConfig.messages.newDemoRequest(brand, emailType, pageUrl, taskUrl), "design"),
  readyForReview: (client: string, rep: string, url: string) =>
    post(slackConfig.messages.readyForReview(client, rep, url), "design"),
  prospectCommented: (client: string, snippet: string, url: string) =>
    post(slackConfig.messages.prospectCommented(client, snippet, url), "design"),
  sentToClient: (client: string, channel: string) =>
    post(slackConfig.messages.sentToClient(client, channel), "sales"),
  booked: (client: string, rep: string) => post(slackConfig.messages.booked(client, rep), "sales"),
};
