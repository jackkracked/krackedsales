/**
 * Fire an internal Slack notification by rule key. Resolves the recipients (rep and/or
 * Gage) per the rule, interpolates its editable message, and either posts one channel
 * message that @-mentions them (default) or sends each a private DM (deliver: "dm").
 * Best-effort: never throws into the caller. No-op if the rule is disabled or Slack is
 * unconfigured.
 */
import { getRule } from "@/lib/notifications/store";
import { postToSalesChannel, sendSlackDM, slackMentionForEmail, slackMentionForRep } from "@/lib/proposals/slack-notify";

const GAGE_EMAIL = "gage@krackedretention.com";
// The owner (Jack) rides along on admin DM alerts so he has visibility they're firing.
const OWNER_EMAIL = "jack@krackedretention.com";
const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(TOKEN_RE, (_m, token: string) => values[token] ?? "");
}

export interface DispatchCtx {
  values: Record<string, string>;
  rep?: { name?: string | null; email?: string | null } | null;
  /**
   * "dm"      → private DM to each recipient (admin alerts also copy the owner). NEVER falls
   *             back to the sales channel — reps aren't in it and it must not be polluted; an
   *             unreachable recipient is logged, not broadcast.
   * "channel" → one channel post that @-mentions the recipients (default).
   */
  deliver?: "dm" | "channel";
}

interface Recipient {
  email: string | null;
  name: string | null;
  mention: string;
}

/** Send the notification for `key`. Returns true if at least one message was delivered. */
export async function dispatchNotification(key: string, ctx: DispatchCtx): Promise<boolean> {
  try {
    const rule = await getRule(key);
    if (!rule || !rule.enabled) return false;
    const body = interpolate(rule.messageTemplate, ctx.values);

    const adminIncluded = rule.recipients === "gage" || rule.recipients === "both";
    const recips: Recipient[] = [];
    if ((rule.recipients === "rep" || rule.recipients === "both") && ctx.rep) {
      recips.push({ email: ctx.rep.email ?? null, name: ctx.rep.name ?? null, mention: await slackMentionForRep(ctx.rep.name, ctx.rep.email) });
    }
    if (adminIncluded) {
      recips.push({ email: GAGE_EMAIL, name: "Gage", mention: await slackMentionForEmail(GAGE_EMAIL, "Gage") });
    }

    if (ctx.deliver === "dm") {
      // Owner rides along on admin alerts (DM only) for visibility.
      const targets: Recipient[] = [...recips];
      if (adminIncluded) targets.push({ email: OWNER_EMAIL, name: "Jack", mention: await slackMentionForEmail(OWNER_EMAIL, "Jack") });

      let delivered = false;
      for (const r of targets) {
        const ok = (r.email || r.name) ? await sendSlackDM({ email: r.email, name: r.name }, body) : false;
        if (ok) delivered = true;
        else console.warn(`[notifications] dispatch(${key}): couldn't DM ${r.name ?? r.email ?? "recipient"}; NOT posting to the channel`);
      }
      // Deliberately NO channel fallback: these reminders must never land in the sales
      // channel (reps aren't in it). An unreachable recipient is logged, not broadcast.
      return delivered;
    }

    const prefix = recips.map((r) => r.mention).join(" ");
    return await postToSalesChannel(`${prefix ? prefix + " " : ""}${body}`);
  } catch (e) {
    console.error(`[notifications] dispatch(${key}) failed:`, e);
    return false;
  }
}
