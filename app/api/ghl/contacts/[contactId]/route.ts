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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;

  try {
    // GHL v2 returns the contact directly, not wrapped in { contact: ... }
    const contact = await ghl.get<GHLContactV2>(`/contacts/${contactId}`);

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
