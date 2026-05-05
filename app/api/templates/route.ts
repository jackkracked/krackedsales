import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { replyTemplates, templateSends, templateResponses, templateConversions } from "@/lib/db/schema";
import { eq, desc, gte, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const templates = await db()
      .select()
      .from(replyTemplates)
      .orderBy(replyTemplates.priority, replyTemplates.createdAt);

    // Stats for each template
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const stats = await Promise.all(
      templates.map(async (t) => {
        const [sendCount] = await db()
          .select({ count: sql<number>`count(*)::int` })
          .from(templateSends)
          .where(eq(templateSends.templateId, t.id));

        const [send30dCount] = await db()
          .select({ count: sql<number>`count(*)::int` })
          .from(templateSends)
          .where(eq(templateSends.templateId, t.id));

        // Response count (joins through sends)
        const [responseCount] = await db()
          .select({ count: sql<number>`count(*)::int` })
          .from(templateResponses)
          .innerJoin(templateSends, eq(templateResponses.sendId, templateSends.id))
          .where(eq(templateSends.templateId, t.id));

        const [convCount] = await db()
          .select({ count: sql<number>`count(*)::int` })
          .from(templateConversions)
          .innerJoin(templateSends, eq(templateConversions.sendId, templateSends.id))
          .where(eq(templateSends.templateId, t.id));

        const sends = sendCount?.count ?? 0;
        const responses = responseCount?.count ?? 0;
        const conversions = convCount?.count ?? 0;

        return {
          templateId: t.id,
          sends,
          sends30d: send30dCount?.count ?? 0,
          responses,
          conversions,
          responseRate: sends > 0 ? responses / sends : 0,
          conversionRate: sends > 0 ? conversions / sends : 0,
        };
      })
    );

    const withStats = templates.map((t, i) => ({ ...t, stats: stats[i] }));
    return NextResponse.json({ templates: withStats });
  } catch (err) {
    console.error("[GET /api/templates]", err);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const [template] = await db()
      .insert(replyTemplates)
      .values({
        name: body.name,
        body: body.body,
        conditions: body.conditions ?? [],
        abGroup: body.abGroup ?? null,
        weight: body.weight ?? 100,
        priority: body.priority ?? 0,
        active: body.active ?? true,
      })
      .returning();

    return NextResponse.json({ template });
  } catch (err) {
    console.error("[POST /api/templates]", err);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}
