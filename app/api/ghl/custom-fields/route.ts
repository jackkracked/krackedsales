import { NextResponse } from "next/server";
import { getCustomFieldMap } from "@/lib/ghl/custom-fields";

export const dynamic = "force-dynamic";

/**
 * GET /api/ghl/custom-fields
 *
 * Returns all custom field definitions as { fields: Record<id, { name, fieldKey, folder }> }
 * Used by the frontend to resolve field IDs to human-readable names.
 */
export async function GET() {
  try {
    const map = await getCustomFieldMap();
    const fields: Record<string, { name: string; fieldKey: string; folder?: string }> = {};
    for (const [id, def] of map) {
      fields[id] = { name: def.name, fieldKey: def.fieldKey, folder: def.folder };
    }
    return NextResponse.json({ fields });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/ghl/custom-fields]", message);
    return NextResponse.json({ fields: {}, error: message }, { status: 500 });
  }
}
