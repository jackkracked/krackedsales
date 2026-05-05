import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tiktokSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// ─── POST — clear TikTok OAuth tokens (keeps Business API credentials) ────────

export async function POST(_req: NextRequest) {
  try {
    const client = db();
    const rows = await client.select().from(tiktokSettings).limit(1);

    if (rows.length === 0) {
      // Nothing to disconnect
      return NextResponse.json({ ok: true });
    }

    await client
      .update(tiktokSettings)
      .set({
        openId: null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(tiktokSettings.id, rows[0].id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[TikTok /auth/disconnect] POST failed:", err);
    return NextResponse.json(
      { error: "Failed to disconnect TikTok account" },
      { status: 500 }
    );
  }
}
