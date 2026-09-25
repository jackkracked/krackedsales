import { NextRequest, NextResponse } from "next/server";
import { runGuardedSweep } from "@/lib/ghl/guarded-sweep";

export const dynamic = "force-dynamic";
// A full sweep is ~39 GHL pages plus one call per delete candidate. 300 leaves headroom.
export const maxDuration = 300;

/**
 * The SCHEDULED pipeline parity sweep. Repairs the mirror; the sibling route only reads.
 *
 * Why this exists as its own path: Vercel's cron runner can only issue GET, and the two
 * entries in vercel.json used to point at `../reconcile-opportunities`, whose GET is the
 * cheap drift check. So the "twice daily sweep" the code promised had never once run, and
 * 17 ghosts accumulated over 16 days until someone opened /pipeline (2026-09-12).
 *
 * The alternative was making the sibling's GET mutate when a bearer token is present. That
 * overloads one URL with two behaviours differing by 39x in cost and by "reads nothing" vs
 * "soft-deletes production rows", switched by a header — and `usePipelineParity` GETs that
 * same URL on every page load. A separate path is unambiguous in the code and in the logs.
 *
 * Auth is the bearer secret ONLY, deliberately: no session fallback, so no logged-in user
 * can reach the expensive path here. Mirrors `app/api/cron/sync-ghl/route.ts`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // Check the secret EXISTS before comparing. Interpolating an unset env var compares against
  // the literal "Bearer undefined", which any anonymous caller could send — and proxy.ts waves
  // /api/cron/ straight through, so this route is the only thing standing in front of a job
  // that soft-deletes production rows.
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // `?ifStale=1` makes this entry respect the cooldown, so a RETRY slot does nothing when
  // the earlier run already succeeded. Without it the 20:30 entry would always run a second
  // full sweep half an hour after a perfectly good 20:00 one.
  const ifStale = req.nextUrl.searchParams.get("ifStale") === "1";
  // Otherwise the scheduled run is the mechanism of last resort and ignores the cooldown. It
  // still takes the lock, so it can never overlap a user-triggered sweep.
  return runGuardedSweep({
    dryRun: false,
    respectCooldown: ifStale,
    trigger: ifStale ? "cron:retry" : "cron",
  });
}
