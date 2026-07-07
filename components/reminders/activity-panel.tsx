"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ScheduleStep } from "@/lib/reminders/defaults";

const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"];

interface StepActivity {
  stepNumber: number;
  sent: number;
  failed: number;
  recipients: { email: string | null; sentAt: string; status: string }[];
}
interface ActivityData { steps: StepActivity[]; repNudged: number }

function fmtDate(iso: string): string {
  try { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
  catch { return iso; }
}

export function ActivityPanel({ templateKey, schedule }: { templateKey: string; schedule: ScheduleStep[] }) {
  const { data, isLoading, isError } = useQuery<ActivityData>({
    queryKey: ["reminder-activity", templateKey],
    queryFn: async () => { const res = await fetch(`/api/reminders/activity?key=${templateKey}`); if (!res.ok) throw new Error("Failed"); return res.json(); },
    refetchOnWindowFocus: true,
  });

  const byStep = new Map((data?.steps ?? []).map((s) => [s.stepNumber, s]));
  const totalSent = (data?.steps ?? []).reduce((n, s) => n + s.sent, 0);

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Who&apos;s been through this sequence</h3>
          <p className="text-xs text-muted-foreground">Every reminder actually sent, by step.</p>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {isError && (
        <div className="flex items-center gap-2 rounded-[8px] bg-destructive/8 px-3 py-2.5 text-destructive">
          <AlertCircle className="h-4 w-4" /><span className="text-xs">Couldn&apos;t load activity.</span>
        </div>
      )}

      {!isLoading && !isError && totalSent === 0 && (
        <div className="rounded-[10px] border border-dashed border-border px-4 py-8 text-center">
          <Users className="mx-auto mb-2 h-5 w-5 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No one has entered this sequence yet.</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">Reminders sent will show here, step by step.</p>
        </div>
      )}

      {!isError && totalSent > 0 && (
        <ol className="space-y-2.5">
          {schedule.map((s, i) => {
            const a = byStep.get(i);
            const sent = a?.sent ?? 0;
            const failed = a?.failed ?? 0;
            return (
              <li key={i} className="rounded-[10px] border border-border">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-bold text-primary">{i + 1}</span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{ORD[i] ?? `Step ${i + 1}`} reminder</p>
                      <p className="text-xs text-muted-foreground">sends day {s.delayDays}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />{sent}
                    </span>
                    {failed > 0 && <span className="text-xs font-medium text-destructive tabular-nums">{failed} failed</span>}
                  </div>
                </div>
                {a && a.recipients.filter((r) => r.status !== "failed").length > 0 && (
                  <ul className="max-h-40 overflow-y-auto border-t border-border px-4 py-2">
                    {a.recipients.filter((r) => r.status !== "failed").map((r, ri) => (
                      <li key={ri} className="flex items-center justify-between gap-2 py-1 text-xs">
                        <span className="truncate text-foreground">{r.email ?? "—"}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{fmtDate(r.sentAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {data && data.repNudged > 0 && (
            <li className="rounded-[10px] border border-border bg-muted/20 px-4 py-2.5 text-sm">
              <span className="font-semibold text-foreground">{data.repNudged}</span>
              <span className="text-muted-foreground"> handed to the rep for a personal follow-up.</span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
