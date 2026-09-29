import { db } from "@/lib/db";
import { proposals, slackSettings, users } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { amountBlockLabel } from "@/lib/proposals/billing";
import { routeToCloser } from "@/lib/proposals/credit";

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

/** "$6,000", whole-dollar when even, else 2dp. */
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
    // Unknown currency code, fall back to a plain number so we never crash a notification.
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

/** Label for the money collected right now: a deposit, the first month, or a one-off. */
function paidNowLabel(p: Pick<ProposalRow, "hasDeposit" | "paymentStructure">): string {
  if (p.hasDeposit) return "Deposit";
  if (p.paymentStructure === "subscription") return "First month";
  return "Paid";
}

/**
 * How much actually changes hands NOW, which is not the same as the total value:
 *   - deposit deals    => the deposit collected (what cleared, else the intended deposit)
 *   - everything else  => the first/only charge (totalAmount)
 * e.g. a $3,500/mo retainer taken with a $1,750 deposit => "now" is $1,750, value is $3,500/mo.
 */
function amountPaidNow(p: Pick<ProposalRow, "hasDeposit" | "depositsPaidTotal" | "depositTotal" | "totalAmount">): number {
  if (p.hasDeposit) {
    const cleared = p.depositsPaidTotal ?? 0;
    if (cleared > 0) return cleared;
    return p.depositTotal ?? p.totalAmount;
  }
  return p.totalAmount;
}

/**
 * Pure Slack mrkdwn builder, no side effects, so the test harness can render the
 * exact real-world message. No em dashes anywhere (house style).
 *
 * Every message carries: who, the package, what was paid now, and the total value.
 */
export function buildProposalSlackMessage(
  kind: "signed" | "paid",
  data: {
    contactName: string;
    packageLabel: string; // e.g. "Monthly Retainer"
    paidLabel: string; // "Deposit" | "First month" | "Paid"
    amount: string; // paid now, e.g. "$1,750"
    value: string; // total value, e.g. "$3,500/mo"
    rep?: string | null;
  },
): string {
  const details = [
    `${data.paidLabel}: *${data.amount}*`,
    `Value: *${data.value}*`,
    data.rep ? `Rep: ${data.rep}` : "",
  ]
    .filter(Boolean)
    .join("   ·   ");

  const headline =
    kind === "signed"
      ? `🎉  *New signing*\n*${data.contactName}* signed a *${data.packageLabel}*`
      : `💰  *Payment received*\n*${data.contactName}*   ·   *${data.packageLabel}*`;

  return `${headline}\n${details}`;
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

/**
 * Resolve a real Slack mention (`<@U123>`) for an email via users.lookupByEmail, so a
 * nudge actually pings the person. Falls back to a plain "@name" when Slack is
 * unconfigured or the lookup fails, so the message still reads sensibly.
 */
export async function slackMentionForEmail(email: string, fallbackName: string): Promise<string> {
  const slack = await getEnabledSlack();
  if (!slack) return `@${fallbackName}`;
  const id = await slackUserIdFor(slack.botToken, email, fallbackName);
  return id ? `<@${id}>` : `@${fallbackName}`;
}

/**
 * Resolve a rep's Slack mention: try their email first (users.lookupByEmail), then fall
 * back to matching their NAME against the workspace directory (reps are named identically
 * in Slack). The directory is fetched once and cached per process. Returns a plain "@name"
 * only if Slack is unconfigured or nothing matches, so the message always reads sensibly.
 */
let _dirCache: { at: number; byName: Map<string, string> } | null = null;

async function slackDirectory(botToken: string): Promise<Map<string, string>> {
  if (_dirCache && Date.now() - _dirCache.at < 10 * 60 * 1000) return _dirCache.byName;
  const byName = new Map<string, string>();
  try {
    let cursor = "";
    for (let i = 0; i < 10; i++) {
      const url = `https://slack.com/api/users.list?limit=200${cursor ? `&cursor=${cursor}` : ""}`;
      const json = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } }).then((r) => r.json());
      if (!json.ok) break;
      for (const m of json.members ?? []) {
        if (m.deleted || m.is_bot) continue;
        const names = [m.profile?.real_name, m.profile?.display_name, m.real_name, m.name].filter(Boolean);
        for (const n of names) byName.set(String(n).trim().toLowerCase(), m.id);
      }
      cursor = json.response_metadata?.next_cursor || "";
      if (!cursor) break;
    }
  } catch { /* best effort */ }
  _dirCache = { at: Date.now(), byName };
  return byName;
}

