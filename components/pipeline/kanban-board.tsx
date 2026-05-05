"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { OpportunityCard } from "./opportunity-card";
import { OpportunityModal } from "./opportunity-modal";
import { CommentLeadCard, type CommentLead } from "./comment-lead-card";
import { CommentLeadModal } from "./comment-lead-modal";
import { useUpdateOpportunityStage } from "@/lib/hooks/use-pipeline";
import { useStageHistoryStore } from "@/store/stage-history-store";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";

type OppTab = "overview" | "qualification" | "notes" | "messages";
type LeadTab = "overview" | "comment" | "notes" | "messages";

// ─── Sortable card wrapper ─────────────────────────────────────────────────

function SortableCard({
  opportunity,
  hasUnread,
  onCardClick,
  onMessageClick,
}: {
  opportunity: GHLOpportunity;
  hasUnread: boolean;
  onCardClick: (opp: GHLOpportunity) => void;
  onMessageClick: (opp: GHLOpportunity) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: opportunity.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <OpportunityCard
        opportunity={opportunity}
        isDragging={isDragging}
        hasUnread={hasUnread}
        onClick={() => !isDragging && onCardClick(opportunity)}
        onMessageClick={() => !isDragging && onMessageClick(opportunity)}
      />
    </div>
  );
}

// ─── Droppable column ──────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  opportunities,
  commentLeads,
  unreadContactIds,
  onCardClick,
  onMessageClick,
  onCommentLeadClick,
  onCommentLeadMessageClick,
  isOver,
}: {
  stage: GHLPipeline["stages"][0];
  opportunities: GHLOpportunity[];
  commentLeads?: CommentLead[];
  unreadContactIds: Set<string>;
  onCardClick: (opp: GHLOpportunity) => void;
  onMessageClick: (opp: GHLOpportunity) => void;
  onCommentLeadClick?: (lead: CommentLead) => void;
  onCommentLeadMessageClick?: (lead: CommentLead) => void;
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: stage.id });

  // Merge and sort all cards by date descending
  const allCards = [
    ...opportunities.map(o => ({ type: "opp" as const, id: o.id, date: new Date(o.createdAt).getTime(), item: o })),
    ...(commentLeads ?? []).map(l => ({ type: "lead" as const, id: `cl-${l.id}`, date: new Date(l.createdAt).getTime(), item: l })),
  ].sort((a, b) => b.date - a.date);

  return (
    <div className="flex flex-col min-w-[300px] flex-1 h-full">
      <div className="h-9 flex items-center gap-2 px-1 shrink-0 sticky top-0 z-10 bg-background">
        <span
          className="text-sm font-semibold text-foreground truncate min-w-0 flex-1"
          title={stage.name}
        >
          {stage.name}
        </span>
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
          {opportunities.length + (commentLeads?.length ?? 0)}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col gap-2 flex-1 rounded-[10px] p-2 mt-2 overflow-y-auto transition-colors duration-150",
          isOver ? "ring-2 ring-primary/40 bg-primary/5" : ""
        )}
        style={{ backgroundColor: isOver ? undefined : "var(--sidebar)" }}
      >
        <SortableContext
          items={opportunities.map((o) => o.id)}
          strategy={verticalListSortingStrategy}
        >
          {allCards.map((card) =>
            card.type === "opp" ? (
              <SortableCard
                key={card.id}
                opportunity={card.item}
                hasUnread={unreadContactIds.has(card.item.contact?.id ?? "")}
                onCardClick={onCardClick}
                onMessageClick={onMessageClick}
              />
            ) : (
              <CommentLeadCard
                key={card.id}
                lead={card.item}
                onClick={() => onCommentLeadClick?.(card.item)}
                onMessageClick={() => onCommentLeadMessageClick?.(card.item)}
              />
            )
          )}
        </SortableContext>

        {opportunities.length === 0 && !commentLeads?.length && (
          <div className={cn(
            "flex-1 flex items-center justify-center text-xs py-8 rounded-[8px] border-2 border-dashed transition-colors",
            isOver
              ? "border-primary/40 text-primary"
              : "border-border/60 text-muted-foreground"
          )}>
            {isOver ? "Drop here" : "Empty"}
          </div>
        )}

        <div style={{ height: 48, flexShrink: 0 }} aria-hidden />
      </div>
    </div>
  );
}

// ─── Board ─────────────────────────────────────────────────────────────────

interface KanbanBoardProps {
  pipeline: GHLPipeline;
  opportunities: GHLOpportunity[];
  commentLeads?: CommentLead[];
  unreadContactIds?: Set<string>;
}

