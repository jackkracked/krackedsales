import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { keywordTriggers } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

// ─── GET — return all keyword triggers ───────────────────────────────────────

export async function GET(_req: NextRequest) {
  try {
    const client = await db();
    const keywords = await client
      .select()
      .from(keywordTriggers)
      .orderBy(desc(keywordTriggers.createdAt));

    return NextResponse.json({ keywords });
  } catch (err) {
    console.error("[Settings /keywords] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch keywords" },
      { status: 500 }
    );
  }
}

// ─── POST — create a new keyword trigger ─────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { keyword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body.keyword?.trim();
  if (!raw) {
    return NextResponse.json(
      { error: "keyword is required" },
      { status: 400 }
    );
  }

  // Store keywords lowercase for consistent matching
  const keyword = raw.toLowerCase();

  try {
    const client = await db();
    const [created] = await client
      .insert(keywordTriggers)
      .values({ keyword })
      .returning();

    return NextResponse.json({ keyword: created }, { status: 201 });
  } catch (err) {
    console.error("[Settings /keywords] POST failed:", err);
    return NextResponse.json(
      { error: "Failed to create keyword" },
      { status: 500 }
    );
  }
}
