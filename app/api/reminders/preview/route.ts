import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { renderEmail } from "@/lib/reminders/render";
import { PREVIEW_SCENARIOS } from "@/lib/reminders/variables";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://kracked-sales.vercel.app";

/**
 * Render the CURRENT (possibly unsaved) editor content with sample data, so the live
 * preview shows exactly what a client would see. Server-side so it reuses the real
 * branded shell + escaping; the client renders the returned html inside a sandboxed
 * iframe. Admin-only, pure (no writes).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const subject = typeof body.subject === "string" ? body.subject : "";
  const bodyTemplate = typeof body.bodyTemplate === "string" ? body.bodyTemplate : "";
  const ctaLabel = typeof body.ctaLabel === "string" ? body.ctaLabel : "";
  const isInvoice = body.key === "invoice_reminder";

  const scenario = PREVIEW_SCENARIOS.find((s) => s.id === body.scenarioId) ?? PREVIEW_SCENARIOS[0];
  const ctaUrl = isInvoice ? "https://buy.stripe.com/sample" : `${APP_URL}/p/sample`;

  const { subject: renderedSubject, html } = renderEmail({ subject, bodyTemplate, ctaLabel }, scenario.values, { ctaUrl });
  return NextResponse.json({ subject: renderedSubject, html });
}