export async function slackMentionForRep(name: string | null | undefined, email: string | null | undefined): Promise<string> {
  const slack = await getEnabledSlack();
  const fallback = `@${(name || "rep").split(" ")[0]}`;
  if (!slack) return fallback;
  if (email) {
    const byEmail = await slackMentionForEmail(email, name || "rep");
    if (byEmail.startsWith("<@")) return byEmail; // real id resolved
  }
  if (name) {
    const dir = await slackDirectory(slack.botToken);
    const id = dir.get(name.trim().toLowerCase());
    if (id) return `<@${id}>`;
  }
  return fallback;
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
 * Resolve a Slack user id for a person: try their email (users.lookupByEmail), then fall
 * back to matching their name against the workspace directory (exact, then first-name).
 * This matters because a teammate's Slack login can differ from their work email (e.g.
 * Gage's Slack is under a personal address). Null if nothing matches.
 */
async function slackUserIdFor(botToken: string, email?: string | null, name?: string | null): Promise<string | null> {
  if (email) {
    try {
      const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      const json = await res.json();
      if (json.ok && json.user?.id) return json.user.id as string;
    } catch { /* fall through to name match */ }
  }
  if (name) {
    const key = name.trim().toLowerCase();
    const dir = await slackDirectory(botToken);
    // Exact full-name match, else a first-name match ("Gage" -> "gage flesher"). The
    // trailing space guards against matching a substring inside a longer name.
    for (const [n, id] of dir) if (n === key || n.startsWith(`${key} `)) return id;
  }
  return null;
}

/**
 * Send a DIRECT MESSAGE to a person (resolved by email, then name). Opens (or reuses) the
 * IM via conversations.open, then posts to it. Returns true on success, false on ANY failure
 * so the caller can fall back to a channel post — an internal nudge is never silently dropped.
 * Requires the bot's `im:write` scope; without it conversations.open errors and we return
 * false (→ channel fallback).
 */
export async function sendSlackDM(person: { email?: string | null; name?: string | null }, text: string): Promise<boolean> {
  const slack = await getEnabledSlack();
  if (!slack) return false;
  try {
    const userId = await slackUserIdFor(slack.botToken, person.email, person.name);
    if (!userId) return false;
    const open = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: { Authorization: `Bearer ${slack.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ users: userId }),
    }).then((r) => r.json());
    if (!open.ok || !open.channel?.id) {
      console.error("[slack-notify] conversations.open failed:", open.error);
      return false;
    }
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${slack.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: open.channel.id as string, text, unfurl_links: false }),
    }).then((r) => r.json());
    if (!res.ok) {
      console.error("[slack-notify] DM chat.postMessage failed:", res.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[slack-notify] sendSlackDM threw:", err);
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

    // The deal's CLOSER (the admin's choice, else the creator), falling back if they have left.
    let rep: string | null = null;
    const repId = await routeToCloser(p);
    if (repId) {
      const [u] = await db().select({ name: users.name }).from(users).where(eq(users.id, repId)).limit(1);
      rep = u?.name ?? null;
    }

    const text = buildProposalSlackMessage(kind, {
      contactName: p.contactName || "New client",
      packageLabel: amountBlockLabel(p),
      paidLabel: paidNowLabel(p),
      amount: formatMoney(amountPaidNow(p), p.currency),
      value: formatValue(p),
      rep,
    });

    await postToSalesChannel(text);
  } catch (err) {
    console.error(`[slack-notify] notifyProposalSlack(${kind}) failed:`, err);
  }
}
