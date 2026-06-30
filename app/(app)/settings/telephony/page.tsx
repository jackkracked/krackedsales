import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { TelephonySettings } from "@/components/dialer/telephony-settings";

export const metadata = { title: "Telephony — Kracked Sales" };

export default async function TelephonySettingsPage() {
  const user = await getSessionUser().catch(() => null);

  if (user?.role !== "admin") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-[10px] border border-border bg-card p-6 text-center">
          <h1
            className="text-base font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Admins only
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Telephony settings are managed by an administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Link
          href="/settings?tab=integrations"
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to settings
        </Link>

        <header className="mb-6">
          <h1
            className="text-2xl font-bold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Telephony
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Connect Twilio to turn on the in-app dialer for your team.
          </p>
        </header>

        <TelephonySettings />
      </div>
    </div>
  );
}
