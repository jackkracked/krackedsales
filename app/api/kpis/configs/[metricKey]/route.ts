import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { deleteConfig, getConfig } from "@/lib/kpi/engine";

export const dynamic = "force-dynamic";

// GET /api/kpis/configs/[metricKey] — admin only.
// Returns the saved config for one metric (or null if none is configured).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ metricKey: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { metricKey } = await params;
    if (!metricKey) {
      return NextResponse.json({ error: "Missing metricKey" }, { status: 400 });
    }

    const config = await getConfig(metricKey);
    return NextResponse.json({ config });
  } catch (err) {
    console.error("[GET /api/kpis/configs/[metricKey]]", err);
    return NextResponse.json({ error: "Failed to load config" }, { status: 500 });
  }
}

// DELETE /api/kpis/configs/[metricKey] — admin only.
// Removes a metric's config override. The engine then falls back to legacy compute (or 0).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ metricKey: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { metricKey } = await params;
    if (!metricKey) {
      return NextResponse.json({ error: "Missing metricKey" }, { status: 400 });
    }

    await deleteConfig(metricKey);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/kpis/configs/[metricKey]]", err);
    return NextResponse.json({ error: "Failed to delete config" }, { status: 500 });
  }
}
