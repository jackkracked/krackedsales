import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, repTargets, rolePermissions, userPermissionOverrides } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getSessionUser } from "@/lib/auth/session";
import { editMonthSetting, getMonthSettings, recordDefaultChange } from "@/lib/tracker/settings";
import { currentNyMonth } from "@/lib/tracker/months";

/**
 * GET /api/settings/team
 * Admins get the full team management payload (roles, targets, commission, permission overrides,
 * role presets). Non-admins get only a minimal, non-sensitive roster (id/name/email/role/ghlUserId)
 * — enough for the Pipeline/Contacts assignee pickers, without leaking commission, targets, or
 * permission internals. PATCH/PUT are admin-only (see below), closing a self-escalation hole.
 */
export async function GET() {
  const actor = await getSessionUser().catch(() => null);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allUsers = await db()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      ghlUserId: users.ghlUserId,
      commissionPct: users.commissionPct,
      basePayCents: users.basePayCents,
      timezone: users.timezone,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  if (actor.role !== "admin") {
    // Minimal roster only — no commission, BASE PAY, targets, timezone, overrides, or presets.
    return NextResponse.json({
      users: allUsers.map((u) => ({
        id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, ghlUserId: u.ghlUserId,
      })),
    });
  }

  const [allTargets, allOverrides, allPresets] = await Promise.all([
    db().select().from(repTargets),
    db().select().from(userPermissionOverrides),
    db().select().from(rolePermissions),
  ]);

  const targetsMap = new Map(allTargets.map((t) => [t.userId, t]));
  const overridesMap = new Map<string, Record<string, boolean>>();

  for (const o of allOverrides) {
    if (!overridesMap.has(o.userId)) overridesMap.set(o.userId, {});
    overridesMap.get(o.userId)![o.featureKey] = o.enabled;
  }

  const presetsMap = new Map<string, Record<string, boolean>>();
  for (const p of allPresets) {
    if (!presetsMap.has(p.role)) presetsMap.set(p.role, {});
    presetsMap.get(p.role)![p.featureKey] = p.enabled;
  }

  const enriched = allUsers.map((u) => ({
    ...u,
    targets: targetsMap.get(u.id) ?? null,
    permissionOverrides: overridesMap.get(u.id) ?? {},
    rolePreset: presetsMap.get(u.role) ?? {},
  }));

  const rolePresets = Object.fromEntries(presetsMap.entries());

  return NextResponse.json({ users: enriched, rolePresets });
}

/**
 * PATCH /api/settings/team
 * Update a user's role, isActive, ghlUserId, targets, or permission overrides.
 */
export async function PATCH(req: NextRequest) {
  const actor = await getSessionUser().catch(() => null);
  if (actor?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { userId, role, isActive, ghlUserId, targets, permissionOverrides, name, email, newPassword, commissionPct, basePayCents, timezone } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  // Update user fields if provided
  const userUpdates: Partial<{ role: string; isActive: boolean; ghlUserId: string | null; name: string; email: string; passwordHash: string; commissionPct: number; basePayCents: number; timezone: string | null }> = {};
  if (role !== undefined) userUpdates.role = role;
  if (isActive !== undefined) userUpdates.isActive = isActive;
  if (ghlUserId !== undefined) userUpdates.ghlUserId = ghlUserId || null;
  if (name && typeof name === "string" && name.trim()) userUpdates.name = name.trim();
  if (email && typeof email === "string" && email.trim()) userUpdates.email = email.trim().toLowerCase();
  if (newPassword && typeof newPassword === "string" && newPassword.length >= 8) {
    userUpdates.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  if (commissionPct !== undefined && typeof commissionPct === "number" && commissionPct >= 0 && commissionPct <= 100) {
    userUpdates.commissionPct = commissionPct;
  }
  if (timezone !== undefined) {
    userUpdates.timezone = timezone || null;
  }
  // Whole cents only, and never negative: this is the floor of somebody's pay.
  if (basePayCents !== undefined && typeof basePayCents === "number" && Number.isFinite(basePayCents) && basePayCents >= 0) {
    userUpdates.basePayCents = Math.round(basePayCents);
  }

  if (Object.keys(userUpdates).length > 0) {
    await db().update(users).set(userUpdates).where(eq(users.id, userId));
  }

  // The pay tracker reads month settings, not these defaults, so a past month can never move
  // when a default changes. Record a real change as "from this month on". Only a CHANGE is
  // recorded: the team form sends every field on save, and marking unchanged values as edited
  // would put "edited by Jack" on numbers nobody touched. Base pay 0 means "not set" here.
  // Promoted to setter: they are owed $25 per booked call from this month, as in Kelsey's sheet,
  // unless a bonus is already set for them.
  if (userUpdates.role === "setter") {
    const current = await getMonthSettings(userId, currentNyMonth());
    if (current.bookingBonusCents === 0) {
      await editMonthSetting({ userId, month: currentNyMonth(), field: "bookingBonusCents", value: 2500, actorId: actor.id });
    }
  }
  if (userUpdates.commissionPct !== undefined || userUpdates.basePayCents !== undefined) {
    const current = await getMonthSettings(userId, currentNyMonth());
    const nextBase = userUpdates.basePayCents === undefined ? undefined : (userUpdates.basePayCents || null);
    await recordDefaultChange({
      userId,
      actorId: actor.id,
      basePayCents: nextBase !== undefined && nextBase !== current.basePayCents ? nextBase : undefined,
      commissionPct: userUpdates.commissionPct !== undefined && userUpdates.commissionPct !== current.commissionPct ? userUpdates.commissionPct : undefined,
    });
  }

  // Upsert targets if provided
  if (targets) {
    const existing = await db()
      .select({ id: repTargets.id })
      .from(repTargets)
      .where(eq(repTargets.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      await db()
        .update(repTargets)
        .set({
          dealsPerMonth: targets.dealsPerMonth,
          callsPerDay: targets.callsPerDay,
          revenueTarget: targets.revenueTarget,
          updatedAt: new Date(),
        })
        .where(eq(repTargets.userId, userId));
    } else {
      await db().insert(repTargets).values({
        userId,
        dealsPerMonth: targets.dealsPerMonth ?? 5,
        callsPerDay: targets.callsPerDay ?? 15,
        revenueTarget: targets.revenueTarget ?? 0,
      });
    }
  }

  // Replace permission overrides if provided
  if (permissionOverrides && typeof permissionOverrides === "object") {
    await db()
      .delete(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId));

    const entries = Object.entries(permissionOverrides) as [string, boolean][];
    if (entries.length > 0) {
      await db().insert(userPermissionOverrides).values(
        entries.map(([featureKey, enabled]) => ({ userId, featureKey, enabled }))
      );
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * PUT /api/settings/team/role-preset
 * Update the default permission preset for a role.
 * Body: { role: "admin" | "rep", permissions: Record<featureKey, boolean> }
 */
export async function PUT(req: NextRequest) {
  const actor = await getSessionUser().catch(() => null);
  if (actor?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { role, permissions } = await req.json();

  if (!role || !permissions) {
    return NextResponse.json({ error: "role and permissions required" }, { status: 400 });
  }

  const entries = Object.entries(permissions) as [string, boolean][];

  await Promise.all(
    entries.map(([featureKey, enabled]) =>
      db()
        .insert(rolePermissions)
        .values({ role, featureKey, enabled })
        .onConflictDoUpdate({
          target: [rolePermissions.role, rolePermissions.featureKey],
          set: { enabled },
        })
    )
  );

  return NextResponse.json({ ok: true });
}
