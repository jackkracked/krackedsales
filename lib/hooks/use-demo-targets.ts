import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface DemoTargets {
  copyDays:        number;
  designDays:      number;
  copyRevDays:     number;
  designRevDays:   number;
  internalQaDays:  number;
  fulfillmentDays: number;
}

/** Map from normalised stage name → target days (for use in heatmap / risk checks) */
export function targetsToStageMap(t: DemoTargets): Record<string, number> {
  return {
    "copy":                    t.copyDays,
    "design":                  t.designDays,
    "copy revision needed":    t.copyRevDays,
    "design revision needed":  t.designRevDays,
    "internal qa":             t.internalQaDays,
    "internal qa review":      t.internalQaDays,
  };
}

async function fetchTargets(): Promise<DemoTargets> {
  const res = await fetch("/api/settings/demo-targets");
  if (!res.ok) throw new Error("Failed to load demo targets");
  const data = await res.json() as { targets: DemoTargets };
  return data.targets;
}

async function saveTargets(targets: DemoTargets): Promise<DemoTargets> {
  const res = await fetch("/api/settings/demo-targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(targets),
  });
  if (!res.ok) throw new Error("Failed to save demo targets");
  const data = await res.json() as { targets: DemoTargets };
  return data.targets;
}

export function useDemoTargets() {
  return useQuery<DemoTargets>({
    queryKey: ["demo-targets"],
    queryFn: fetchTargets,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveDemoTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveTargets,
    onSuccess: (data) => {
      qc.setQueryData(["demo-targets"], data);
    },
  });
}
