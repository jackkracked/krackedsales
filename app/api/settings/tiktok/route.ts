import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tiktokSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// ─── GET — return current TikTok connection status ───────────────────────────

export async function GET(_req: NextRequest) {
  try {
    const client = db();
    const rows = await client.select().from(tiktokSettings).limit(1);
    const row = rows[0] ?? null;

    if (!row) {
      return NextResponse.json({
        isConnected: false,
        openId: null,
        hasBusinessToken: false,
        advertiserId: null,
        accessTokenPreview: null,
        businessTokenPreview: null,
      });
    }

    return NextResponse.json({
      isConnected: row.openId !== null,
      openId: row.openId,
      hasBusinessToken: row.businessAccessToken !== null,
      advertiserId: row.advertiserId,
      // First 8 chars + "..." so the UI can confirm a token is set without exposing it
      accessTokenPreview: row.accessToken
        ? `${row.accessToken.slice(0, 8)}...`
        : null,
      businessTokenPreview: row.businessAccessToken
        ? `${row.businessAccessToken.slice(0, 8)}...`
        : null,
    });
  } catch (err) {
    console.error("[Settings /tiktok] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch TikTok settings" },
      { status: 500 }
    );
  }
}

// ─── POST — save Business API credentials ────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { businessAccessToken?: string; advertiserId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const client = db();
    const rows = await client.select().from(tiktokSettings).limit(1);

    if (rows.length > 0) {
      await client
        .update(tiktokSettings)
        .set({
          businessAccessToken: body.businessAccessToken ?? rows[0].businessAccessToken,
          advertiserId: body.advertiserId ?? rows[0].advertiserId,
          updatedAt: new Date(),
        })
        .where(eq(tiktokSettings.id, rows[0].id));
    } else {
      await client.insert(tiktokSettings).values({
        businessAccessToken: body.businessAccessToken ?? null,
        advertiserId: body.advertiserId ?? null,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Settings /tiktok] POST failed:", err);
    return NextResponse.json(
      { error: "Failed to save TikTok settings" },
      { status: 500 }
    );
  }
}
