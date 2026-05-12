"use client";

import { useQuery } from "@tanstack/react-query";
import { Trophy, TrendingUp, Minus, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ABGroupResult, VariantStats } from "@/lib/ab-testing";

interface ABTestsResponse {
  groups: ABGroupResult[];
  history: Array<{
    id: string;
    abGroup: string;
    winnerSends: number;
    winnerResponses: number;
    loserSends: number;
    loserResponses: number;
    winnerRate: string;
    loserRate: string;
    chiSquare: string;
    detectedAt: string;
  }>;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function VariantRow({ v, isWinner }: { v: VariantStats; isWinner: boolean | null }) {
  const rateColor =
    isWinner === true
      ? "text-emerald-600 font-semibold"
      : isWinner === false
      ? "text-red-500"
      : "text-foreground";

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-4 shrink-0 flex justify-center">
        {isWinner === true && <Trophy className="w-3.5 h-3.5 text-amber-500" />}
        {isWinner === false && <Minus className="w-3.5 h-3.5 text-muted-foreground/40" />}
      </div>
      <p className="flex-1 text-[13px] text-foreground truncate" title={v.templateName}>
        {v.templateName}
      </p>
      <div className="flex items-center gap-4 shrink-0 text-xs tabular-nums">
        <span className="text-muted-foreground">{v.sends} sent</span>
        <span className="text-muted-foreground">{v.responses} replied</span>
        <span className={cn("w-12 text-right", rateColor)}>{pct(v.rate)}</span>
      </div>
    </div>
  );
}

function GroupCard({ group }: { group: ABGroupResult }) {
  const hasData = group.variants.some((v) => v.sends > 0);
  const totalSends = group.variants.reduce((sum, v) => sum + v.sends, 0);

  return (
    <div className="bg-card border border-border rounded-[10px] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-[13px] font-semibold text-foreground">
            Group: {group.abGroup}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {group.isSignificant ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
              <Trophy className="w-3 h-3" /> Winner found
            </span>
          ) : hasData ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {totalSends} sends · testing
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No data yet</span>
          )}
        </div>
      </div>

      {/* Variants */}
      <div className="px-4 divide-y divide-border/50">
        {group.variants.map((v) => (
          <VariantRow
            key={v.templateId}
            v={v}
            isWinner={
              group.isSignificant
                ? v.templateId === group.winner?.templateId
                : null
            }
          />
        ))}
      </div>

      {/* Chi-square detail */}
      {group.chiSquare !== null && group.variants.length === 2 && (
        <div className="px-4 py-2 border-t border-border/50 flex items-center gap-4">
          <span className="text-[11px] text-muted-foreground/60 tabular-nums">
            χ² = {group.chiSquare.toFixed(2)}
          </span>
          <span className="text-[11px] text-muted-foreground/60">
            {group.isSignificant
              ? "p < 0.05 — statistically significant"
              : group.variants.every((v) => v.sends >= 10)
              ? "Not yet significant — keep sending"
              : `Need ≥10 sends per variant (min ${Math.min(...group.variants.map((v) => v.sends))} so far)`}
          </span>
        </div>
      )}
    </div>
  );
}

export function ABLeaderboard() {
  const { data, isPending, isError } = useQuery<ABTestsResponse>({
    queryKey: ["ab-tests"],
    queryFn: () => fetch("/api/templates/ab-tests").then((r) => r.json()),
    staleTime: 60_000,
  });

  if (isPending) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-32 rounded-[10px] bg-muted/40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="w-4 h-4 shrink-0" />
        Failed to load A/B test data
      </div>
    );
  }

  const groups = data?.groups ?? [];
  const history = data?.history ?? [];
  const activeGroups = groups.filter((g) => !g.isSignificant);
  const completedGroups = groups.filter((g) => g.isSignificant);

  if (groups.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center gap-3 text-center">
        <TrendingUp className="w-8 h-8 text-muted-foreground/30" />
        <div>
          <p className="text-sm font-medium text-foreground">No A/B tests configured</p>
          <p className="text-xs text-muted-foreground mt-1">
            Assign the same <code className="text-xs bg-muted px-1 rounded">abGroup</code> to two
            templates to start testing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto max-h-full">
      {/* Winners */}
      {completedGroups.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground/60 mb-3"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Winners
          </h2>
          <div className="space-y-3">
            {completedGroups.map((g) => (
              <GroupCard key={g.abGroup} group={g} />
            ))}
          </div>
        </section>
      )}

      {/* Running */}
      {activeGroups.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground/60 mb-3"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Running
          </h2>
          <div className="space-y-3">
            {activeGroups.map((g) => (
              <GroupCard key={g.abGroup} group={g} />
            ))}
          </div>
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground/60 mb-3"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Past Results
          </h2>
          <div className="bg-card border border-border rounded-[10px] divide-y divide-border">
            {history.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-4">
                <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-[13px] text-foreground font-medium flex-1 truncate">
                  Group: {r.abGroup}
                </span>
                <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground shrink-0">
                  <span>{pct(Number(r.winnerRate))} vs {pct(Number(r.loserRate))}</span>
                  <span>χ²={Number(r.chiSquare).toFixed(2)}</span>
                  <span>
                    {new Date(r.detectedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
