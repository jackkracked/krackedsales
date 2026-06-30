import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { dialerCampaigns, dialerCampaignReps, dialerCampaignContacts, users } from "@/lib/db/schema";
import { and, or, eq, ne, desc, inArray, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/dialer/campaigns — campaigns the current user can work.
 * Admin sees all; a rep sees campaigns they're assigned to or created.
 * Each row carries assigned reps + per-status contact counts.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = user.role === "admin";

  try {
    let campaigns: (typeof dialerCampaigns.$inferSelect)[];
    if (isAdmin) {
      campaigns = await db().select().from(dialerCampaigns)
        .where(ne(dialerCampaigns.status, "archived"))
        .orderBy(desc(dialerCampaigns.createdAt));
    } else {
      const mine = await db().selectDistinct({ id: dialerCampaigns.id }).from(dialerCampaigns)
        .leftJoin(dialerCampaignReps, eq(dialerCampaignReps.campaignId, dialerCampaigns.id))
        .where(and(
          ne(dialerCampaigns.status, "archived"),
          or(eq(dialerCampaignReps.userId, user.id), eq(dialerCampaigns.createdBy, user.id)),
        ));
      const ids = mine.map((m) => m.id);
      campaigns = ids.length
        ? await db().select().from(dialerCampaigns).where(inArray(dialerCampaigns.id, ids)).orderBy(desc(dialerCampaigns.createdAt))
        : [];
    }

    const ids = campaigns.map((c) => c.id);
    if (!ids.length) return NextResponse.json({ campaigns: [] });

    const [repRows, countRows] = await Promise.all([
      db().select({ campaignId: dialerCampaignReps.campaignId, userId: users.id, name: users.name })
        .from(dialerCampaignReps).innerJoin(users, eq(users.id, dialerCampaignReps.userId))
        .where(inArray(dialerCampaignReps.campaignId, ids)),
      db().select({ campaignId: dialerCampaignContacts.campaignId, status: dialerCampaignContacts.status, count: sql<number>`count(*)::int` })
        .from(dialerCampaignContacts).where(inArray(dialerCampaignContacts.campaignId, ids))
        .groupBy(dialerCampaignContacts.campaignId, dialerCampaignContacts.status),
    ]);

    const repsByCampaign = new Map<string, { userId: string; name: string }[]>();
    for (const r of repRows) {
      const a = repsByCampaign.get(r.campaignId) ?? [];
      a.push({ userId: r.userId, name: r.name });
      repsByCampaign.set(r.campaignId, a);
    }
    const countsByCampaign = new Map<string, Record<string, number>>();
    for (const r of countRows) {
      const m = countsByCampaign.get(r.campaignId) ?? {};
      m[r.status] = r.count;
      countsByCampaign.set(r.campaignId, m);
    }

    const result = campaigns.map((c) => {
      const m = countsByCampaign.get(c.id) ?? {};
      const total = Object.values(m).reduce((s, n) => s + n, 0);
      return {
        id: c.id,
        name: c.name,
        ownerScope: c.ownerScope,
        maxAttempts: c.maxAttempts,
        status: c.status,
        reps: repsByCampaign.get(c.id) ?? [],
        counts: {
          queued: m.queued ?? 0,
          inProgress: m.in_progress ?? 0,
          completed: m.completed ?? 0,
          exhausted: m.exhausted ?? 0,
          suppressed: m.suppressed ?? 0,
          total,
        },
      };
    });
    return NextResponse.json({ campaigns: result });
  } catch (err) {
    console.error("[GET /api/dialer/campaigns]", err);
    return NextResponse.json({ error: "Failed to load campaigns" }, { status: 500 });
  }
}

/**
 * POST /api/dialer/campaigns — create a campaign.
 * Admin may assign any reps; a rep's campaign is locked to themselves.
 * Whitelisted body (no mass-assignment): { name, maxAttempts, repUserIds }.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = user.role === "admin";

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const maxAttempts = body.maxAttempts === 5 || body.maxAttempts === 7 ? body.maxAttempts : 3;

  let ownerScope: "admin" | "rep";
  let repIds: string[];
  if (isAdmin) {
    ownerScope = "admin";
    const requested = Array.isArray(body.repUserIds) ? body.repUserIds.filter((x): x is string => typeof x === "string") : [];
    // Only keep ids that are real users (avoids FK errors / bad input).
    const valid = requested.length ? await db().select({ id: users.id }).from(users).where(inArray(users.id, requested)) : [];
    repIds = valid.map((u) => u.id);
    if (!repIds.length) repIds = [user.id];
  } else {
    ownerScope = "rep";
    repIds = [user.id];
  }

  try {
    const [camp] = await db().insert(dialerCampaigns)
      .values({ name: name.slice(0, 160), createdBy: user.id, ownerScope, maxAttempts })
      .returning();
    await db().insert(dialerCampaignReps)
      .values(repIds.map((uid) => ({ campaignId: camp.id, userId: uid })))
      .onConflictDoNothing();
    return NextResponse.json({
      campaign: { id: camp.id, name: camp.name, maxAttempts: camp.maxAttempts, ownerScope: camp.ownerScope, status: camp.status },
    });
  } catch (err) {
    console.error("[POST /api/dialer/campaigns]", err);
    return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
  }
}
