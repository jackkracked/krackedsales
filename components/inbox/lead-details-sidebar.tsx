"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, Tag, TrendingUp,
  ListTodo, Layers, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { QualificationPreview } from "@/components/shared/qualification-panel";
import { CreateTaskModal } from "@/components/shared/create-task-modal";
import { CreateDemoModal } from "@/components/shared/create-demo-modal";
import { CreateAuditModal } from "@/components/shared/create-audit-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";

export interface LeadDetailsSidebarProps {
  contactId: string;
  contactName?: string;
}

const STAGE_COLORS: Record<string, string> = {
  "new lead": "bg-blue-50 text-blue-700 border-blue-200",
  "initial contact": "bg-sky-50 text-sky-700 border-sky-200",
  "qualified": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "demo in progress": "bg-amber-50 text-amber-700 border-amber-200",
  "demo sent": "bg-purple-50 text-purple-700 border-purple-200",
  "unresponsive": "bg-orange-50 text-orange-700 border-orange-200",
  "won": "bg-green-50 text-green-700 border-green-200",
  "lost": "bg-red-50 text-red-700 border-red-200",
};

function stageBadgeClass(name: string) {
  const key = name.toLowerCase();
  for (const [fragment, cls] of Object.entries(STAGE_COLORS)) {
    if (key.includes(fragment)) return cls;
  }
  return "bg-muted text-muted-foreground border-border";
}

// Maps a stage name to a calm semantic tier for the R10N status-pill treatment.
// Inert under the default theme (only the [data-theme="r10n"] [data-status] rules read it).
function stageStatusTier(name: string): string {
  const key = name.toLowerCase();
  if (key.includes("won")) return "won";
  if (key.includes("lost")) return "lost";
  if (key.includes("unresponsive")) return "no_response";
  if (key.includes("qualified")) return "awaiting_reply";
  return "open";
}

