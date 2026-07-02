import { db } from "@/lib/db";
import { proposals, slackSettings, users } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Posts a celebratory message to #kracked-ai-sales (the channel configured in
 * slack_settings) whenever a proposal is signed or paid.
 *
 * Called from dispatchWorkflowEvent for "proposal.signed" / "proposal.paid", so it
 * rides every current and future sign/paid code path without touching the Stripe
 * webhook or the sign route. Fully fire-and-forget: it never throws into the caller.
 */

type ProposalRow = typeof proposals.$inferSelect;

const INTERVAL_SUFFIX: Record<string, string> = {
  day: "/day",
  week: "/wk",
  month: "/mo",
  quarter: "/qtr",
  year: "/yr",
};

/** "$6,000" — whole-dollar when even, else 2dp. */
function formatMoney(amount: number, currency: string): string {
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to a plain number so we never crash a notification.
    return `${whole ? amount.toLocaleString("en-US") : amount.toFixed(2)} ${(currency || "").toUpperCase()}`.trim();
  }
}

/** "$6,000/mo" for subscriptions, plain "$6,000" otherwise. */
function formatValue(p: Pick<ProposalRow, "totalAmount" | "currency" | "paymentStructure" | "billingInterval" | "billingIntervalCount">): string {
  const base = formatMoney(p.totalAmount, p.currency);
  if (p.paymentStructure !== "subscription") return base;
  const count = p.billingIntervalCount ?? 1;
  const interval = (p.billingInterval ?? "month").toLowerCase();
  if (count > 1) return `${base}/${count} ${interval}${count > 1 ? "s" : ""}`;
  return `${base}${INTERVAL_SUFFIX[interval] ?? `/${interval}`}`;
}

/**
 * Pure Slack mrkdwn builder — no side effects, so the test harness can render the
 * exact real-world message. No em dashes anywhere (house style).
 */
export function buildProposalSlackMessage(
  kind: "signed" | "paid",
  data: { contactName: string; title: string; value: string; amount: string; rep?: string | null },
): string {
  const repLine = data.rep ? `   ·   Rep: ${data.rep}` : "";
  if (kind === "signed") {
    return [
      "🎉  *New signing*",
      `*${data.contactName}* just signed`,
      `*${data.title}*`,
      `Value: ${data.value}${repLine}`,
    ].join("\n");
  }
  return [
    "💰  *Payment received*",
    `*${data.contactName}* paid *${data.amount}*`,
    `for *${data.title}*`,
    data.rep ? `Rep: ${data.rep}` : "",
  ].filter(Boolean).join("\n");
}

/** Read the single slack_settings row; returns null when Slack is unconfigured or disabled. */
async function getEnabledSlack(): Promise<{ botToken: string; channelId: string } | null> {
  const [s] = await db()
    .select({ botToken: slackSettings.botToken, channelId: slackSettings.channelId, enabled: slackSettings.enabled })
    .from(slackSettings)
    .limit(1);
  if (!s?.enabled || !s.botToken || !s.channelId) return null;
  return { botToken: s.botToken, channelId: s.channelId };
}

/** Post to Slack. Returns true on success; logs and returns false on any failure. */
export async function postToSalesChannel(text: string): Promise<boolean> {
  const slack = await getEnabledSlack();
  if (!slack) return false;
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${slack.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: slack.channelId, text, unfurl_links: false }),
    });
    const json = await res.json();
    if (!json.ok) {
      console.error("[slack-notify] chat.postMessage failed:", json.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[slack-notify] chat.postMessage threw:", err);
    return false;
  }
}

/**
 * Announce a signed/paid proposal. Never throws.
 * For "paid", a race-safe guard column ensures at-most-once delivery even though
 * several Stripe events can flip the same proposal to paid.
 */
export async function notifyProposalSlack(kind: "signed" | "paid", proposalId: string): Promise<void> {
  try {
    const [p] = await db().select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
    if (!p) return;

    // At-most-once for paid: claim the row before posting. If another event already
    // claimed it, this returns no rows and we skip.
    if (kind === "paid") {
      const claimed = await db()
        .update(proposals)
        .set({ slackPaidNotifiedAt: new Date() })
        .where(and(eq(proposals.id, proposalId), isNull(proposals.slackPaidNotifiedAt)))
        .returning({ id: proposals.id });
      if (claimed.length === 0) return;
    }

    let rep: string | null = null;
    if (p.createdBy) {
      const [u] = await db().select({ name: users.name }).from(users).where(eq(users.id, p.createdBy)).limit(1);
      rep = u?.name ?? null;
    }

    const text = buildProposalSlackMessage(kind, {
      contactName: p.contactName || "New client",
      title: p.title,
      value: formatValue(p),
      amount: formatMoney(p.totalAmount, p.currency),
      rep,
    });

    await postToSalesChannel(text);
  } catch (err) {
    console.error(`[slack-notify] notifyProposalSlack(${kind}) failed:`, err);
  }
}
