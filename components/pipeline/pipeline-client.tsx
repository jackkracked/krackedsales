"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { usePipelines, useOpportunities } from "@/lib/hooks/use-pipeline";
import { useQuery } from "@tanstack/react-query";
import { useBrandCategoryStore } from "@/store/brand-category-store";
import { KanbanBoard } from "./kanban-board";
import type { CommentLead } from "./comment-lead-card";
import { PipelineListView } from "./pipeline-list-view";
import { AddLeadModal } from "./add-lead-modal";
import { LayoutGrid, List, Plus, RefreshCw, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type ViewMode = "kanban" | "list";

export function PipelineClient() {
  const searchParams = useSearchParams();
  const autoOpenContactId = searchParams.get("contact");
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [showAddLead, setShowAddLead] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: pipelinesData, isLoading: pipelinesLoading, error: pipelinesError } = usePipelines();

  const pipelines = pipelinesData?.pipelines ?? [];

  // Default to "Email Design Demo Pipeline (AD FUNNEL)" — the primary sales pipeline
  const defaultPipeline =
    pipelines.find((p) =>
      p.name.toLowerCase().includes("email design demo") &&
      p.name.toLowerCase().includes("ad funnel")
    ) ?? pipelines[0];

  const pipeline = pipelines.find((p) => p.id === selectedPipelineId) ?? defaultPipeline;

  const { data: opportunitiesData, isLoading: oppsLoading, isFetching } =
    useOpportunities(pipeline?.id);

  const websiteByContactId = useBrandCategoryStore((s) => s.websiteByContactId);

  const { data: commentLeadsData } = useQuery<{ leads: CommentLead[] }>({
    queryKey: ["comment-leads-inbox"],
    queryFn: async () => {
      const res = await fetch("/api/comment-leads/inbox");
      if (!res.ok) throw new Error("Failed to fetch comment leads");
      return res.json();
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  // Fetch which contacts are awaiting a reply. Uses a smart server-side endpoint that
  // looks through actual messages for conversations where a GHL activity event (like a
  // stage change) masked the true last inbound message direction.
  const { data: awaitingData } = useQuery({
    queryKey: ["pipeline-awaiting-reply"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/conversations/awaiting-reply");
      if (!res.ok) return { contactIds: [] };
      return res.json() as Promise<{ contactIds: string[] }>;
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const unreadContactIds = new Set<string>(
    (awaitingData?.contactIds ?? []).filter(Boolean)
  );

  const isLoading = pipelinesLoading || oppsLoading;
  const allOpportunities = opportunitiesData?.opportunities ?? [];
  const commentLeads = commentLeadsData?.leads ?? [];

  // Cmd+K / Ctrl+K to focus search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setSearchQuery("");
        searchRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Filter opportunities and comment leads by search query
  const q = searchQuery.trim().toLowerCase();
  const opportunities = q
    ? allOpportunities.filter((o) => {
        const name = (o.contact?.name ?? o.name ?? "").toLowerCase();
        const email = (o.contact?.email ?? "").toLowerCase();
        const phone = (o.contact?.phone ?? "").toLowerCase();
        const source = (o.source ?? "").toLowerCase();
        const website = (websiteByContactId[o.contact?.id ?? ""] ?? "").toLowerCase();
        return name.includes(q) || email.includes(q) || phone.includes(q) || source.includes(q) || website.includes(q);
      })
    : allOpportunities;
  const filteredCommentLeads = q
    ? commentLeads.filter((cl) => {
        const name = (cl.name ?? "").toLowerCase();
        const website = (cl.website ?? "").toLowerCase();
        const comment = (cl.commentText ?? "").toLowerCase();
        return name.includes(q) || website.includes(q) || comment.includes(q);
      })
    : commentLeads;

  if (pipelinesLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading pipeline…
      </div>
    );
  }

  if (pipelinesError || !pipeline) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-sm text-muted-foreground">
        <p>Could not load pipeline from GoHighLevel.</p>
        <p className="text-xs">Check that your GHL token is valid and has opportunities scope.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {/* Pipeline selector dropdown */}
          {pipelines.length > 1 && (
            <div className="relative">
              <select
                value={pipeline.id}
                onChange={(e) => setSelectedPipelineId(e.target.value)}
                className="appearance-none pl-3 pr-8 py-1.5 text-sm font-medium border border-border rounded-[7px] bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
          )}
          {pipelines.length === 1 && (
            <span className="text-sm font-medium text-foreground">{pipeline.name}</span>
          )}

          {/* View toggle */}
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("kanban")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                viewMode === "kanban"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Kanban
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                viewMode === "list"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="w-3.5 h-3.5" />
              List
            </button>
          </div>

          {isFetching && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Syncing…
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Search bar */}
          <div className={cn(
            "relative flex items-center transition-all duration-200",
            searchQuery ? "w-56" : "w-44 focus-within:w-56"
          )}>
            <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search leads…"
              className="w-full pl-8 pr-8 py-1.5 text-sm border border-border rounded-[8px] bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
            />
            {searchQuery ? (
              <button
                onClick={() => { setSearchQuery(""); searchRef.current?.focus(); }}
                className="absolute right-2 p-0.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            ) : (
              <kbd className="absolute right-2 hidden sm:flex items-center gap-0.5 text-[10px] text-muted-foreground/50 font-medium pointer-events-none">
                ⌘K
              </kbd>
            )}
          </div>

          {/* Result count */}
          {q && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {opportunities.length} result{opportunities.length !== 1 ? "s" : ""}
            </span>
          )}

          {/* Add lead button */}
          <button
            onClick={() => setShowAddLead(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-[7px] hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Lead
          </button>
        </div>
      </div>

      {/* Board / List — flex-1 + min-h-0 so it takes remaining height without overflow */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {oppsLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            Loading opportunities…
          </div>
        ) : viewMode === "kanban" ? (
          <KanbanBoard pipeline={pipeline} opportunities={opportunities} commentLeads={filteredCommentLeads} unreadContactIds={unreadContactIds} autoOpenContactId={autoOpenContactId ?? undefined} />
        ) : (
          <PipelineListView pipeline={pipeline} opportunities={opportunities} />
        )}
      </div>

      {/* Add Lead Modal */}
      {showAddLead && pipeline && (
        <AddLeadModal
          pipelineId={pipeline.id}
          firstStageId={pipeline.stages[0]?.id ?? ""}
          onClose={() => setShowAddLead(false)}
        />
      )}
    </div>
  );
}
