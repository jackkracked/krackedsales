"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import {
  ChevronDown, Search, Megaphone, Sprout, Globe, Users, Archive, Layers,
  Music, Check, Plus,
} from "lucide-react";
import { relativeTime } from "@/lib/utils/date";
import type { GHLPipeline } from "@/lib/ghl/types";

// ─── Category detection from pipeline name ──────────────────────────────────

type PipelineCategory = "ad_funnel" | "organic" | "general" | "tiktok" | "partner" | "archive" | "other";

const CATEGORY_CONFIG: Record<PipelineCategory, {
  label: string;
  badge: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  group: string;
  groupOrder: number;
}> = {
  ad_funnel: { label: "AD FUNNEL", badge: "bg-primary/10 text-primary border-primary/20", icon: Megaphone, iconBg: "bg-primary/10", iconColor: "text-primary", group: "Ad Funnels", groupOrder: 0 },
  organic:   { label: "ORGANIC", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: Sprout, iconBg: "bg-emerald-50", iconColor: "text-emerald-600", group: "Organic", groupOrder: 1 },
  tiktok:    { label: "TIKTOK", badge: "bg-slate-100 text-slate-700 border-slate-200", icon: Music, iconBg: "bg-slate-100", iconColor: "text-slate-600", group: "General", groupOrder: 2 },
  general:   { label: "MAIN WEBSITE", badge: "bg-blue-50 text-blue-700 border-blue-200", icon: Globe, iconBg: "bg-blue-50", iconColor: "text-blue-600", group: "General", groupOrder: 2 },
  partner:   { label: "PARTNER", badge: "bg-amber-50 text-amber-700 border-amber-200", icon: Users, iconBg: "bg-amber-50", iconColor: "text-amber-600", group: "Partners", groupOrder: 3 },
  archive:   { label: "ARCHIVE", badge: "bg-muted text-muted-foreground border-border", icon: Archive, iconBg: "bg-muted", iconColor: "text-muted-foreground", group: "Archive", groupOrder: 4 },
  other:     { label: "OTHER", badge: "bg-muted text-muted-foreground border-border", icon: Layers, iconBg: "bg-muted", iconColor: "text-muted-foreground", group: "Other", groupOrder: 5 },
};

function detectCategory(name: string): PipelineCategory {
  const n = name.toLowerCase();
  if (n.includes("old") || n.includes("dump") || n.includes("unresponsive")) return "archive";
  if (n.includes("ad funnel")) return "ad_funnel";
  if (n.includes("organic")) return "organic";
  if (n.includes("tiktok") || n.includes("tik tok")) return "tiktok";
  if (n.includes("main website") || n.includes("general") || n.includes("retention general")) return "general";
  if (n.includes("partner") || n.includes("alice")) return "partner";
  return "other";
}

/** Strip the parenthetical suffix from pipeline name for cleaner display */
function cleanName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// ─── Lead count fetcher ─────────────────────────────────────────────────────

