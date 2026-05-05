import { useQuery } from "@tanstack/react-query";
import type { StageAverage } from "@/app/api/demo-tracker/stage-averages/route";
import type { TimeRange } from "@/lib/utils/time-range";

async function fetchStageAverages(range: TimeRange): Promise<StageAverage[]> {
  const res = await fetch(`/api/demo-tracker/stage-averages?range=${range}`);
  if (!res.ok) throw new Error("Failed to fetch stage averages");
  const data = await res.json();
  return data.stages as StageAverage[];
}

export function useStageAverages(range: TimeRange) {
  return useQuery({
    queryKey: ["stage-averages", range],
    queryFn: () => fetchStageAverages(range),
    staleTime: 5 * 60 * 1000,
  });
}
