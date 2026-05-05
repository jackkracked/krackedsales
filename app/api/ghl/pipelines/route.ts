import { NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLPipeline } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await ghl.get<{ pipelines: GHLPipeline[] }>(
      `/opportunities/pipelines?locationId=${locationId()}`
    );
    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/ghl/pipelines]", err);
    return NextResponse.json({ error: "Failed to fetch pipelines" }, { status: 500 });
  }
}
