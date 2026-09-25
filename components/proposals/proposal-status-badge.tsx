import { cn } from "@/lib/utils/cn";

type ProposalStatus =
  | "draft" | "sent" | "signed" | "partial" | "paid" | "failed" | "void" | "overdue" | "lost"
  // 90-day management term states. See lib/proposals/status.ts for what decides them.
  | "active" | "completed" | "past_due";

const BADGE_STYLES: Record<ProposalStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-50 text-blue-700",
  signed: "bg-violet-100 text-violet-700",
  partial: "bg-orange-50 text-orange-700",
  paid: "bg-green-50 text-green-700",
  overdue: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
  void: "bg-muted text-muted-foreground line-through",
  lost: "bg-red-50 text-red-600",
  // Teal was already this system's colour for a running retainer (it was hard-coded into the
  // `management && partial` shim this component used to carry), so keeping it preserves what the
  // team already reads as "active" rather than inventing a new signal.
  active: "bg-teal-50 text-teal-700",
  // A finished term needs the LEAST attention on the screen: it is settled and nothing is owed.
  // Visual weight maps to decision weight, so it sits quieter than every live state.
  completed: "bg-slate-100 text-slate-600",
  // Reads as the same event as `failed` to the person scanning: money did not arrive.
  past_due: "bg-red-50 text-red-700",
};

/** Statuses where a term is still running, so the counter earns its place. `completed` omits it:
 *  "3/3" restates what the word already says. */
const SHOWS_COUNTER = new Set<string>(["active", "partial", "past_due"]);

/** "past_due" -> "past due". The pill uppercases in CSS, so an underscore would read "PAST_DUE". */
function humanize(status: string): string {
  return status.replace(/_/g, " ");
}

export interface TermProgress {
  collected: number;
  expected: number;
}

export function ProposalStatusBadge({
  status,
  progress,
}: {
  status: string;
  /** Kept for call-site compatibility; the retainer shim it used to drive is gone. */
  management?: boolean;
  /** Term progress for a 90-day spread proposal. Absent for everything else. */
  progress?: TermProgress | null;
}) {
  const s = status as ProposalStatus;
  const style = BADGE_STYLES[s] ?? "bg-muted text-muted-foreground";

  // Only render a counter for a real multi-payment term. A 1-of-1 counter is noise.
  const showCounter =
    !!progress && SHOWS_COUNTER.has(status) && progress.expected > 1;

  return (
    <span
      data-r10n-status-pill
      data-status={s}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide",
        style,
      )}
    >
      {humanize(status)}
      {showCounter && (
        // Tabular numerals so the counter column stays optically aligned down a long list even
        // though the pill itself is variable-width. Slightly de-emphasised: the status is the
        // headline, the count is the detail.
        <span className="font-mono tabular-nums opacity-70" aria-label={`${progress!.collected} of ${progress!.expected} payments collected`}>
          {progress!.collected}/{progress!.expected}
        </span>
      )}
    </span>
  );
}
