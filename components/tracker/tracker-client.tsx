"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Receipt } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SetterView } from "@/components/tracker/setter-view";
import { CloserView } from "@/components/tracker/closer-view";
import { monthLabel, useTrackerAction, type TrackerResponse } from "@/components/tracker/tracker-api";

/**
 * A person's pay for one month, and the rows that prove it.
 *
 * THE ONE RULE THIS SCREEN OBEYS
 * Every figure at the top can be traced to rows underneath it. This replaces a spreadsheet
 * somebody maintained by hand, and the reason people trust a spreadsheet is that they can see
 * the arithmetic. A total with no visible working is a number an employee has to take on faith
 * about their own pay, which is exactly the thing worth avoiding.
 *
 * Setters get the booking sheet (components/tracker/setter-view.tsx); everyone else gets the
 * deals sheet (components/tracker/closer-view.tsx). Both share the month rules: editable numbers
 * for this month only, and a closed month is final.
 */

const nyMonthNow = () => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
};

export function TrackerClient({ isAdmin, selfId }: { isAdmin: boolean; selfId: string }) {
  const params = useSearchParams();
  const thisMonth = useMemo(() => nyMonthNow(), []);
  const [month, setMonth] = useState(() => {
    const m = params.get("month");
    return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : thisMonth;
  });
  const [userId, setUserId] = useState(selfId);
  const initialNeeds = params.get("needs") === "1";

  const { data: res, isLoading, error } = useQuery<TrackerResponse>({
    queryKey: ["tracker", userId, month],
    // Never keep the previous person's or month's figures on screen while the next load: the app
    // default (keepPreviousData) showed Gage's pay under Kelsey's name. This is pay; show nothing
    // rather than the wrong person's numbers.
    placeholderData: () => undefined,
    queryFn: async () => {
      const r = await fetch(`/api/tracker?month=${month}&userId=${userId}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not load the tracker");
      return r.json();
    },
  });

  const months = useMemo(() => {
    const set = new Set(res?.data.months ?? []);
    set.add(thisMonth);
    set.add(month);
    return [...set].sort().reverse();
  }, [res?.data.months, thisMonth, month]);

  const subjectName = res?.data.name ?? "";
  const select = "h-8 rounded-[7px] border border-border bg-card px-2.5 text-[12px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-border bg-card">
              <Receipt className="h-4 w-4 text-muted-foreground" />
            </span>
            <div>
              <h1 className="text-[17px] font-semibold leading-tight text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Pay Tracker</h1>
              <p className="text-[12px] text-muted-foreground">{res ? (userId !== selfId ? subjectName : "Your earnings") : " "}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (res?.people?.length ?? 0) > 0 && (
              <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Whose tracker to show" className={select}>
                {res!.people!.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.id === selfId ? " (you)" : ""}</option>
                ))}
              </select>
            )}
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Which month to show" className={select}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === thisMonth ? " (in progress)" : ""}</option>)}
            </select>
          </div>
        </div>

        {res?.viewer.isAdmin && res.nextToClose && <CloseMonthBanner month={res.nextToClose} review={res.closeReview ?? []} onView={() => setMonth(res.nextToClose!)} viewing={month === res.nextToClose} />}

        {error ? (
          <div className="mt-5 flex items-start gap-2.5 rounded-[10px] border border-border bg-card p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Could not load this tracker</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{(error as Error).message}</p>
            </div>
          </div>
        ) : isLoading || !res ? (
          <Skeleton />
        ) : res.data.kind === "setter" ? (
          <SetterView key={`${userId}:${month}`} res={res} initialNeeds={initialNeeds} onMonth={setMonth} />
        ) : (
          <CloserView key={`${userId}:${month}`} res={res} initialNeeds={initialNeeds} />
        )}
      </div>
    </div>
  );
}

/**
 * The admin's payday step. Closing freezes every person's pay for the month; nothing after it can
 * change that month, only add an adjustment to the next one. So it asks once, plainly.
 */
function CloseMonthBanner({ month, review, onView, viewing }: { month: string; review: string[]; onView: () => void; viewing: boolean }) {
  const action = useTrackerAction();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = monthLabel(month);
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{name} is over and still open</p>
        <p className="text-[12px] text-muted-foreground">Close it on payday to freeze everyone&apos;s pay for {name}. Anything that changes later shows as an adjustment in the next month.</p>
        {error && <p role="alert" className="mt-1 text-[12px] text-destructive">{error}</p>}
      </div>
      <div className="flex items-center gap-2">
        {!viewing && (
          <button type="button" onClick={onView} className="h-8 rounded-[7px] border border-border bg-background px-3 text-[12px] font-medium text-foreground hover:bg-muted">Review {name}</button>
        )}
        <button type="button" onClick={() => setConfirming(true)} className="h-8 rounded-[7px] bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90">
          Close {name}
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Close ${name}?`}
        description={
          <div className="flex flex-col gap-2">
            <p>Everyone&apos;s pay for {name} is frozen as it stands now. Rows still pending pay nothing for {name}; if they resolve later, they are paid as an adjustment in the next open month. This cannot be undone.</p>
            {review.length > 0 ? (
              <div>
                <p className="font-medium text-foreground">Changed by the person being paid:</p>
                <ul className="mt-1 list-disc pl-4">{review.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            ) : (
              <p>Nobody changed their own pay numbers this month.</p>
            )}
          </div>
        }
        confirmLabel={`Close ${name}`}
        loading={action.isPending}
        onConfirm={async () => {
          setError(null);
          try {
            await action.mutateAsync({ action: "close", month });
            setConfirming(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not close the month");
            setConfirming(false);
          }
        }}
      />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-5 grid gap-3 lg:grid-cols-[320px_1fr]" aria-busy="true" aria-label="Loading the tracker">
      <div className="rounded-[10px] border border-border bg-card px-5 py-4">
        <div className="h-2.5 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-8 w-32 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid grid-cols-2 divide-x divide-border rounded-[10px] border border-border bg-card lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 px-4 py-3">
            <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
            <div className="h-5 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
