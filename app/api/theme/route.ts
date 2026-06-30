import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const THEME_COOKIE = "r10n_theme";

/**
 * POST /api/theme
 * Admin-only. Sets or clears the r10n theme cookie so the SSR layout can render
 * <html data-theme="r10n"> on the next load.
 * Body: { enabled: boolean }
 *
 * Non-admins get a 403 and the cookie is never touched, so they always stay on
 * the default theme.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let enabled: unknown;
  try {
    ({ enabled } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const cookieStore = await cookies();
  if (enabled) {
    cookieStore.set(THEME_COOKIE, "on", {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  } else {
    cookieStore.delete(THEME_COOKIE);
  }

  return NextResponse.json({ ok: true, enabled });
}
