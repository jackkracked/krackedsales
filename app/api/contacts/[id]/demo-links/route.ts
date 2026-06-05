import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { demoGhlLinks } from "@/lib/db/schema";
import { clickup } from "@/lib/clickup/client";
import type { ClickUpTask } from "@/lib/clickup/types";

export const dynamic = "force-dynamic";

export interface DemoLinks {
  /** The linked ClickUp demo task. */
  clickupUrl: string | null;
  /** The Miro / PSD-Figma board from the demo task's "PSD/Figma" custom field. */
  miroUrl: string | null;
  /** Reserved for when the audit feature is wired up. Always null for now. */
  auditUrl: string | null;
}

const EMPTY: DemoLinks = { clickupUrl: null, miroUrl: null, auditUrl: null };

/**
 * Surface the demo's Miro board + ClickUp task for a contact, so the team can
 * reach them from the opportunity view instead of digging through ClickUp.
 * Resolves contact (GHL id) -> demo_ghl_links -> ClickUp task -> "PSD/Figma" field.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [link] = await db()
      .select({ clickupTaskId: demoGhlLinks.clickupTaskId })
      .from(demoGhlLinks)
      .where(eq(demoGhlLinks.ghlContactId, id))
      .limit(1);

    if (!link) return NextResponse.json(EMPTY);

    // Always have a usable ClickUp deep link, even if the task fetch fails.
    let clickupUrl: string | null = `https://app.clickup.com/t/${link.clickupTaskId}`;
    let miroUrl: string | null = null;

    try {
      const task = await clickup.get<ClickUpTask>(`/task/${link.clickupTaskId}`);
      if (task.url) clickupUrl = task.url;
      const miroField = task.custom_fields?.find(
        (f) => f.name.toLowerCase() === "psd/figma"
      );
      if (typeof miroField?.value === "string" && miroField.value.trim()) {
        miroUrl = miroField.value.trim();
      }
    } catch (e) {
      // ClickUp unreachable — still return the constructed deep link.
      console.error("[demo-links] ClickUp task fetch failed:", e);
    }

    return NextResponse.json({ clickupUrl, miroUrl, auditUrl: null } satisfies DemoLinks);
  } catch (err) {
    console.error("[GET /api/contacts/[id]/demo-links]", err);
    return NextResponse.json(EMPTY, { status: 500 });
  }
}
