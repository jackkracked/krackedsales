import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";
import { DEMO_LINK_CUSTOM_FIELD_ID } from "@/lib/ghl/custom-fields";
import { deriveWebsite } from "@/lib/ghl/qualification";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { localContacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GHL custom field ID for eCommerce website URL (legacy lead-form field).
// Still written on PATCH so a manually-saved website reads back from the same place.
export const WEBSITE_CUSTOM_FIELD_ID = "te2hH1PWliUW8R18epQn";


/** Accepts any absolute http(s) URL. Empty string means "clear it", which is allowed. */
function validDemoLink(v: string): boolean {
  if (v === "") return true;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

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
  // Writes to the live CRM — require a logged-in user (was previously unauthenticated).
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { contactId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
  const website = str(body.website);
  const email = str(body.email);

  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // Whitelist of editable fields → GHL v2 payload (street is `address1` in GHL).
  const payload: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  const set = (bodyKey: string, ghlKey: string, localKey: string) => {
    const v = str(body[bodyKey]);
    if (v !== undefined) { payload[ghlKey] = v; local[localKey] = v || null; }
  };
  set("firstName", "firstName", "firstName");
  set("lastName", "lastName", "lastName");
  set("email", "email", "email");
  set("phone", "phone", "phone");
  set("website", "website", "website");
  set("companyName", "companyName", "companyName");
  set("address", "address1", "address");
  set("city", "city", "city");
  set("state", "state", "state");
  set("country", "country", "country");
  if (Array.isArray(body.tags)) {
    const tags = body.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean);
    payload.tags = tags;
    local.tags = tags;
  }
  // Keep fullName in sync locally when a name part changes.
  if ("firstName" in local || "lastName" in local) {
    local.fullName = [str(body.firstName), str(body.lastName)].filter(Boolean).join(" ") || null;
  }

  // Demo Link is a custom-field-only write, so it is legal on its own with an empty `payload`.
  // `undefined` = not editing it; "" = clearing it (clears in GHL too, so the two never disagree).
  const demoLink = typeof body.demoLink === "string" ? body.demoLink.trim() : undefined;
  if (demoLink !== undefined && !validDemoLink(demoLink)) {
    return NextResponse.json({ error: "Enter a full link starting with http:// or https://" }, { status: 400 });
  }

  if (Object.keys(payload).length === 0 && demoLink === undefined) {
    return NextResponse.json({ error: "No fields provided" }, { status: 400 });
  }

  try {
    if (Object.keys(payload).length > 0) await ghl.put(`/contacts/${contactId}`, payload);

    // Deliberately OUTSIDE an isolated try/catch, unlike the website write below: if this
    // throws, the whole request fails and the UI reverts, because the user must never be
    // told a link saved when GHL never got it and the workflow never fired.
    if (demoLink !== undefined) {
      await ghl.put(`/contacts/${contactId}`, {
        customFields: [{ id: DEMO_LINK_CUSTOM_FIELD_ID, value: demoLink }],
      });
      // Record who pulled the trigger and when. GHL stores neither. Clearing wipes both, so a
      // stale author never outlives the link it belonged to.
      local.demoLinkSetBy = demoLink ? user.id : null;
      local.demoLinkSetAt = demoLink ? new Date() : null;

      // Merge the new value into the mirrored customFields too. Without this the panels would
      // read the OLD link from the mirror until the next GHL sync, up to six hours later. The
      // sync will re-write the identical value; this just stops the gap.
      try {
        const [row] = await db()
          .select({ customFields: localContacts.customFields })
          .from(localContacts)
          .where(eq(localContacts.id, contactId))
          .limit(1);
        const fields = Array.isArray(row?.customFields)
          ? (row.customFields as Array<{ id: string; value: string }>)
          : [];
        local.customFields = [
          ...fields.filter((f) => f?.id !== DEMO_LINK_CUSTOM_FIELD_ID),
          ...(demoLink ? [{ id: DEMO_LINK_CUSTOM_FIELD_ID, value: demoLink }] : []),
        ];
      } catch (e) {
        // Non-fatal: GHL already has the truth, the mirror just refreshes a few hours later.
        console.error("[PATCH /api/ghl/contacts/[id]] demo-link mirror merge failed:", e);
      }
    }
    // GHL READS website from a custom field (see GET → websiteRaw), not the top-level field
    // written above. Write that custom field too, so a saved website is read back correctly
    // (keeps the inbox "already on file" check accurate). Isolated try/catch so a custom-field
    // hiccup can never fail the email/phone save.
    if (website) {
      try {
        await ghl.put(`/contacts/${contactId}`, {
          customFields: [{ id: WEBSITE_CUSTOM_FIELD_ID, value: website }],
        });
      } catch (e) {
        console.error("[PATCH /api/ghl/contacts/[id]] website custom-field write failed:", e);
      }
    }
    // Keep the local mirror fresh so the inbox list + panel reflect the edit immediately
    // (before the next GHL sync). Best-effort; never fails the save.
    if (Object.keys(local).length > 0) {
      try {
        await db().update(localContacts).set({ ...local, updatedAt: new Date() }).where(eq(localContacts.id, contactId));
      } catch (e) {
        console.error("[PATCH /api/ghl/contacts/[id]] local mirror update failed:", e);
      }
    }
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
    // Legacy raw value (kept for the inbox "already on file" check).
    const websiteRaw =
      fields.find((f) => f.id === WEBSITE_CUSTOM_FIELD_ID)?.value ?? null;
    // Resolved, form-agnostic website: standard field → legacy CF → any URL-ish CF.
    // (Note fallback happens client-side where notes are already fetched.)
    const website = deriveWebsite(contact);

    return NextResponse.json({ contact, website, websiteRaw });
  } catch (err) {
    console.error("[GET /api/ghl/contacts/[id]]", err);
    return NextResponse.json({ contact: null, websiteRaw: null }, { status: 500 });
  }
}
