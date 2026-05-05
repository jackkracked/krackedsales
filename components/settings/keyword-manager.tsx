"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Keyword {
  id: string;
  keyword: string;
  active: boolean;
  createdAt: string;
}

async function fetchKeywords(): Promise<Keyword[]> {
  const res = await fetch("/api/settings/keywords");
  if (!res.ok) throw new Error("Failed to fetch keywords");
  const data = await res.json();
  return data.keywords ?? [];
}

async function addKeyword(keyword: string): Promise<Keyword> {
  const res = await fetch("/api/settings/keywords", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword }),
  });
  if (!res.ok) throw new Error("Failed to add keyword");
  const data = await res.json();
  return data.keyword ?? data;
}

async function toggleKeyword(id: string, active: boolean): Promise<Keyword> {
  const res = await fetch(`/api/settings/keywords/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  if (!res.ok) throw new Error("Failed to update keyword");
  const data = await res.json();
  return data.keyword ?? data;
}

async function deleteKeyword(id: string): Promise<void> {
  const res = await fetch(`/api/settings/keywords/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete keyword");
}

export function KeywordManager() {
  const [inputValue, setInputValue] = useState("");
  const queryClient = useQueryClient();

  const { data: keywords = [], isLoading } = useQuery<Keyword[]>({
    queryKey: ["keywords"],
    queryFn: fetchKeywords,
  });

  const addMutation = useMutation({
    mutationFn: addKeyword,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keywords"] });
      setInputValue("");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      toggleKeyword(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keywords"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKeyword,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keywords"] });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    addMutation.mutate(trimmed);
  }

  return (
    <div className="bg-card border border-border rounded-[10px] p-5 flex flex-col">
      <h2
        className="text-sm font-semibold text-foreground mb-1"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Keyword Lead Triggers
      </h2>
      <p className="text-xs text-muted-foreground mb-5">
        When someone comments one of these words on your Meta ads or posts,
        they&apos;re automatically added as a lead in your pipeline.
      </p>

      <div className="flex-1">
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Loading keywords…
        </div>
      ) : keywords.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No keywords yet. Add one below.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {keywords.map((kw) => (
            <div
              key={kw.id}
              className={cn(
                "flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full border transition-opacity",
                kw.active
                  ? "bg-primary/8 border-primary/20 opacity-100"
                  : "bg-muted border-border opacity-50"
              )}
            >
              {/* Keyword label */}
              <span
                className={cn(
                  "text-xs font-semibold tracking-wide",
                  kw.active ? "text-primary" : "text-muted-foreground"
                )}
              >
                {kw.keyword.toUpperCase()}
              </span>

              {/* Active/inactive toggle */}
              <button
                onClick={() => toggleMutation.mutate({ id: kw.id, active: !kw.active })}
                disabled={toggleMutation.isPending}
                title={kw.active ? "Deactivate" : "Activate"}
                aria-label={kw.active ? "Deactivate keyword" : "Activate keyword"}
                style={{ WebkitAppearance: "none" }}
                className={cn(
                  "relative inline-flex items-center w-9 h-5 rounded-full transition-colors shrink-0 cursor-pointer border-0 p-0",
                  kw.active ? "bg-primary" : "bg-muted-foreground/30"
                )}
              >
                <span
                  className={cn(
                    "inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200",
                    kw.active ? "translate-x-[18px]" : "translate-x-[3px]"
                  )}
                />
              </button>

              {/* Delete button */}
              <button
                onClick={() => deleteMutation.mutate(kw.id)}
                disabled={deleteMutation.isPending}
                title="Remove keyword"
                className="text-muted-foreground hover:text-destructive transition-colors"
                aria-label="Delete keyword"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      </div>

      {/* Add keyword form — pinned to bottom */}
      <form onSubmit={handleSubmit} className="flex gap-2 mt-4">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="e.g. INFO"
          className={cn(
            "flex-1 rounded-[6px] border border-border bg-background px-3 py-2",
            "text-sm text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
            "transition-colors"
          )}
        />
        <button
          type="submit"
          disabled={addMutation.isPending || !inputValue.trim()}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
            "bg-primary text-white hover:bg-primary/90",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {addMutation.isPending ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          Add
        </button>
      </form>

      {addMutation.isError && (
        <p className="text-xs text-destructive mt-2">
          Failed to add keyword. Please try again.
        </p>
      )}
    </div>
  );
}
