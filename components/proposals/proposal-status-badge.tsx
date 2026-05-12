import { cn } from "@/lib/utils/cn";

type ProposalStatus = "draft" | "sent" | "signed" | "paid" | "failed" | "void" | "overdue";

const BADGE_STYLES: Record<ProposalStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-50 text-blue-700",
  signed: "bg-indigo-50 text-indigo-700",
  paid: "bg-green-50 text-green-700",
  overdue: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
  void: "bg-muted text-muted-foreground line-through",
};

export function ProposalStatusBadge({ status }: { status: string }) {
  const s = status as ProposalStatus;
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide",
        BADGE_STYLES[s] ?? "bg-muted text-muted-foreground"
      )}
    >
      {status}
    </span>
  );
}