export function LeadDetailsSidebar({ contactId, contactName = "" }: LeadDetailsSidebarProps) {
  const queryClient = useQueryClient();
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateDemo, setShowCreateDemo] = useState(false);
  const [showCreateAudit, setShowCreateAudit] = useState(false);
  const [localStageId, setLocalStageId] = useState<string | null>(null);
  const [localStageName, setLocalStageName] = useState<string | null>(null);
  const [savingStage, setSavingStage] = useState(false);

  const { data: oppData, isLoading: oppLoading } = useQuery<{
    opportunity: (GHLOpportunity & { pipelineStageId_name: string }) | null;
    stageName?: string;
  }>({
    queryKey: ["contact-opportunity", contactId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (contactName) params.set("name", contactName);
      const res = await fetch(`/api/ghl/contacts/${contactId}/opportunity?${params}`);
      if (!res.ok) return { opportunity: null };
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 2 * 60 * 1000,
    // Sync local stage state when fresh data arrives
    select: (data) => {
      return data;
    },
  });

  // Fetch pipeline stages for the stage change dropdown
  const { data: pipelinesData } = useQuery<{
    pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string; position?: number }> }>;
  }>({
    queryKey: ["pipelines"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/pipelines");
      if (!res.ok) throw new Error("Failed to fetch pipelines");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!oppData?.opportunity,
  });

  const opp = oppData?.opportunity ?? null;
  const serverStageName = oppData?.stageName ?? opp?.pipelineStageId_name ?? null;

  // Sync local stage from server when opp loads (only if not mid-save)
  const displayStageName = localStageName ?? serverStageName;
  const displayStageId = localStageId ?? opp?.pipelineStageId ?? "";

  const pipelineStages = opp
    ? (pipelinesData?.pipelines?.find((p) => p.id === opp.pipelineId)?.stages ?? [])
        .slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : [];

  const pipelineName = opp
    ? pipelinesData?.pipelines?.find((p) => p.id === opp.pipelineId)?.name
    : null;

  const isLoading = oppLoading;

  async function handleStageChange(stageId: string) {
    if (!opp || stageId === displayStageId) return;
    const stage = pipelineStages.find((s) => s.id === stageId);
    if (!stage) return;
    setSavingStage(true);
    setLocalStageId(stage.id);
    setLocalStageName(stage.name);
    try {
      await fetch(`/api/ghl/opportunities/${opp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineStageId: stage.id }),
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["opportunities"] });
        queryClient.invalidateQueries({ queryKey: ["contact-opportunity", contactId] });
      }, 2000);
    } catch {
      setLocalStageId(opp.pipelineStageId);
      setLocalStageName(serverStageName);
    } finally {
      setSavingStage(false);
    }
  }

  return (
    <>
    <div data-r10n-leadsidebar className="w-72 shrink-0 border-l border-border bg-card flex flex-col overflow-y-auto">
      {/* Header — contact + stage at a glance */}
      <div className="px-4 py-4 border-b border-border shrink-0">
        <p data-r10n-sidebar-label className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.14em] mb-1.5">Lead details</p>
        {contactName && (
          <p data-r10n-sidebar-name className="text-[15px] font-bold text-foreground tracking-[-0.01em] truncate mb-2.5" style={{ fontFamily: "var(--font-heading)" }}>{contactName}</p>
        )}
        {opp && displayStageName && (
          savingStage ? (
            <span data-r10n-status-pill data-status="open" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-primary/30 bg-primary/5 text-primary">
              <RefreshCw className="w-3 h-3 animate-spin" /> Saving…
            </span>
          ) : (
            <span data-r10n-status-pill data-status={stageStatusTier(displayStageName)} className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border", stageBadgeClass(displayStageName))}>
              {displayStageName}
            </span>
          )
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : (
        <div className="flex flex-col">

          {/* ── Pipeline / value ───────────────────────────────── */}
          <div className="px-4 py-4 space-y-3 border-b border-border/60">
            {opp ? (
              <>
                {/* Deal value — prominent */}
                {opp.monetaryValue != null && opp.monetaryValue > 0 && (
                  <div data-r10n-sidebar-card className="flex items-center justify-between rounded-[10px] border border-border/60 bg-muted/20 px-3.5 py-3">
                    <span data-r10n-sidebar-cardlabel className="text-xs text-muted-foreground">Deal value</span>
                    <span data-r10n-sidebar-dealvalue className="text-lg font-bold text-foreground tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
                      ${opp.monetaryValue.toLocaleString()}
                    </span>
                  </div>
                )}

                {/* Change stage */}
                <div data-r10n-sidebar-card className="rounded-[10px] border border-border/60 bg-muted/20 px-3 py-2.5">
                  <p data-r10n-sidebar-cardlabel className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1.5"><TrendingUp data-r10n-sidebar-cardicon className="w-3 h-3" /> Change stage</p>
                  <select
                    value={displayStageId}
                    onChange={(e) => handleStageChange(e.target.value)}
                    disabled={pipelineStages.length === 0 || savingStage}
                    data-r10n-sidebar-select
                    className="w-full text-sm font-medium text-foreground bg-transparent border-none outline-none cursor-pointer appearance-none disabled:opacity-50"
                  >
                    {pipelineStages.length === 0 && (
                      <option value={displayStageId}>{displayStageName ?? "Unknown"}</option>
                    )}
                    {pipelineStages.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {pipelineName && <p data-r10n-sidebar-meta className="text-[11px] text-muted-foreground px-0.5">{pipelineName}{opp.contact?.companyName ? ` · ${opp.contact.companyName}` : ""}</p>}
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">No opportunity found</p>
            )}
          </div>

          {/* ── Quick Actions ──────────────────────────────────── */}
          {/* Shown whenever we have a contact (e.g. GHL-synced Instagram DMs that have
              no opportunity yet) — not only when an opportunity exists. */}
          {(contactId || opp) && (
            <div className="px-4 py-4 border-b border-border/60">
              <h4 data-r10n-sidebar-section className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em] mb-2.5">
                Quick actions
              </h4>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: ListTodo, label: "Task", onClick: () => setShowCreateTask(true) },
                  { icon: Layers, label: "Demo", onClick: () => setShowCreateDemo(true) },
                  { icon: ClipboardCheck, label: "Audit", onClick: () => setShowCreateAudit(true) },
                ].map(({ icon: Icon, label, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    data-r10n-quickaction
                    className="group flex flex-col items-center gap-1.5 py-3 text-[11px] font-medium text-foreground border border-border rounded-[9px] hover:border-primary/40 hover:bg-primary/[0.03] transition-all active:scale-[0.97]"
                  >
                    <span data-r10n-quickaction-icon className="w-7 h-7 rounded-[7px] bg-muted/70 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Tags ───────────────────────────────────────────── */}
          {opp?.contact?.tags && opp.contact.tags.length > 0 && (
            <div className="px-4 py-4 border-b border-border/60 space-y-2.5">
              <h4 data-r10n-sidebar-section className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Tag className="w-3 h-3" />
                Tags
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {opp.contact.tags.map((tag) => (
                  <span key={tag} data-r10n-sidebar-tag className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Qualification Q&A ──────────────────────────────── */}
          {/* Shared resolver: lead-form custom fields first (new + old forms),
              qualification-note fallback for the oldest leads. */}
          <div className="px-4 py-4">
            <QualificationPreview contactId={contactId} limit={6} />
          </div>

        </div>
      )}
    </div>

    {/* Modals — fall back to the contactId prop when there's no opportunity yet
        (GHL-synced Instagram DMs), so Quick Actions work for any contact. */}
    {showCreateTask && (
      <CreateTaskModal
        contactId={opp?.contact?.id ?? contactId}
        contactName={opp?.contact?.name ?? contactName}
        opportunityId={opp?.id}
        onClose={() => setShowCreateTask(false)}
      />
    )}
    {showCreateDemo && (
      <CreateDemoModal
        contactId={opp?.contact?.id ?? contactId}
        contactName={opp?.contact?.name ?? contactName}
        contactEmail={opp?.contact?.email}
        contactPhone={opp?.contact?.phone}
        opportunityId={opp?.id}
        opportunitySource={opp?.source}
        onClose={() => setShowCreateDemo(false)}
      />
    )}
    {showCreateAudit && (
      <CreateAuditModal
        contactId={opp?.contact?.id ?? contactId}
        contactName={opp?.contact?.name ?? contactName}
        onClose={() => setShowCreateAudit(false)}
      />
    )}
    </>
  );
}
