"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { usePipelines, useOpportunities } from "@/lib/hooks/use-pipeline";
import { useQuery } from "@tanstack/react-query";
import { useBrandCategoryStore } from "@/store/brand-category-store";
import { KanbanBoard } from "./kanban-board";
import { PipelineListView } from "./pipeline-list-view";
import { PipelineSelector } from "./pipeline-selector";
import { AddLeadModal } from "./add-lead-modal";
import { LayoutGrid, List, Plus, RefreshCw, ChevronDown, Search, X, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { usePipelineParity } from "@/lib/hooks/use-pipeline-parity";

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

  // When navigated here with ?contact=, find which pipeline that contact belongs to
  // and pre-select it so the kanban board can auto-open the right card.
  useEffect(() => {
    if (!autoOpenContactId || pipelines.length === 0) return;
    fetch(`/api/ghl/contacts/${autoOpenContactId}/opportunity`)
      .then((r) => r.json())
      .then((data: { opportunity?: { pipelineId?: string } | null }) => {
        const pipelineId = data?.opportunity?.pipelineId;
        if (pipelineId) setSelectedPipelineId(pipelineId);
      })
      .catch(() => { /* stay on default pipeline */ });
  }, [autoOpenContactId, pipelines.length]);

  const { data: opportunitiesData, isLoading: oppsLoading, isFetching } =
    useOpportunities(pipeline?.id);

  const websiteByContactId = useBrandCategoryStore((s) => s.websiteByContactId);


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

  // Fetch team members to build ghlUserId → name map for rep avatars
  const { data: teamData } = useQuery<{ users: Array<{ name: string; ghlUserId: string | null }> }>({
    queryKey: ["team-settings"],
    queryFn: () => fetch("/api/settings/team").then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });
  const repMap = new Map<string, string>(
    (teamData?.users ?? [])
      .filter((u) => u.ghlUserId)
      .map((u) => [u.ghlUserId!, u.name])
  );

  const isLoading = pipelinesLoading || oppsLoading;
  const allOpportunities = opportunitiesData?.opportunities ?? [];

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

  // Board-vs-GoHighLevel parity check. MUST STAY ABOVE THE EARLY RETURNS BELOW.
  //
  // It used to sit just before the JSX, after the `pipelinesLoading` and `pipelinesError`
  // guards, which made it a CONDITIONAL hook: the first render returned the loading state
  // having run N hooks, then the pipelines query resolved, the guards fell through, and this
  // became hook N+1. React threw "Rendered more hooks than during the previous render" and the
  // whole page went to the error screen. It takes no arguments and reads nothing from the render
  // body, so running it unconditionally is safe, and it starts the check a little sooner.
  const parity = usePipelineParity();

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
    <div data-r10n-pipeline className="flex flex-col gap-4 h-full">
      {/* Parity banner — only ever visible when the board was wrong or could not be verified.
          Silent when the counts already agree, which is the normal case. */}
      {parity.status === "repairing" && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Syncing with GoHighLevel, {Math.abs(parity.drift)} {Math.abs(parity.drift) === 1 ? "deal" : "deals"} out of step…
        </div>
      )}
      {parity.status === "repaired" && parity.removed > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Check className="w-3 h-3 text-success" />
          Matched to GoHighLevel. Removed {parity.removed} {parity.removed === 1 ? "deal" : "deals"} deleted there.
        </div>
      )}
      {/* Busy is not an error. Something is already checking, or we are waiting out a rate
          limit, and the hook comes back on its own. Say so quietly. */}
      {parity.status === "busy" && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <RefreshCw className="w-3 h-3" />
          Waiting to check against GoHighLevel: {parity.reason}. Retrying shortly.
        </div>
      )}
      {/* A guard deliberately stopped the repair. The board may be wrong and a human should
          look. Distinct from "failed" — conflating the two is what produced the misleading
          "Repair was refused" banner on 2026-09-12, when nothing had refused anything. */}
      {parity.status === "refused" && (
        <div className="flex items-center gap-2 text-[11px] text-destructive">
          <AlertTriangle className="w-3 h-3" />
          Repair stopped on purpose: {parity.reason}. The board is unchanged.
        </div>
      )}
      {parity.status === "failed" && (
        <div
          className={cn(
            "flex items-center gap-2 text-[11px]",
            parity.rateLimited ? "text-muted-foreground" : "text-destructive",
          )}
        >
          <AlertTriangle className="w-3 h-3" />
          {parity.rateLimited
            ? "GoHighLevel is rate-limiting us, so the board could not be verified just now. The scheduled check will catch it up."
            : `Could not verify against GoHighLevel: ${parity.reason}`}
        </div>
      )}

      {/* Toolbar */}
      <div data-r10n-toolbar className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {/* Pipeline selector */}
          <PipelineSelector
            pipelines={pipelines}
            selectedId={pipeline.id}
            onSelect={(id) => setSelectedPipelineId(id)}
          />

          {/* View toggle */}
          <div data-r10n-viewtoggle className="flex items-center bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("kanban")}
              data-r10n-viewtoggle-btn
              data-active={viewMode === "kanban" ? "true" : undefined}
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
              data-r10n-viewtoggle-btn
              data-active={viewMode === "list" ? "true" : undefined}
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
            <span data-r10n-syncing className="text-xs text-muted-foreground flex items-center gap-1">
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
              data-r10n-search
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
            <span data-r10n-resultcount className="text-xs text-muted-foreground whitespace-nowrap">
              {opportunities.length} result{opportunities.length !== 1 ? "s" : ""}
            </span>
          )}

          {/* Add lead button */}
          <button
            onClick={() => setShowAddLead(true)}
            data-r10n-addlead
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
          /* NO socialLeads. This board mirrors GoHighLevel exactly, and comment leads do not
             exist in GHL — they were being injected into stage index 0 ("New Lead") and added to
             its count badge, so the column read 26 where GHL showed 16. Every other stage matched
             once the mirror was reconciled; this was the last discrepancy.
             Comment leads remain available in the Leads page and the Inbox, which is where a lead
             with no GHL opportunity belongs. The List view never showed them and already matched. */
          <KanbanBoard pipeline={pipeline} opportunities={opportunities} unreadContactIds={unreadContactIds} repMap={repMap} autoOpenContactId={autoOpenContactId ?? undefined} />
        ) : (
          <PipelineListView pipeline={pipeline} opportunities={opportunities} />
        )}
      </div>

      {/* Add Lead Modal */}
      {showAddLead && pipeline && (
        <AddLeadModal
          pipelines={pipelines}
          defaultPipelineId={pipeline.id}
          onClose={() => setShowAddLead(false)}
        />
      )}
    </div>
  );
}
