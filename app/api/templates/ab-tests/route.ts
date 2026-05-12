import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { loadABStats } from "@/lib/ab-testing";
import { db } from "@/lib/db";
import { abTestResults } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** GET /api/templates/ab-tests — live A/B stats + historical winners */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [groups, history] = await Promise.all([
      loadABStats(),
      db()
        .select()
        .from(abTestResults)
        .orderBy(desc(abTestResults.detectedAt))
        .limit(20),
    ]);

    return NextResponse.json({ groups, history });
  } catch (err) {
    console.error("[GET /api/templates/ab-tests]", err);
    return NextResponse.json({ error: "Failed to load A/B data" }, { status: 500 });
  }
}
