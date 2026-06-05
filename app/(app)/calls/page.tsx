import { CallsClient } from "@/components/calls/calls-client";

export const metadata = { title: "Calls — Kracked Sales" };

export default function CallsPage() {
  return (
    <div className="flex flex-col h-full p-6 gap-4 overflow-hidden">
      <div>
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Calls
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Scheduled appointments, Google Meet sessions, and GHL dialer calls across all reps
        </p>
      </div>
      <CallsClient />
    </div>
  );
}
