import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { listConfigs, upsertConfig, validateConfigInput } from "@/lib/kpi/engine";

export const dynamic = "force-dynamic";

// GET /api/kpis/configs — admin only.
// Lists every saved metric config (the override layer the engine drives from).
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const configs = await listConfigs();
    return NextResponse.json({ configs });
  } catch (err) {
    console.error("[GET /api/kpis/configs]", err);
    return NextResponse.json({ error: "Failed to load configs" }, { status: 500 });
  }
}

// POST /api/kpis/configs — admin only.
// Validates a config body (whitelist — no mass-assignment) then upserts it,
// scoped to the acting admin's user id.
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateConfigInput(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const config = await upsertConfig(validation.value, user.id);
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    console.error("[POST /api/kpis/configs]", err);
    return NextResponse.json({ error: "Failed to save config" }, { status: 500 });
  }
}