function usePipelineLeadCounts(pipelines: GHLPipeline[], enabled: boolean) {
  return useQuery<Record<string, number>>({
    queryKey: ["pipeline-lead-counts", pipelines.map(p => p.id).join(",")],
    queryFn: async () => {
      const counts: Record<string, number> = {};
      // Fetch first page of each pipeline to get total from meta
      await Promise.all(
        pipelines.map(async (p) => {
          try {
            const res = await fetch(`/api/ghl/opportunities?pipelineId=${p.id}&limit=1`);
            if (!res.ok) { counts[p.id] = 0; return; }
            const data = await res.json();
            counts[p.id] = data.meta?.total ?? data.opportunities?.length ?? 0;
          } catch {
            counts[p.id] = 0;
          }
        })
      );
      return counts;
    },
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

interface PipelineSelectorProps {
  pipelines: GHLPipeline[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function PipelineSelector({ pipelines, selectedId, onSelect }: PipelineSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = pipelines.find(p => p.id === selectedId);
  const selectedCategory = selected ? detectCategory(selected.name) : "other";
  const selectedConfig = CATEGORY_CONFIG[selectedCategory];

  // Fetch lead counts when dropdown is open
  const { data: leadCounts } = usePipelineLeadCounts(pipelines, open);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  // Group and filter pipelines
  const q = search.toLowerCase().trim();
  const filtered = pipelines.filter(p => !q || p.name.toLowerCase().includes(q));

  const grouped = new Map<string, Array<{ pipeline: GHLPipeline; category: PipelineCategory }>>();
  for (const p of filtered) {
    const cat = detectCategory(p.name);
    const config = CATEGORY_CONFIG[cat];
    const group = config.group;
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push({ pipeline: p, category: cat });
  }

  // Sort groups by order
  const sortedGroups = [...grouped.entries()].sort((a, b) => {
    const orderA = CATEGORY_CONFIG[a[1][0].category].groupOrder;
    const orderB = CATEGORY_CONFIG[b[1][0].category].groupOrder;
    return orderA - orderB;
  });

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        data-r10n-pipeselector-trigger
        data-open={open ? "true" : undefined}
        className={cn(
          "flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded-[8px] border-2 transition-all",
          "hover:shadow-sm cursor-pointer bg-card",
          open ? "border-primary/40 shadow-sm" : "border-border"
        )}
      >
        <div data-r10n-pipeselector-icon className={cn("w-7 h-7 rounded-[6px] flex items-center justify-center shrink-0", selectedConfig.iconBg)}>
          <selectedConfig.icon className={cn("w-3.5 h-3.5", selectedConfig.iconColor)} />
        </div>
        <div className="flex flex-col items-start min-w-0">
          <span data-r10n-pipeselector-label className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-medium leading-none">
            Active pipeline
          </span>
          <span data-r10n-pipeselector-name className="text-sm font-semibold text-foreground truncate max-w-[240px] leading-tight">
            {selected ? cleanName(selected.name) : "Select pipeline"}
          </span>
        </div>
        <span data-r10n-pipeselector-badge className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0", selectedConfig.badge)}>
          {selectedConfig.label}
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div data-r10n-pipeselector-menu className="absolute top-full left-0 mt-1.5 w-[420px] bg-card border border-border rounded-[10px] shadow-xl z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2.5 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pipelines..."
                data-r10n-search
                className="w-full pl-8 pr-3 py-2 text-sm bg-muted/50 rounded-[6px] border-0 outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          {/* Grouped list */}
          <div className="max-h-[400px] overflow-y-auto py-1.5">
            {sortedGroups.map(([groupName, items], gi) => (
              <div key={groupName}>
                {/* Group header with extending line */}
                <div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
                  <span data-r10n-pipeselector-group className="text-[10px] uppercase tracking-[0.1em] font-semibold text-muted-foreground/50 shrink-0">
                    {groupName}
                  </span>
                  <div className="flex-1 h-px bg-border/60" />
                </div>

                {/* Pipeline rows */}
                {items.map(({ pipeline: p, category: cat }) => {
                  const config = CATEGORY_CONFIG[cat];
                  const isSelected = p.id === selectedId;
                  const isArchive = cat === "archive";
                  const count = leadCounts?.[p.id];

                  return (
                    <button
                      key={p.id}
                      onClick={() => { onSelect(p.id); setOpen(false); setSearch(""); }}
                      data-r10n-pipeselector-row
                      data-selected={isSelected ? "true" : undefined}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left",
                        isSelected
                          ? "bg-primary/[0.06]"
                          : "hover:bg-muted/50",
                        isArchive && !isSelected && "opacity-50"
                      )}
                    >
                      {/* Icon */}
                      <div data-r10n-pipeselector-rowicon className={cn("w-8 h-8 rounded-[6px] flex items-center justify-center shrink-0", config.iconBg)}>
                        <config.icon className={cn("w-4 h-4", config.iconColor)} />
                      </div>

                      {/* Name + last active */}
                      <div className="flex-1 min-w-0">
                        <p data-r10n-pipeselector-rowname className="text-sm font-medium text-foreground truncate leading-tight">
                          {cleanName(p.name)}
                        </p>
                        <p data-r10n-pipeselector-rowsub className="text-[11px] text-muted-foreground/60 leading-tight">
                          {isArchive ? "Archived" : "Last active today"}
                        </p>
                      </div>

                      {/* Lead count pill */}
                      {count !== undefined && (
                        <span data-r10n-pipeselector-count className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full tabular-nums shrink-0">
                          {count} leads
                        </span>
                      )}

                      {/* Category badge */}
                      <span data-r10n-pipeselector-badge className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border shrink-0", config.badge)}>
                        {config.label}
                      </span>

                      {/* Selected check */}
                      {isSelected && (
                        <Check className="w-4 h-4 text-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {filtered.length === 0 && (
              <p className="px-3 py-6 text-sm text-muted-foreground text-center">
                No pipelines match "{search}"
              </p>
            )}
          </div>

          {/* Footer: Create new pipeline */}
          <div className="border-t border-border p-2">
            <button
              onClick={() => { setOpen(false); window.open("https://app.gohighlevel.com", "_blank"); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-[6px] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create new pipeline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