export function KanbanBoard({ pipeline, opportunities, commentLeads = [], unreadContactIds = new Set() }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [selectedOpp, setSelectedOpp] = useState<GHLOpportunity | null>(null);
  const [selectedOppTab, setSelectedOppTab] = useState<OppTab>("overview");
  const [selectedCommentLead, setSelectedCommentLead] = useState<CommentLead | null>(null);
  const [selectedLeadTab, setSelectedLeadTab] = useState<LeadTab>("overview");
  const updateStage = useUpdateOpportunityStage();
  const recordChange = useStageHistoryStore((s) => s.recordChange);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const activeOpportunity = opportunities.find((o) => o.id === activeId);
  const stageIds = new Set(pipeline.stages.map((s) => s.id));

  function resolveTargetStage(overItemId: string) {
    if (stageIds.has(overItemId)) {
      return pipeline.stages.find((s) => s.id === overItemId) ?? null;
    }
    const opp = opportunities.find((o) => o.id === overItemId);
    if (opp) {
      return pipeline.stages.find((s) => s.id === opp.pipelineStageId) ?? null;
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    setOverId(event.over ? String(event.over.id) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setOverId(null);

    if (!over) return;

    const activeOppId = String(active.id);
    const overItemId = String(over.id);

    if (activeOppId === overItemId) return;

    const targetStage = resolveTargetStage(overItemId);
    if (!targetStage) return;

    const activeOpp = opportunities.find((o) => o.id === activeOppId);
    if (activeOpp?.pipelineStageId === targetStage.id) return;

    const fromStageId = activeOpp?.pipelineStageId ?? "";
    const fromStageName = pipeline.stages.find((s) => s.id === fromStageId)?.name ?? "";
    const contactName = activeOpp?.contact?.name ?? activeOpp?.name ?? "Opportunity";

    recordChange({
      opportunityId: activeOppId,
      timestamp: Date.now(),
      fromStage: fromStageName,
      toStage: targetStage.name,
    });

    updateStage.mutate({
      opportunityId: activeOppId,
      stageId: targetStage.id,
      pipelineId: pipeline.id,
      title: contactName,
      status: activeOpp?.status ?? "open",
    });

    toast(`Moved to ${targetStage.name}`, {
      description: contactName,
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          updateStage.mutate({
            opportunityId: activeOppId,
            stageId: fromStageId,
            pipelineId: pipeline.id,
            title: contactName,
            status: activeOpp?.status ?? "open",
          });
        },
      },
    });
  }

  function handleDragCancel() {
    setActiveId(null);
    setOverId(null);
  }

  const opportunitiesByStage = (stageId: string) =>
    opportunities
      .filter((o) => o.pipelineStageId === stageId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const stageMap = Object.fromEntries(pipeline.stages.map((s) => [s.id, s.name]));

  function openOpp(opp: GHLOpportunity, tab: OppTab = "overview") {
    setSelectedOpp(opp);
    setSelectedOppTab(tab);
  }

  function openCommentLead(lead: CommentLead, tab: LeadTab = "overview") {
    setSelectedCommentLead(lead);
    setSelectedLeadTab(tab);
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={(args) =>
          pointerWithin(args).length > 0
            ? pointerWithin(args)
            : rectIntersection(args)
        }
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-3 overflow-x-scroll pb-3 h-full min-h-0 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-muted/60">
          {pipeline.stages.map((stage, stageIndex) => {
            const isOver = (() => {
              if (!overId || !activeId) return false;
              if (overId === stage.id) return true;
              const overOpp = opportunities.find((o) => o.id === overId);
              return overOpp?.pipelineStageId === stage.id;
            })();

            return (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                opportunities={opportunitiesByStage(stage.id)}
                commentLeads={stageIndex === 0 ? commentLeads : undefined}
                unreadContactIds={unreadContactIds}
                onCardClick={(opp) => openOpp(opp, "overview")}
                onMessageClick={(opp) => openOpp(opp, "messages")}
                onCommentLeadClick={(lead) => openCommentLead(lead, "overview")}
                onCommentLeadMessageClick={(lead) => openCommentLead(lead, "messages")}
                isOver={isOver}
              />
            );
          })}
        </div>

        <DragOverlay>
          {activeOpportunity && (
            <div className="rotate-2 scale-105 shadow-xl opacity-90">
              <OpportunityCard opportunity={activeOpportunity} isDragging />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {selectedOpp && (
        <OpportunityModal
          opportunity={selectedOpp}
          stageName={stageMap[selectedOpp.pipelineStageId] ?? "Unknown"}
          onClose={() => setSelectedOpp(null)}
          initialTab={selectedOppTab}
        />
      )}

      {selectedCommentLead && (
        <CommentLeadModal
          lead={selectedCommentLead}
          onClose={() => setSelectedCommentLead(null)}
          onUpdate={(updated) => setSelectedCommentLead(updated)}
          initialTab={selectedLeadTab}
        />
      )}
    </>
  );
}
