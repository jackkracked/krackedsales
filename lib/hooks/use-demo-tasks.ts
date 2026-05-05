"use client";

import { useQuery } from "@tanstack/react-query";
import type { EnrichedTask, BackfillStatus } from "@/app/api/clickup/tasks/route";

interface DemoTasksResponse {
  tasks: EnrichedTask[];
  backfill: BackfillStatus;
}

export function useDemoTasks() {
  return useQuery<DemoTasksResponse>({
    queryKey: ["demos"],
    queryFn: async () => {
      const res = await fetch("/api/clickup/tasks");
      if (!res.ok) throw new Error("Failed to fetch demo tasks");
      return res.json();
    },
    staleTime: 0,
    refetchInterval: 30 * 1000,
  });
}
