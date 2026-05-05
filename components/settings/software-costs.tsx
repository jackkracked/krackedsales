"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, RefreshCw, Plus, Monitor } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface SoftwareCostItem {
  id: string;
  name: string;
  monthlyCost: number;
  active: boolean;
  createdAt: string;
}

async function fetchItems(): Promise<SoftwareCostItem[]> {
  const res = await fetch("/api/settings/software-costs");
  if (!res.ok) throw new Error("Failed to load software costs");
  const data = await res.json();
  return data.items;
}

async function createItem(payload: { name: string; monthlyCost: number }) {
  const res = await fetch("/api/settings/software-costs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to add software cost");
  return data.item as SoftwareCostItem;
}

async function deleteItem(id: string) {
  const res = await fetch(`/api/settings/software-costs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete item");
}

export function SoftwareCosts() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");

  const { data: items = [], isLoading } = useQuery<SoftwareCostItem[]>({
    queryKey: ["software-costs"],
    queryFn: fetchItems,
  });

  const addMutation = useMutation({
    mutationFn: createItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["software-costs"] });
      setName("");
      setCost("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["software-costs"] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(cost);
    if (!name.trim() || isNaN(parsed) || parsed < 0) return;
    addMutation.mutate({ name: name.trim(), monthlyCost: parsed });
  }

  const total = items.filter(i => i.active).reduce((s, i) => s + i.monthlyCost, 0);
  const canSubmit = name.trim() && cost.trim() && !isNaN(parseFloat(cost));

  return (
    <div className="bg-card border border-border rounded-[10px] p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        <Monitor className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Software Costs
        </h2>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Monthly software subscriptions. The total pulls through to the Software Cost KPI automatically.
      </p>

      {/* List */}
      <div className="flex-1">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No software added yet.</p>
        ) : (
          <div className="rounded-[8px] border border-border overflow-hidden mb-3">
            {items.map((item, i) => (
              <div
                key={item.id}
                className={cn(
                  "flex items-center justify-between px-3.5 py-2.5",
                  i < items.length - 1 && "border-b border-border"
                )}
              >
                <span className="text-sm text-foreground">{item.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">
                    ${item.monthlyCost.toFixed(2)}<span className="text-xs text-muted-foreground font-normal">/mo</span>
                  </span>
                  <button
                    onClick={() => deleteMutation.mutate(item.id)}
                    disabled={deleteMutation.isPending}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {/* Total row */}
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-muted/40 border-t border-border">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total / month</span>
              <span className="text-sm font-semibold text-foreground">${total.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Add form */}
      <form onSubmit={handleSubmit} className="space-y-3 mt-4">
        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add software
        </p>
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. GoHighLevel"
            className={cn(
              "w-full rounded-[6px] border border-border bg-background px-3 py-2",
              "text-sm text-foreground placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            )}
          />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={cost}
              onChange={e => setCost(e.target.value)}
              placeholder="0.00"
              className={cn(
                "w-full rounded-[6px] border border-border bg-background pl-6 pr-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              )}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit || addMutation.isPending}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
              "bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {addMutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Add
          </button>
          {addMutation.isError && (
            <span className="text-xs text-destructive">{(addMutation.error as Error).message}</span>
          )}
        </div>
      </form>
    </div>
  );
}
