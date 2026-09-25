import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { checkOpportunityDrift } from "@/lib/ghl/reconcile-opportunities";
import { isRateLimit } from "@/lib/ghl/client";
import { runGuardedSweep, RECONCILE_LOCK_KEY } from "@/lib/ghl/guarded-sweep";
import { readJobState } from "@/lib/jobs/lock";

export const dynamic = "force-dynamic";
// A full sweep is ~39 GHL pages plus one call per delete candidate. 300 leaves headroom.
export const maxDuration = 300;

/**
 * Pipeline parity: the cheap check, and the expensive repair.
 *
 * GET  -> drift check ONLY. One GHL request, ~350ms, safe on every page load. Never mutates.
 * POST -> full reconcile, admin only. `?dryRun=1` computes the diff and changes nothing.
 *
 * The SCHEDULED sweep lives at `./sweep`, not here, because Vercel cron can only GET and this
 * GET must stay cheap — `usePipelineParity` calls it on every /pipeline mount.
 *
 * The board over-counts because `lib/ghl/sync.ts` can add and update but never remove, so
 * anything deleted in GHL lives in the mirror forever. Measured 2026-08-25: 23 ghosts, every
 * one a contact deletion that GHL cascaded to its opportunities.
 *
 * It lives under /api/cron/ because proxy.ts exempts that prefix from the login redirect and
 * expects the route to validate its own auth, which it does.
 */

export async function GET() {
  // Any signed-in user may ask "is the board honest?" — it is one cheap call.
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const drift = await checkOpportunityDrift();
    const state = await readJobState(RECONCILE_LOCK_KEY).catch(() => null);
    return NextResponse.json({
      ...drift,
      // Saves every rep's browser a POST that can only ever come back 403.
      canRepair: user.role === "admin",
      // Lets the board say "last verified 20 minutes ago" instead of sweeping to find out.
      lastRun: state
        ? { at: state.lastFinishedAt, status: state.lastStatus, detail: state.lastDetail }
        : null,
    });
  } catch (err) {
    console.error("[pipeline/reconcile GET]", err);
    // A failed check must never be reported as "in sync" — that would hide the very drift we
    // are looking for. Say plainly that we could not tell, and say WHY: this call uses the
    // default retry policy, so under rate limiting it is the FIRST thing to fail, before any
    // repair is attempted. Without classifying it here the board shows a red error on the one
    // path the incident actually takes.
    const rateLimited = isRateLimit(err);
    return NextResponse.json(
      {
        error: "Drift check failed",
        inSync: null,
        rateLimited,
        failureReason: rateLimited
          ? "GoHighLevel is rate-limiting us."
          : "Could not reach GoHighLevel.",
      },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  // The repair is ~39 GHL calls against a budget shared by the whole location, so it is not
  // something every session should be able to fire in a loop. Any logged-in user could
  // before, which is precisely the self-inflicted rate limiting behind the 2026-09-12
  // incident. Reps still get the cheap GET; repairs are an admin action or the cron's job.
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  return runGuardedSweep({ dryRun, respectCooldown: true, trigger: `user:${user.id}` });
}
