/**
 * Turn a stored email template + a values map into a finished, branded email.
 *
 * - Body tokens are interpolated with HTML-ESCAPED values (client data can't inject markup).
 * - Subject tokens are interpolated raw but newline-stripped (no email header injection).
 * - The call-to-action button is appended structurally from (ctaLabel, ctaUrl) so the
 *   client always has a working action; it is never part of the freeform body.
 * - The whole thing is wrapped in the shared branded shell (logo, cream frame, footer).
 *
 * Used identically for the live editor preview (sample values, a placeholder ctaUrl)
 * and for real sends (resolved values, the real sign/pay URL).
 */
import { emailShell, ctaButton } from "@/lib/email/resend";
import { escapeHtml } from "@/lib/reminders/variables";

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function fillTokens(tpl: string, values: Record<string, string>, opts: { escape: boolean }): string {
  return tpl.replace(TOKEN_RE, (_m, token: string) => {
    const raw = values[token] ?? "";
    return opts.escape ? escapeHtml(raw) : raw.replace(/[\r\n]+/g, " ").trim();
  });
}

export interface RenderableTemplate {
  subject: string;
  bodyTemplate: string;
  ctaLabel: string;
}

export interface RenderResult {
  subject: string;
  html: string;
}

export function renderEmail(
  template: RenderableTemplate,
  values: Record<string, string>,
  opts: { ctaUrl: string | null },
): RenderResult {
  const subject = fillTokens(template.subject, values, { escape: false });
  let body = fillTokens(template.bodyTemplate, values, { escape: true });

  const label = fillTokens(template.ctaLabel, values, { escape: true }).trim();
  if (label && opts.ctaUrl) {
    body += ctaButton(opts.ctaUrl, label);
  }

  return { subject, html: emailShell(body) };
}
