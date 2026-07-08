/**
 * Fire an internal Slack notification by rule key. Resolves the @mentions (rep and/or
 * Gage) per the rule's recipients, interpolates its editable message, and posts to the
 * sales channel. Best-effort: never throws into the caller. No-op if the rule is disabled
 * or Slack is unconfigured.
 */
import { getRule } from "@/lib/notifications/store";
import { postToSalesChannel, slackMentionForEmail, slackMentionForRep } from "@/lib/proposals/slack-notify";

const GAGE_EMAIL = "gage@krackedretention.com";
const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(TOKEN_RE, (_m, token: string) => values[token] ?? "");
}

export interface DispatchCtx {
  values: Record<string, string>;
  rep?: { name?: string | null; email?: string | null } | null;
}

/** Send the notification for `key`. Returns true if a message was posted. */
export async function dispatchNotification(key: string, ctx: DispatchCtx): Promise<boolean> {
  try {
    const rule = await getRule(key);
    if (!rule || !rule.enabled) return false;

    const mentions: string[] = [];
    if ((rule.recipients === "rep" || rule.recipients === "both") && ctx.rep) {
      mentions.push(await slackMentionForRep(ctx.rep.name, ctx.rep.email));
    }
    if (rule.recipients === "gage" || rule.recipients === "both") {
      mentions.push(await slackMentionForEmail(GAGE_EMAIL, "Gage"));
    }

    const prefix = mentions.length ? `${mentions.join(" ")} ` : "";
    const body = interpolate(rule.messageTemplate, ctx.values);
    return await postToSalesChannel(`${prefix}${body}`);
  } catch (e) {
    console.error(`[notifications] dispatch(${key}) failed:`, e);
    return false;
  }
}
