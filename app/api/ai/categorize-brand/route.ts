import { NextRequest, NextResponse } from "next/server";
import { categorizeBrand } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { brandCategories } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Strip HTML tags and collapse whitespace to plain text */
function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

export async function POST(req: NextRequest) {
  try {
    const { website } = await req.json();
    if (!website) return NextResponse.json({ error: "website required" }, { status: 400 });

    const url = website.startsWith("http") ? website : `https://${website}`;
    const domain = url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];

    // ── Return cached result if already analyzed ──────────────────────────────
    const { eq } = await import("drizzle-orm");
    const cached = await db()
      .select({ category: brandCategories.category, reason: brandCategories.reason })
      .from(brandCategories)
      .where(eq(brandCategories.domain, domain))
      .limit(1);
    if (cached[0]?.category) {
      return NextResponse.json({ category: cached[0].category, reason: cached[0].reason ?? "" });
    }

    // Fetch homepage with a 6s timeout
    let content = "";
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KrackedBot/1.0)" },
      });
      clearTimeout(timer);
      if (res.ok) {
        const html = await res.text();
        content = extractText(html);
      }
    } catch {
      // Site unreachable — proceed with domain name only
    }

    const result = await categorizeBrand({ domain, content });

    // Persist to DB so the KPI dtc-count endpoint can read categories server-side
    if (result.category) {
      await db().insert(brandCategories).values({
        domain,
        category: result.category,
        reason: result.reason ?? null,
      }).onConflictDoUpdate({
        target: brandCategories.domain,
        set: { category: result.category, reason: result.reason ?? null, analyzedAt: new Date() },
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[categorize-brand]", err);
    return NextResponse.json({ error: "Failed to categorize" }, { status: 500 });
  }
}
