import { cn } from "@/lib/utils/cn";
import { DemoTaskCard } from "./demo-task-card";
import type { EnrichedTask } from "@/app/api/clickup/tasks/route";
import type { DemoLinkData } from "@/app/api/demo-tracker/ghl-links/route";
import type { DemoBucket } from "@/lib/utils/demo-stage";

const BUCKET_CONFIG: Record<DemoBucket, { label: string; headerClass: string; dotClass: string }> = {
  IN_PROGRESS: {
    label: "In Progress",
    headerClass: "text-primary",
    dotClass: "bg-primary",
  },
  WAITING_TO_SEND: {
    label: "Waiting to Send",
    headerClass: "text-gold-foreground",
    dotClass: "bg-gold",
  },
  DEMO_SENT: {
    label: "Demo Sent",
    headerClass: "text-accent-green",
    dotClass: "bg-accent-green",
  },
};

interface DemoBucketProps {
  bucket: DemoBucket;
  tasks: EnrichedTask[];
  links?: Record<string, DemoLinkData>;
}

export function DemoBucketColumn({ bucket, tasks, links = {} }: DemoBucketProps) {
  const config = BUCKET_CONFIG[bucket];

  return (
    <div className="flex flex-col min-w-[280px] flex-1 min-h-0" data-r10n-demo-column data-r10n-demo-bucket={bucket}>
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3 px-1 shrink-0" data-r10n-demo-column-header>
        <span className={cn("w-2 h-2 rounded-full shrink-0", config.dotClass)} data-r10n-demo-column-dot data-r10n-demo-bucket={bucket} />
        <span className={cn("text-sm font-semibold", config.headerClass)} data-r10n-demo-column-title>
          {config.label}
        </span>
        <span className="ml-auto text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full" data-r10n-demo-column-count>
          {tasks.length}
        </span>
      </div>

      {/* Scrollable task list */}
      <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 pr-1">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-[10px]" data-r10n-demo-column-empty>
            No demos here
          </div>
        ) : (
          tasks.map((task) => (
            <DemoTaskCard key={task.id} task={task} link={links[task.id]} />
          ))
        )}
      </div>
    </div>
  );
}
