import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, repTargets, rolePermissions, userPermissionOverrides } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import bcrypt from "bcryptjs";

/**
 * GET /api/settings/team
 * Returns all users with their role, targets, and permission overrides.
 */
export async function GET() {
  const [allUsers, allTargets, allOverrides, allPresets] = await Promise.all([
    db()
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        ghlUserId: users.ghlUserId,
        commissionPct: users.commissionPct,
        timezone: users.timezone,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.createdAt)),
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
  const body = await req.json();
  const { userId, role, isActive, ghlUserId, targets, permissionOverrides, name, email, newPassword, commissionPct, timezone } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  // Update user fields if provided
  const userUpdates: Partial<{ role: string; isActive: boolean; ghlUserId: string | null; name: string; email: string; passwordHash: string; commissionPct: number; timezone: string | null }> = {};
  if (role !== undefined) userUpdates.role = role;
  if (isActive !== undefined) userUpdates.isActive = isActive;
  if (ghlUserId !== undefined) userUpdates.ghlUserId = ghlUserId || null;
  if (name && typeof name === "string" && name.trim()) userUpdates.name = name.trim();
  if (email && typeof email === "string" && email.trim()) userUpdates.email = email.trim().toLowerCase();
  if (newPassword && typeof newPassword === "string" && newPassword.length >= 8) {
    userUpdates.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  if (commissionPct !== undefined && typeof commissionPct === "number" && commissionPct >= 0) {
    userUpdates.commissionPct = commissionPct;
  }
  if (timezone !== undefined) {
    userUpdates.timezone = timezone || null;
  }

  if (Object.keys(userUpdates).length > 0) {
    await db().update(users).set(userUpdates).where(eq(users.id, userId));
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
