import { getSessionUser } from "@/lib/auth/session";
import { RemindersClient } from "@/components/reminders/reminders-client";

export const metadata = { title: "Reminders — Kracked Sales" };

export default async function RemindersPage() {
  const user = await getSessionUser().catch(() => null);

  if (user?.role !== "admin") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-[10px] border border-border bg-card p-6 text-center">
          <h1 className="text-base font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Admins only
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Client emails and reminders are managed by an administrator.
          </p>
        </div>
      </div>
    );
  }

  return <RemindersClient />;
}
