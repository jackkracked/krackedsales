"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

interface OpportunitiesResponse {
  opportunities: GHLOpportunity[];
}

interface PipelinesResponse {
  pipelines: GHLPipeline[];
}

export function usePipelines() {
  return useQuery<PipelinesResponse>({
    queryKey: ["pipelines"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/pipelines");
      if (!res.ok) throw new Error("Failed to fetch pipelines");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // Pipelines rarely change
  });
}

export function useOpportunities(pipelineId?: string) {
  return useQuery<OpportunitiesResponse>({
    queryKey: ["opportunities", pipelineId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (pipelineId) params.set("pipelineId", pipelineId);
      const res = await fetch(`/api/ghl/opportunities?${params}`);
      if (!res.ok) throw new Error("Failed to fetch opportunities");
      return res.json();
    },
    staleTime: 10 * 1000,
    refetchInterval: 10 * 1000,   // poll every 10s for near real-time
    refetchOnWindowFocus: true,    // refresh immediately when tab regains focus
    enabled: !!pipelineId,
  });
}

export function useUpdateOpportunityStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      opportunityId,
      stageId,
    }: {
      opportunityId: string;
      stageId: string;
      pipelineId?: string; // kept for backwards compat, not needed in v2
      title?: string;
      status?: string;
    }) => {
      const res = await fetch(`/api/ghl/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineStageId: stageId }),
      });
      if (!res.ok) throw new Error("Failed to update opportunity stage");
      return res.json();
    },
    onMutate: async ({ opportunityId, stageId }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["opportunities"] });
      const previous = queryClient.getQueriesData({ queryKey: ["opportunities"] });

      queryClient.setQueriesData(
        { queryKey: ["opportunities"] },
        (old: OpportunitiesResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            opportunities: old.opportunities.map((o) =>
              o.id === opportunityId ? { ...o, pipelineStageId: stageId } : o
            ),
          };
        }
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      context?.previous?.forEach(([key, value]) => {
        queryClient.setQueryData(key, value);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    },
  });
}
