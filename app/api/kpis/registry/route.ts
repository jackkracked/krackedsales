import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { describeRegistry } from "@/lib/kpi/engine";
import { hydrateRegistry } from "@/lib/kpi/engine/hydrate";

export const dynamic = "force-dynamic";

// GET /api/kpis/registry — admin only.
// Returns the client-safe descriptor for every dataset so the configurator can
// build its dropdowns (datasets → fields → operators → aggregations → date fields).
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fill the async `enumValues` (users, GHL pipelines/stages, calendars) so the
    // configurator shows real options. Hydration self-degrades to empty dropdowns
    // on any failure and never throws, so a source outage can't 500 this route.
    const datasets = await hydrateRegistry(describeRegistry());

    return NextResponse.json({ datasets });
  } catch (err) {
    console.error("[GET /api/kpis/registry]", err);
    return NextResponse.json({ error: "Failed to load registry" }, { status: 500 });
  }
}
