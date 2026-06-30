import { FollowUpsClient } from "@/components/follow-ups/follow-ups-client";

export const metadata = { title: "Follow-ups — Kracked Sales" };

export default function FollowUpsPage() {
  return (
    <div className="flex flex-col h-full p-6 gap-4 overflow-hidden">
      <div className="shrink-0">
        <h1
          data-r10n-followup-page-title
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Follow-ups
        </h1>
        <p data-r10n-followup-page-sub className="text-sm text-muted-foreground mt-0.5">
          AI-powered follow-up for every lead in your pipeline
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <FollowUpsClient />
      </div>
    </div>
  );
}
