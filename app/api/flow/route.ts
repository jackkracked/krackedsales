import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { flowNodes, flowEdges, replyTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [rawNodes, edges] = await Promise.all([
      db()
        .select({
          id:         flowNodes.id,
          type:       flowNodes.type,
          positionX:  flowNodes.positionX,
          positionY:  flowNodes.positionY,
          data:       flowNodes.data,
          templateId: flowNodes.templateId,
          body:       replyTemplates.body,
        })
        .from(flowNodes)
        .leftJoin(replyTemplates, eq(flowNodes.templateId, replyTemplates.id)),
      db().select().from(flowEdges),
    ]);

    // Merge the joined template body into node.data so the canvas can display it
    const nodes = rawNodes.map(({ body, ...node }) => ({
      ...node,
      data: { ...(node.data as object), body: body ?? undefined },
    }));

    return NextResponse.json({ nodes, edges });
  } catch (err) {
    console.error("[GET /api/flow]", err);
    return NextResponse.json({ error: "Failed to fetch flow" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { nodes, edges } = await req.json();

    // Upsert nodes
    if (nodes?.length) {
      await db()
        .insert(flowNodes)
        .values(nodes)
        .onConflictDoUpdate({
          target: flowNodes.id,
          set: {
            positionX: flowNodes.positionX,
            positionY: flowNodes.positionY,
            data: flowNodes.data,
            updatedAt: new Date(),
          },
        });
    }

    // Upsert edges
    if (edges?.length) {
      await db()
        .insert(flowEdges)
        .values(edges)
        .onConflictDoNothing();
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/flow]", err);
    return NextResponse.json({ error: "Failed to save flow" }, { status: 500 });
  }
}
