import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getTemplate } from "@/lib/reminders/store";
import { renderEmail } from "@/lib/reminders/render";
import { PREVIEW_SCENARIOS } from "@/lib/reminders/variables";
import { sendRenderedEmail } from "@/lib/email/resend";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://kracked-sales.vercel.app";

/**
 * Send the admin a real copy of a template (rendered with sample data) to their own
 * inbox, so they can confirm exactly how it looks before it ever reaches a client.
 * Admin-only; always sends to the signed-in admin, never an arbitrary address.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = user as { role?: string; email?: string };
  if (u.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!u.email) return NextResponse.json({ error: "Your account has no email on file" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : null;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const template = await getTemplate(key);
  if (!template) return NextResponse.json({ error: "Unknown template" }, { status: 404 });

  const scenario = PREVIEW_SCENARIOS.find((s) => s.id === body.scenarioId) ?? PREVIEW_SCENARIOS[0];
  // A representative live URL so the button is real in the test email.
  const ctaUrl = template.key === "invoice_reminder" ? "https://buy.stripe.com/test_sample" : `${APP_URL}/p/sample-token`;

  const { subject, html } = renderEmail(template, scenario.values, { ctaUrl });
  try {
    const ok = await sendRenderedEmail(u.email, `[Test] ${subject}`, html);
    if (!ok) return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)" }, { status: 503 });
    return NextResponse.json({ ok: true, sentTo: u.email });
  } catch (e) {
    console.error("[reminders/test] send failed:", e);
    return NextResponse.json({ error: "Failed to send test email" }, { status: 502 });
  }
}
