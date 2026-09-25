import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { PACKAGE_TIERS } from "@/lib/packages/catalog";

export const dynamic = "force-dynamic";

/** GET /api/packages — the 90-Day Management package catalog for the proposal builder picker. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ packages: PACKAGE_TIERS });
}
