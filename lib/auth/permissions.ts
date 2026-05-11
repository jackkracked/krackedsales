import { db } from "@/lib/db";
import { rolePermissions, userPermissionOverrides } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { FEATURES, type FeatureKey } from "./permission-constants";

export { FEATURES, FEATURE_LABELS, type FeatureKey } from "./permission-constants";

/**
 * Check if a user has access to a feature.
 * Per-user overrides take precedence over the role preset.
 */
export async function can(
  userId: string,
  role: string,
  featureKey: FeatureKey
): Promise<boolean> {
  const [override] = await db()
    .select({ enabled: userPermissionOverrides.enabled })
    .from(userPermissionOverrides)
    .where(
      and(
        eq(userPermissionOverrides.userId, userId),
        eq(userPermissionOverrides.featureKey, featureKey)
      )
    )
    .limit(1);

  if (override !== undefined) return override.enabled;

  const [preset] = await db()
    .select({ enabled: rolePermissions.enabled })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.role, role),
        eq(rolePermissions.featureKey, featureKey)
      )
    )
    .limit(1);

  if (preset === undefined) return role === "admin";
  return preset.enabled;
}

/** Fetch the full permission map for a user (all features → enabled/disabled). */
export async function getUserPermissions(
  userId: string,
  role: string
): Promise<Record<FeatureKey, boolean>> {
  const [presets, overrides] = await Promise.all([
    db()
      .select({ featureKey: rolePermissions.featureKey, enabled: rolePermissions.enabled })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, role)),
    db()
      .select({ featureKey: userPermissionOverrides.featureKey, enabled: userPermissionOverrides.enabled })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId)),
  ]);

  const result = {} as Record<FeatureKey, boolean>;

  for (const p of presets) {
    result[p.featureKey as FeatureKey] = p.enabled;
  }

  for (const o of overrides) {
    result[o.featureKey as FeatureKey] = o.enabled;
  }

  for (const f of FEATURES) {
    if (result[f] === undefined) {
      result[f] = role === "admin";
    }
  }

  return result;
}
