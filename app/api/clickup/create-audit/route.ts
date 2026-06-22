import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audits } from "@/lib/db/schema";
import { getSessionUserId } from "@/lib/auth/session";

const AUDIT_LIST_ID = process.env.CLICKUP_AUDIT_LIST_ID ?? "901702704831";
const API_TOKEN = process.env.CLICKUP_API_TOKEN ?? "";

// Custom field IDs on the Account Audits list
const F_WEBSITE = "fe6077f6-5765-4274-86ca-a7b1cfb275e2";
const F_ESP = "33c8c870-f69f-479d-8afe-f32ba5399e2c";
const F_MANAGEMENT = "3365be59-635f-4025-8540-8693eb9f315d";
const F_FLOWS = "4fc07da0-02c3-4662-b68f-140d5d111a15";
const F_HIRO = "399b31e1-db0f-473b-84e5-a9222fa779b3";
const F_DETAILS = "3058399b-172c-40be-b822-b018ff77f18a";
const F_STRATEGIST = "30f53c02-ff18-4ea1-bc6f-f854eb7ee5f9";
const F_REVIEWER = "2fe786c4-f298-4921-ad90-c8a2634f250c";
const F_CLIENT_CONTACT = "6c634ac6-4a3b-491a-bbf8-a5ef2fa49482";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const { brandName, website, esp, management, flows, hiroPull, details, strategist, reviewer, clientContact, ghlContactId } = body;

  if (!brandName?.trim()) {
    return NextResponse.json({ error: "Brand name is required" }, { status: 400 });
  }

  const customFields: Array<{ id: string; value: unknown }> = [];

  if (website?.trim()) customFields.push({ id: F_WEBSITE, value: website.trim() });
  if (esp) customFields.push({ id: F_ESP, value: esp });
  if (management) customFields.push({ id: F_MANAGEMENT, value: management });
  if (flows) customFields.push({ id: F_FLOWS, value: flows });
  if (hiroPull) customFields.push({ id: F_HIRO, value: hiroPull });
  if (details?.trim()) customFields.push({ id: F_DETAILS, value: details.trim() });

  // Single-user field: value is the user ID (integer)
  if (strategist) customFields.push({ id: F_STRATEGIST, value: strategist });

  // Multi-user fields: value is array of user IDs
  if (reviewer?.length) customFields.push({ id: F_REVIEWER, value: reviewer });
  if (clientContact?.length) customFields.push({ id: F_CLIENT_CONTACT, value: clientContact });

  const res = await fetch(`https://api.clickup.com/api/v2/list/${AUDIT_LIST_ID}/task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: API_TOKEN,
    },
    body: JSON.stringify({ name: brandName.trim(), custom_fields: customFields }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[create-audit] ClickUp error:", errText);
    return NextResponse.json({ error: "Failed to create audit in ClickUp" }, { status: 502 });
  }

  const data = await res.json();

  // Mirror the audit into our DB so the contacts list + "Audit delivered" filter
  // can track it. Non-fatal: the ClickUp task is the source of truth, so a DB
  // failure here must not fail the request (a daily cron can still reconcile).
  try {
    const createdBy = await getSessionUserId();
    await db()
      .insert(audits)
      .values({
        clickupTaskId: String(data.id),
        ghlContactId: ghlContactId?.trim() || null,
        brandName: brandName.trim(),
        website: website?.trim() || null,
        details: details?.trim() || null,
        status: "requested",
        createdBy: createdBy ?? null,
      })
      .onConflictDoNothing({ target: audits.clickupTaskId });
  } catch (err) {
    console.error("[create-audit] failed to record audit in DB:", err);
  }

  return NextResponse.json({ id: data.id, url: data.url }, { status: 201 });
}
