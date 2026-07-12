/**
 * The actual new-client list behind the Realized-CAC count, so a sceptical founder can click
 * the number and verify it (VP-Product trust anchor). Same §6.3 rule: deduped, first-ever
 * paid, management + project. Admin-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { newClientsInWindow } from "@/lib/unit-economics/clients";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const w = Number(req.nextUrl.searchParams.get("window"));
  const windowDays = [30, 60, 90].includes(w) ? w : 30;
  const now = new Date();
  const start = new Date(now.getTime() - windowDays * 86_400_000);

  const clients = (await newClientsInWindow(start, now)).map((c) => ({
    name: c.contactName || "Unknown",
    acquiredAt: c.acquiredAt.toISOString(),
    firstType: c.firstType,
    firstAmount: c.firstAmount,
  }));
  return NextResponse.json({ window: windowDays, count: clients.length, clients });
}
