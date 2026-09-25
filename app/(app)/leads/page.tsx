import { LeadsClient } from "@/components/leads/leads-client";

export const metadata = { title: "Leads — Kracked Sales" };
export const dynamic = "force-dynamic";

export default function LeadsPage() {
  return (
    <div className="flex flex-col h-full p-6 gap-4 overflow-hidden">
      <div>
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Leads
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Work every Meta lead and comment lead here — stage changes go straight to Facebook
        </p>
      </div>
      <LeadsClient />
    </div>
  );
}
