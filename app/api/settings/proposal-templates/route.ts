import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposalTemplates } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { getTemplateSections } from "@/lib/proposals/templates";
import { normalizeContent } from "@/lib/proposals/normalize";
import { defaultContentFor } from "@/lib/proposals/content";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getSessionUser().catch(() => null);
  return user?.role === "admin" ? user : null;
}

// GET: the current EFFECTIVE template copy for both proposal types.
// getTemplateSections falls back to code defaults when no row exists yet, so the
// editor always opens on the copy that would actually render on a new proposal.
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [management, project] = await Promise.all([
    getTemplateSections("management"),
    getTemplateSections("project"),
  ]);
  return NextResponse.json({ management, project });
}

// PATCH: upsert one proposal type's template copy. The body's sections are run
// through normalizeContent (length caps, type coercion, no HTML/script path)
// before they are persisted.
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req
    .json()
    .catch(() => ({}) as { type?: unknown; sections?: unknown });

  const type = body.type;
  if (type !== "management" && type !== "project") {
    return NextResponse.json(
      { error: 'type must be "management" or "project"' },
      { status: 400 },
    );
  }

  const clean = normalizeContent(body.sections, defaultContentFor(type));

  await db()
    .insert(proposalTemplates)
    .values({ type, sections: clean, updatedBy: admin.id, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: proposalTemplates.type,
      set: { sections: clean, updatedBy: admin.id, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true, sections: clean });
}
