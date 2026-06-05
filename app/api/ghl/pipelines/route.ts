import { NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLPipeline } from "@/lib/ghl/types";
import { db } from "@/lib/db";
import { localPipelines } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Read from local DB first
    const rows = await db()
      .select()
      .from(localPipelines)
      .orderBy(asc(localPipelines.name));

    if (rows.length > 0) {
      const pipelines: GHLPipeline[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        // stages is stored as jsonb — cast to the expected shape
        stages: (row.stages as Array<{ id: string; name: string; position?: number }>) ?? [],
        locationId: locationId(),
      }));
      return NextResponse.json({ pipelines });
    }

    // Fallback: local DB is empty, hit GHL live
    console.log("[GET /api/ghl/pipelines] local DB empty, falling back to GHL");
    const data = await ghl.get<{ pipelines: GHLPipeline[] }>(
      `/opportunities/pipelines?locationId=${locationId()}`
    );
    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/ghl/pipelines]", err);
    return NextResponse.json({ error: "Failed to fetch pipelines" }, { status: 500 });
  }
}
