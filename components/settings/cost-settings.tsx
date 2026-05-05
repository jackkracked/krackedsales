"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, PoundSterling } from "lucide-react";
import { cn } from "@/lib/utils/cn";

async function fetchCostSettings(): Promise<{ costPerEmail: number }> {
  const res = await fetch("/api/settings/cost-settings");
  if (!res.ok) throw new Error("Failed to load cost settings");
  return res.json();
}

async function saveCostSettings(costPerEmail: number) {
  const res = await fetch("/api/settings/cost-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ costPerEmail }),
  });
  if (!res.ok) throw new Error("Failed to save");
}

export function CostSettings() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  const { data } = useQuery({
    queryKey: ["cost-settings"],
    queryFn: fetchCostSettings,
  });

  useEffect(() => {
    if (data !== undefined) setValue(String(data.costPerEmail));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: saveCostSettings,
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < 0) return;
    saveMutation.mutate(parsed);
  }

  return (
    <div className="bg-card border border-border rounded-[10px] p-5">
      <div className="flex items-center gap-2 mb-1">
        <PoundSterling className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Cost Per Email Demo
        </h2>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        The staff cost to fulfill one email demo. <strong>Team Fulfillment</strong> on the KPI page is calculated as this value × completed demos that month — updated automatically.
      </p>

      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div className="space-y-1.5 flex-1 max-w-[200px]">
          <label className="text-xs font-medium text-foreground">Cost per demo ($)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="0.00"
              className={cn(
                "w-full rounded-[6px] border border-border bg-background pl-6 pr-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              )}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saveMutation.isPending}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
            "bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {saveMutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
          Save
        </button>

        {saved && (
          <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved
          </span>
        )}
        {saveMutation.isError && (
          <span className="text-xs text-destructive">Failed to save. Try again.</span>
        )}
      </form>
    </div>
  );
}
