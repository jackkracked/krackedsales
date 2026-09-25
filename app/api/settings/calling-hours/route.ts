import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dialerSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { REGIONS, STATUTORY, type CallingHoursConfig, type Region, type Window } from "@/lib/dialer/calling-hours";

export const dynamic = "force-dynamic";

/**
 * The calling-hours windows the dialer warns against.
 *
 * READABLE BY ANY REP, because the dialer itself has to apply them before every call. It is a
 * schedule, not a secret. WRITABLE BY ADMINS ONLY: these are the rules that keep the team on
 * the right side of the TCPA and the CRTC, and a rep widening their own window to call someone
 * at 11pm is precisely what this exists to prevent.
 */

const sameWindow = (a: Window, b: Window) =>
  a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1];

/** Half-hour steps between midnight and midnight. Anything else is a typo or an attack. */
function validWindow(v: unknown): v is Window {
  if (v === null) return true;
  if (!Array.isArray(v) || v.length !== 2) return false;
  const [open, close] = v;
  const half = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 24 && n * 2 === Math.round(n * 2);
  // A window must not close before it opens; an empty window would warn 24 hours a day and
  // read as the feature being broken rather than as a deliberate setting.
  return half(open) && half(close) && (close as number) > (open as number);
}

export async function GET() {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [row] = await db().select({ callingHours: dialerSettings.callingHours }).from(dialerSettings).limit(1);
  return NextResponse.json({
    callingHours: (row?.callingHours as CallingHoursConfig | null) ?? {},
    statutory: STATUTORY,
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can change calling hours" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { callingHours?: unknown; allowDisabling?: boolean };
  const incoming = body.callingHours;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return NextResponse.json({ error: "callingHours must be an object" }, { status: 400 });
  }

  // Validated key by key rather than trusted wholesale: this object is read by the dialer to
  // decide whether to warn, so a malformed entry silently disables the guard for that region.
  const clean: CallingHoursConfig = {};
  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    if (!REGIONS.includes(key as Region)) {
      return NextResponse.json({ error: `Unknown region "${key}"` }, { status: 400 });
    }
    const v = value as Record<string, unknown>;
    if (!v || typeof v !== "object") return NextResponse.json({ error: `Bad entry for ${key}` }, { status: 400 });
    for (const day of ["weekday", "saturday", "sunday"] as const) {
      // A 24-hour window does not "widen" the warning, it turns it off for that day. The owner
      // asked specifically that the guard never be disabled silently, so this has to be asked
      // for explicitly rather than arrived at by dragging a select to midnight.
      const w = v[day];
      if (Array.isArray(w) && w[0] === 0 && w[1] === 24 && !body.allowDisabling) {
        return NextResponse.json(
          { error: `${key} ${day}: midnight to midnight turns the warning off for that day. Confirm that is intended.`, needsConfirmation: true },
          { status: 400 },
        );
      }
      if (!validWindow(v[day])) {
        return NextResponse.json(
          { error: `${key} ${day}: a window must be two half-hour values with the close after the open, or empty for no calling` },
          { status: 400 },
        );
      }
    }
    const entry = {
      weekday: v.weekday as Window,
      saturday: v.saturday as Window,
      sunday: v.sunday as Window,
    };
    // A REGION LEFT AT THE LAW IS NOT STORED.
    //
    // The settings screen sends all five regions every time, so saving a 30-minute tweak to the
    // UK would otherwise freeze a snapshot of today's US, Canadian and Australian law into the
    // database. A later statutory change, or a fix to our own defaults, would then have no
    // effect in production and nobody would know why. Storing only genuine overrides keeps the
    // promise the migration makes: absent means "follow the law as shipped".
    const statutory = STATUTORY[key as Region];
    const unchanged =
      sameWindow(entry.weekday, statutory.weekday) &&
      sameWindow(entry.saturday, statutory.saturday) &&
      sameWindow(entry.sunday, statutory.sunday);
    if (!unchanged) clean[key as Region] = entry;
  }

  const [existing] = await db().select({ id: dialerSettings.id }).from(dialerSettings).limit(1);
  if (existing) {
    await db().update(dialerSettings)
      .set({ callingHours: clean, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(dialerSettings.id, existing.id));
  } else {
    await db().insert(dialerSettings).values({ callingHours: clean, updatedBy: user.id });
  }
  return NextResponse.json({ ok: true, callingHours: clean });
}
