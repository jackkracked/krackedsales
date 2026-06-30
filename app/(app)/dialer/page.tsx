import { getSessionUser } from "@/lib/auth/session";
import { DialerClient } from "@/components/dialer/dialer-client";

export const metadata = { title: "Dialer — Kracked Sales" };

export default async function DialerPage() {
  const user = await getSessionUser().catch(() => null);
  const role = user?.role === "admin" ? "admin" : "rep";
  const userName = user?.name ?? "You";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 px-6 pt-5 pb-4">
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Dialer
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Power-dial campaigns and manual calls, with full contact context and no navigating away
        </p>
      </header>
      <div className="min-h-0 flex-1 border-t border-border">
        <DialerClient role={role} userName={userName} />
      </div>
    </div>
  );
}
