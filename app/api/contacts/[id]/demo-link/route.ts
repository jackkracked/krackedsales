import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { localContacts, users } from "@/lib/db/schema";
import { DEMO_LINK_CUSTOM_FIELD_ID } from "@/lib/ghl/custom-fields";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * The Demo Link for a contact: GHL's "Insert Miro Link" custom field, plus who set it.
 *
 * NOT to be confused with the sibling `demo-links` (plural) route, which surfaces the
 * ClickUp demo task and its PSD/Figma board. That one is read-only and sourced from ClickUp.
 * This one is the editable field that writes back to GHL and fires their workflow.
 *
 * Reads the MIRROR, not GHL live: every write goes through
 * PATCH /api/ghl/contacts/[contactId], which merges the new value into the mirror in the same
 * request. So the mirror is correct the instant a save returns, and this stays a single cheap
 * indexed row read even though seven surfaces call it.
 */
export interface DemoLink {
  /** The link, or null when the contact has none. */
  url: string | null;
  /** Who set it through this app. Null when it was set inside GHL directly. */
  setByName: string | null;
  /** ISO timestamp of when it was set through this app, else null. */
  setAt: string | null;
}

const EMPTY: DemoLink = { url: null, setByName: null, setAt: null };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Returns CRM data (a client's board and who touched it), so it requires a session. The
  // sibling demo-links route predates that convention; this one follows the stricter one.
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [row] = await db()
      .select({
        customFields: localContacts.customFields,
        setAt: localContacts.demoLinkSetAt,
        setByName: users.name,
      })
      .from(localContacts)
      .leftJoin(users, eq(users.id, localContacts.demoLinkSetBy))
      .where(eq(localContacts.id, id))
      .limit(1);

    if (!row) return NextResponse.json(EMPTY);

    const fields = Array.isArray(row.customFields)
      ? (row.customFields as Array<{ id?: string; value?: unknown }>)
      : [];
    const raw = fields.find((f) => f?.id === DEMO_LINK_CUSTOM_FIELD_ID)?.value;
    const url = typeof raw === "string" && raw.trim() ? raw.trim() : null;

    // Attribution only means something while a link exists. A cleared link wipes both columns,
    // but a link replaced directly inside GHL would otherwise keep our stale author.
    return NextResponse.json({
      url,
      setByName: url ? row.setByName ?? null : null,
      setAt: url && row.setAt ? new Date(row.setAt).toISOString() : null,
    } satisfies DemoLink);
  } catch (err) {
    console.error("[GET /api/contacts/[id]/demo-link]", err);
    return NextResponse.json(EMPTY, { status: 500 });
  }
}
