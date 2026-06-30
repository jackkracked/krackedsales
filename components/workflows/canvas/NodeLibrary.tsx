"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronRight, X, Plus } from "lucide-react";
import { NODE_CATALOG, CATEGORY_ORDER, CATEGORY_LABELS } from "@/lib/workflows/node-catalog";
import { cn } from "@/lib/utils/cn";

interface NodeLibraryProps {
  onAddNode: (type: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  showCollapsedButton?: boolean;
}

export function NodeLibrary({ onAddNode, collapsed, onToggle, showCollapsedButton = true }: NodeLibraryProps) {
  const [search, setSearch] = useState("");
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    new Set(["trigger", "action", "control"])
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return NODE_CATALOG;
    const q = search.toLowerCase();
    return NODE_CATALOG.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q) ||
        n.type.toLowerCase().includes(q)
    );
  }, [search]);

  const grouped = useMemo(() => {
    const map: Record<string, typeof filtered> = {};
    for (const node of filtered) {
      if (!map[node.category]) map[node.category] = [];
      map[node.category].push(node);
    }
    return map;
  }, [filtered]);

  if (collapsed) {
    if (!showCollapsedButton) return null;
    return (
      <div className="relative w-0 overflow-visible shrink-0">
        <button
          onClick={onToggle}
          data-r10n-wf-fab=""
          className="absolute left-3 top-3 w-10 h-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary hover:shadow-xl transition-all z-10"
          title="Add node"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div data-r10n-wf-library="" className="w-64 h-full flex flex-col border-r border-border bg-card shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span data-r10n-wf-library-title="" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Nodes</span>
        <button onClick={onToggle} className="p-1 rounded hover:bg-border/50 transition-colors">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes..."
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto py-2">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped[cat] ?? [];
          if (items.length === 0) return null;
          const isOpen = openCategories.has(cat);

          return (
            <div key={cat} className="mb-1">
              <button
                onClick={() => {
                  const next = new Set(openCategories);
                  isOpen ? next.delete(cat) : next.add(cat);
                  setOpenCategories(next);
                }}
                data-r10n-wf-libcat=""
                data-category={cat}
                className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
              >
                {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {CATEGORY_LABELS[cat]} ({items.length})
              </button>

              {isOpen && (
                <div className="space-y-px px-1.5">
                  {items.map((node) => (
                    <button
                      key={node.type}
                      onClick={() => onAddNode(node.type)}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/nodeType", node.type);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      data-r10n-wf-libitem=""
                      data-category={cat}
                      className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left hover:bg-primary/10 hover:text-primary transition-colors group cursor-grab active:cursor-grabbing"
                      title={node.description}
                    >
                      <span className="text-sm shrink-0">{node.icon}</span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold truncate">{node.label}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{node.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
