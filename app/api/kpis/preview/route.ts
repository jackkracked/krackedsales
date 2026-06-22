import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { runDraft, validateConfigInput } from "@/lib/kpi/engine";
import type { EngineCtx, Range } from "@/lib/kpi/engine/types";

export const dynamic = "force-dynamic";

// ─── Date parsing ──────────────────────────────────────────────────────────────
// Mirrors parseRange() in app/api/kpis/metrics/route.ts, but reads from a plain
// object (the POST body) instead of URLSearchParams. Supports {start, end} (YYYY-MM-DD)
// or {period} (YYYY-MM). Returns null on anything malformed.
function parseRangeFromBody(body: {
  start?: unknown;
  end?: unknown;
  period?: unknown;
}): Range | null {
  const startParam = typeof body.start === "string" ? body.start : null;
  const endParam = typeof body.end === "string" ? body.end : null;
  if (startParam && endParam) {
    const start = new Date(startParam + "T00:00:00.000Z");
    const end = new Date(endParam + "T00:00:00.000Z");
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) return null;
    return { start, end };
  }

  const period = typeof body.period === "string" ? body.period : null;
  if (period) {
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
  }

  return null;
}

/** Sensible fallback window (current calendar month) when the caller sends no range. */
function defaultRange(): Range {
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

// POST /api/kpis/preview — admin only.
// Runs a DRAFT config against the chosen window and returns a thin preview.
// NO persistence — this powers the live preview in the configurator.
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: { config?: unknown; start?: unknown; end?: unknown; period?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Use the caller's window; fall back to the current month so a valid config
    // always previews (the live preview must never dead-end on a missing range).
    const range = parseRangeFromBody(body) ?? defaultRange();

    // Validate the draft before touching the engine. validateConfigInput is the
    // single source of truth for what a legal config looks like (no mass-assignment,
    // typed filters), so a malformed draft can never reach runDraft.
    const validation = validateConfigInput(body.config);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const ctx: EngineCtx = { isAdmin: true, userId: user.id };
    const result = await runDraft(validation.value, range, ctx);

    // Return only the display fields the engine produced — no raw integration objects.
    return NextResponse.json({
      value: result.value,
      count: result.rows.length,
      unit: result.unit,
      sampleRows: result.rows.slice(0, 5),
    });
  } catch (err) {
    console.error("[POST /api/kpis/preview]", err);
    return NextResponse.json({ error: "Failed to run preview" }, { status: 500 });
  }
}
