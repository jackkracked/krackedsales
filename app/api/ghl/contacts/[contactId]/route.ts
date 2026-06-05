import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

// GHL custom field ID for eCommerce website URL (from lead form qualification)
export const WEBSITE_CUSTOM_FIELD_ID = "te2hH1PWliUW8R18epQn";

interface GHLContactV2 {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  // GHL v2 uses "customFields" (plural), v1 used "customField" (singular)
  customFields?: Array<{ id: string; value: string }>;
  customField?: Array<{ id: string; value: string }>;
  tags?: string[];
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;
  const body = await req.json();
  const { website, email, phone } = body as Record<string, string>;

  const payload: Record<string, string> = {};
  if (website) payload.website = website;
  if (email) payload.email = email;
  if (phone) payload.phone = phone;

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "No fields provided" }, { status: 400 });
  }

  try {
    await ghl.put(`/contacts/${contactId}`, payload);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/ghl/contacts/[id]]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;

  try {
    // GHL v2 returns { contact: { ... } } wrapper
    const data = await ghl.get<{ contact: GHLContactV2 }>(`/contacts/${contactId}`);
    const contact = data.contact ?? data;

    // Handle both v2 "customFields" (plural) and v1 "customField" (singular)
    const fields = contact.customFields ?? contact.customField ?? [];
    const websiteRaw =
      fields.find((f) => f.id === WEBSITE_CUSTOM_FIELD_ID)?.value ?? null;

    return NextResponse.json({ contact, websiteRaw });
  } catch (err) {
    console.error("[GET /api/ghl/contacts/[id]]", err);
    return NextResponse.json({ contact: null, websiteRaw: null }, { status: 500 });
  }
}
