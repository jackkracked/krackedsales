import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { getSessionUser } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { firstName, lastName, email, phone, website, pipelineId, stageId, source, monetaryValue } = body;

  if (!firstName?.trim()) {
    return NextResponse.json({ error: "firstName is required" }, { status: 400 });
  }

  try {
    // Create the contact in GHL
    const { contact } = await ghl.post<{ contact: { id: string } }>("/contacts", {
      firstName: firstName.trim(),
      lastName: lastName?.trim() || undefined,
      email: email?.trim() || undefined,
      phone: phone?.trim() || undefined,
      website: website?.trim() || undefined,
      locationId: locationId(),
    });

    // If pipeline info provided, also create an opportunity
    let opportunity = null;
    if (pipelineId && stageId) {
      const oppRes = await ghl.post<{ opportunity: { id: string } }>("/opportunities", {
        pipelineId,
        pipelineStageId: stageId,
        locationId: locationId(),
        contactId: contact.id,
        name: `${firstName.trim()} ${(lastName ?? "").trim()}`.trim(),
        source: source || undefined,
        monetaryValue: monetaryValue ?? 0,
        status: "open",
      });
      opportunity = oppRes.opportunity;
    }

    return NextResponse.json(
      opportunity ? { contact, opportunity } : { contact },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create contact";
    console.error("[create-contact]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
