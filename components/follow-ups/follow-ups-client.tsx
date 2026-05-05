"use client";

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { FollowUpItem } from "./follow-up-contact-card";
import { FollowUpListPanel } from "./follow-up-list-panel";
import { FollowUpWorkspace } from "./follow-up-workspace";

interface FollowUpsData {
  groups: {
    needsAction: FollowUpItem[];
    waiting: FollowUpItem[];
  };
}

export function FollowUpsClient() {
  const [selectedItem, setSelectedItem] = useState<FollowUpItem | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<FollowUpsData>({
      queryKey: ["follow-ups"],
      queryFn: async () => {
        const res = await fetch("/api/follow-ups");
        if (!res.ok) throw new Error("Failed to fetch follow-ups");
        return res.json();
      },
      staleTime: 2 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
    });

  const needsAction = data?.groups.needsAction ?? [];
  const waiting = data?.groups.waiting ?? [];
  const total = needsAction.length + waiting.length;

  async function handleAnalyse() {
    setAnalysing(true);
    try {
      await fetch("/api/follow-ups/analyse", { method: "POST" });
      await refetch();
    } finally {
      setAnalysing(false);
    }
  }

  function handleRefresh() {
    refetch();
  }

  // When a send/skip/remove completes, remove the item from the list
  const handleItemGone = useCallback(
    (oppId: string) => {
      setSelectedItem((prev) => (prev?.oppId === oppId ? null : prev));
      // Invalidate context cache for this opp
      queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
    },
    [queryClient]
  );

  const handleSent = useCallback(
    (oppId: string) => {
      handleItemGone(oppId);
    },
    [handleItemGone]
  );

  const handleSkipped = useCallback(
    (oppId: string) => {
      handleItemGone(oppId);
    },
    [handleItemGone]
  );

  const handleRemoved = useCallback(
    (oppId: string) => {
      handleItemGone(oppId);
    },
    [handleItemGone]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1 pb-3 gap-3">
        <p className="text-sm text-muted-foreground">
          {isLoading ? (
            "Loading…"
          ) : total === 0 ? (
            "All caught up"
          ) : (
            <>
              <span className="font-semibold text-foreground">{needsAction.length}</span>
              {" need action · "}
              <span className="font-semibold text-foreground">{waiting.length}</span>
              {" waiting"}
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAnalyse}
            disabled={analysing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-[7px] hover:bg-primary/5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${analysing ? "animate-spin" : ""}`} />
            {analysing ? "Analysing…" : "Pre-generate AI"}
          </button>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:bg-muted/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Split panel */}
      <div className="flex-1 min-h-0 flex rounded-[12px] border border-border overflow-hidden bg-background">
        {/* Left: list */}
        <div className="w-[280px] shrink-0 border-r border-border overflow-y-auto bg-muted/5">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Loading…
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 px-4 text-center">
              <p className="text-xs text-muted-foreground">
                Could not load follow-ups. Check your GHL connection.
              </p>
              <button
                onClick={handleRefresh}
                className="text-xs text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <FollowUpListPanel
              needsAction={needsAction}
              waiting={waiting}
              selectedOppId={selectedItem?.oppId ?? null}
              onSelect={setSelectedItem}
            />
          )}
        </div>

        {/* Right: workspace */}
        <div className="flex-1 overflow-y-auto">
          <FollowUpWorkspace
            item={selectedItem}
            onSent={handleSent}
            onSkipped={handleSkipped}
            onRemoved={handleRemoved}
          />
        </div>
      </div>
    </div>
  );
}
