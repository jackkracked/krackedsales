"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Layers, FlaskConical } from "lucide-react";
import { TemplateCard } from "./template-card";
import { TemplateEditor } from "./template-editor";
import type { TemplateWithStats } from "@/lib/templates/types";

function groupByAbGroup(templates: TemplateWithStats[]) {
  const groups: { key: string | null; templates: TemplateWithStats[] }[] = [];
  const seen = new Set<string>();

  for (const t of templates) {
    if (!t.abGroup) {
      groups.push({ key: null, templates: [t] });
    } else if (!seen.has(t.abGroup)) {
      seen.add(t.abGroup);
      groups.push({
        key: t.abGroup,
        templates: templates.filter((x) => x.abGroup === t.abGroup),
      });
    }
  }
  return groups;
}

export function TemplatesClient() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<TemplateWithStats | null | "new">(null);

  const { data, isLoading, isError } = useQuery<{ templates: TemplateWithStats[] }>({
    queryKey: ["templates"],
    queryFn: async () => {
      const res = await fetch("/api/templates");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 0,
  });

  const templates = data?.templates ?? [];
  const groups = groupByAbGroup(templates);
  const abGroupCount = new Set(templates.filter((t) => t.abGroup).map((t) => t.abGroup)).size;

  async function toggleActive(template: TemplateWithStats) {
    await fetch(`/api/templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !template.active }),
    });
    queryClient.invalidateQueries({ queryKey: ["templates"] });
  }

  async function markWinner(template: TemplateWithStats) {
    if (!template.abGroup) return;
    // Mark this as winner, deactivate siblings
    const siblings = templates.filter(
      (t) => t.abGroup === template.abGroup && t.id !== template.id
    );
    await Promise.all([
      fetch(`/api/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isWinner: true, weight: 100 }),
      }),
      ...siblings.map((s) =>
        fetch(`/api/templates/${s.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: false, weight: 0 }),
        })
      ),
    ]);
    queryClient.invalidateQueries({ queryKey: ["templates"] });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading templates…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-sm text-muted-foreground">
        <p>Failed to load templates.</p>
        <p className="text-xs">Make sure your database is connected (DATABASE_URL in .env.local).</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-full text-xs text-muted-foreground">
            <Layers className="w-3.5 h-3.5" />
            {templates.length} template{templates.length !== 1 ? "s" : ""}
          </div>
          {abGroupCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-full text-xs text-muted-foreground">
              <FlaskConical className="w-3.5 h-3.5" />
              {abGroupCount} A/B test{abGroupCount !== 1 ? "s" : ""} running
            </div>
          )}
        </div>
        <button
          onClick={() => setEditing("new")}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-[8px] hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      {/* Empty state */}
      {templates.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Layers className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">No templates yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Create your first template and set conditions for when it should be used in the reply queue.
            </p>
          </div>
          <button
            onClick={() => setEditing("new")}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-[8px] hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create first template
          </button>
        </div>
      )}

      {/* Template groups */}
      {groups.map((group, gi) => (
        <div key={gi}>
          {/* A/B group header */}
          {group.key && (
            <div className="flex items-center gap-2 mb-2">
              <FlaskConical className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                A/B Test: {group.key}
              </span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground">
                {group.templates.map((t) => `${t.name} (${t.weight}%)`).join(" vs ")}
              </span>
            </div>
          )}

          {/* Cards */}
          <div className={group.key ? "grid grid-cols-1 lg:grid-cols-2 gap-3" : "space-y-3"}>
            {group.templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                isAbSibling={!!group.key}
                onEdit={() => setEditing(t)}
                onToggleActive={() => toggleActive(t)}
                onMarkWinner={() => markWinner(t)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Editor slide-over */}
      {editing !== null && (
        <TemplateEditor
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["templates"] })}
        />
      )}
    </div>
  );
}
