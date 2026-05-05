import { PipelineClient } from "@/components/pipeline/pipeline-client";

export const metadata = { title: "Pipeline — Kracked Sales" };

export default function PipelinePage() {
  return (
    <div className="flex flex-col h-full p-6 gap-4 overflow-hidden">
      <div>
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Pipeline
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Live view of your GoHighLevel pipeline
        </p>
      </div>

      <PipelineClient />
    </div>
  );
}
