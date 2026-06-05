"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2, Clock, Loader2, Workflow } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatDistanceToNow } from "date-fns";

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function WorkflowsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const { data: workflows = [], isLoading } = useQuery<WorkflowRow[]>({
    queryKey: ["workflows"],
    queryFn: async () => {
      const res = await fetch("/api/workflows");
      if (!res.ok) throw new Error("Failed to load workflows");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create workflow");
      return res.json() as Promise<WorkflowRow>;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      setCreating(false);
      setNewName("");
      router.push(`/workflows/${row.id}`);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await fetch(`/api/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/workflows/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Automate your sales process with visual workflows
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Workflow
          </button>
        </div>

        {/* Create modal */}
        {creating && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md shadow-2xl">
              <h2 className="text-lg font-bold mb-4">New Workflow</h2>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) createMutation.mutate(newName.trim());
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                placeholder="Workflow name..."
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-4"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setCreating(false); setNewName(""); }}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-border/50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={!newName.trim() || createMutation.isPending}
                  onClick={() => newName.trim() && createMutation.mutate(newName.trim())}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Workflow className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground font-medium">No workflows yet</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Create your first workflow to automate your sales process
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl hover:border-primary/30 transition-colors cursor-pointer group"
                onClick={() => router.push(`/workflows/${wf.id}`)}
              >
                {/* Status dot */}
                <div className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  wf.enabled ? "bg-green-500" : "bg-muted-foreground/30"
                )} />

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{wf.name}</p>
                  {wf.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{wf.description}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground/60 mt-1">
                    Updated {formatDistanceToNow(new Date(wf.updatedAt), { addSuffix: true })}
                  </p>
                </div>

                {/* Enable toggle */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMutation.mutate({ id: wf.id, enabled: !wf.enabled });
                    }}
                    className={cn(
                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                      wf.enabled ? "bg-green-500" : "bg-muted"
                    )}
                  >
                    <span className={cn(
                      "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform",
                      wf.enabled ? "translate-x-4" : "translate-x-1"
                    )} />
                  </button>
                </div>

                {/* Runs link */}
                <button
                  onClick={(e) => { e.stopPropagation(); router.push(`/workflows/${wf.id}/runs`); }}
                  className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-border/50 transition-colors opacity-0 group-hover:opacity-100"
                  title="View run history"
                >
                  <Clock className="w-3.5 h-3.5" />
                </button>

                {/* Delete */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${wf.name}"?`)) deleteMutation.mutate(wf.id);
                  }}
                  className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
