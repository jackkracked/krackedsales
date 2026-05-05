export type DemoBucket = "IN_PROGRESS" | "WAITING_TO_SEND" | "DEMO_SENT";

/**
 * Maps a ClickUp status name to one of the three display buckets.
 * Based on actual DEMOS list statuses in ClickUp (confirmed with Jack, 2026-05-04):
 *
 * IN_PROGRESS:     Copy, Design, Copy Revision Needed, Design Revision Needed
 * WAITING_TO_SEND: Internal QA (done, awaiting sign-off before sending to client)
 * DEMO_SENT:       Scheduled/Live
 */
export function mapStageToBucket(status: string): DemoBucket {
  const s = status.toLowerCase().trim();

  // Demo Sent — delivered to client
  if (s === "scheduled/live" || s === "scheduled" || s === "live") {
    return "DEMO_SENT";
  }

  // Waiting to Send — production complete, awaiting sign-off
  if (s === "internal qa" || s === "internal qa review") {
    return "WAITING_TO_SEND";
  }

  // In Progress — active production stages
  const inProgressStages = [
    "copy",
    "design",
    "copy revision needed",
    "design revision needed",
  ];
  if (inProgressStages.includes(s)) {
    return "IN_PROGRESS";
  }

  // Default — treat unknown stages as in-progress so nothing is silently dropped
  return "IN_PROGRESS";
}

export const BUCKET_LABELS: Record<DemoBucket, string> = {
  IN_PROGRESS: "In Progress",
  WAITING_TO_SEND: "Waiting to Send",
  DEMO_SENT: "Demo Sent",
};

// Badge styles for each ClickUp status
export const STAGE_BADGE_STYLES: Record<string, { label: string; className: string }> = {
  "copy": { label: "Copy", className: "bg-blue-50 text-blue-700" },
  "design": { label: "Design", className: "bg-indigo-50 text-indigo-700" },
  "copy revision needed": { label: "Copy Rev.", className: "bg-amber-50 text-amber-700" },
  "design revision needed": { label: "Design Rev.", className: "bg-orange-50 text-orange-700" },
  "strategy revision needed": { label: "Strategy Rev.", className: "bg-yellow-50 text-yellow-700" },
  "strategist review": { label: "Strategist", className: "bg-purple-50 text-purple-700" },
  "ready for client review": { label: "Client Ready", className: "bg-teal-50 text-teal-700" },
  "client review": { label: "Client Review", className: "bg-cyan-50 text-cyan-700" },
  "client action needed": { label: "Action Needed", className: "bg-rose-50 text-rose-700" },
  "internal qa review": { label: "Internal QA", className: "bg-purple-50 text-purple-700" },
  "internal qa": { label: "Internal QA", className: "bg-purple-50 text-purple-700" },
  "scheduled/live": { label: "Scheduled/Live", className: "bg-green-50 text-green-700" },
  "scheduled": { label: "Scheduled", className: "bg-green-50 text-green-700" },
  "live": { label: "Live", className: "bg-emerald-50 text-emerald-700" },
};

export function getStageBadge(status: string): { label: string; className: string } {
  const key = status.toLowerCase().trim();
  return STAGE_BADGE_STYLES[key] ?? { label: status, className: "bg-muted text-muted-foreground" };
}

/**
 * How many days in a stage before a task is considered at-risk.
 * Thresholds confirmed with Jack, 2026-05-04.
 */
export const STAGE_RISK_DAYS: Record<string, number> = {
  "copy": 2,
  "design": 5,
  "copy revision needed": 2,
  "design revision needed": 2,
  "internal qa": 1,
  "internal qa review": 1,
};

export function getStageRiskDays(status: string, overrides?: Record<string, number>): number {
  const key = status.toLowerCase().trim();
  if (overrides?.[key] !== undefined) return overrides[key];
  return STAGE_RISK_DAYS[key] ?? 3;
}
