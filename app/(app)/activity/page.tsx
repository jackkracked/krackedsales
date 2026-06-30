import { getSessionUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { isNotNull } from "drizzle-orm";
import { ActivityFeed } from "@/components/activity/activity-feed";

export const metadata = { title: "Activity — Kracked Sales" };

export default async function ActivityPage() {
  const user = await getSessionUser().catch(() => null);
  if (!user) redirect("/login");

  // Fetch all team members for the rep filter (admin only needs this)
  const allUsers = user.role === "admin"
    ? await db()
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(isNotNull(users.id))
    : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="px-6 py-5 border-b border-border shrink-0">
        <h1
          data-r10n-activity-page-title
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Activity
        </h1>
        <p data-r10n-activity-page-sub className="text-sm text-muted-foreground mt-0.5">
          Every action across the team, in real time.
        </p>
      </div>

      {/* Feed — fills remaining height */}
      <div className="flex-1 min-h-0">
        <ActivityFeed reps={allUsers} currentUserRole={user.role} />
      </div>
    </div>
  );
}
