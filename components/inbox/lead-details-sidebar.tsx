"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, ExternalLink, Tag, TrendingUp, FileText,
  ListTodo, Layers, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { parseQualificationNote, isQualificationNote, cleanUrl } from "@/lib/utils/url";
import { CreateTaskModal } from "@/components/shared/create-task-modal";
import { CreateDemoModal } from "@/components/shared/create-demo-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";

interface Note {
  id: string;
  body: string;
  dateAdded?: string;
  createdAt?: string;
}

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

export function LeadDetailsSidebar({ contactId, contactName = "" }: LeadDetailsSidebarProps) {
  const queryClient = useQueryClient();
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateDemo, setShowCreateDemo] = useState(false);
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

  const { data: notesData, isLoading: notesLoading } = useQuery<{ notes: Note[] }>({
    queryKey: ["notes", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/contacts/${contactId}/notes`);
      if (!res.ok) return { notes: [] };
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 2 * 60 * 1000,
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

  const notes = notesData?.notes ?? [];
  const qualNote = notes.find((n) => isQualificationNote(n.body));
  const qaPairs = qualNote ? parseQualificationNote(qualNote.body) : [];
  const isLoading = oppLoading || notesLoading;

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
    <div className="w-72 shrink-0 border-l border-border bg-card flex flex-col overflow-y-auto">
      {/* Header — contact + stage at a glance */}
      <div className="px-4 py-4 border-b border-border shrink-0">
        <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.14em] mb-1.5">Lead details</p>
        {contactName && (
          <p className="text-[15px] font-bold text-foreground tracking-[-0.01em] truncate mb-2.5" style={{ fontFamily: "var(--font-heading)" }}>{contactName}</p>
        )}
        {opp && displayStageName && (
          savingStage ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-primary/30 bg-primary/5 text-primary">
              <RefreshCw className="w-3 h-3 animate-spin" /> Saving…
            </span>
          ) : (
            <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border", stageBadgeClass(displayStageName))}>
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
                  <div className="flex items-center justify-between rounded-[10px] border border-border/60 bg-muted/20 px-3.5 py-3">
                    <span className="text-xs text-muted-foreground">Deal value</span>
                    <span className="text-lg font-bold text-foreground tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
                      ${opp.monetaryValue.toLocaleString()}
                    </span>
                  </div>
                )}

                {/* Change stage */}
                <div className="rounded-[10px] border border-border/60 bg-muted/20 px-3 py-2.5">
                  <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1.5"><TrendingUp className="w-3 h-3" /> Change stage</p>
                  <select
                    value={displayStageId}
                    onChange={(e) => handleStageChange(e.target.value)}
                    disabled={pipelineStages.length === 0 || savingStage}
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

                {pipelineName && <p className="text-[11px] text-muted-foreground px-0.5">{pipelineName}{opp.contact?.companyName ? ` · ${opp.contact.companyName}` : ""}</p>}
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">No opportunity found</p>
            )}
          </div>

          {/* ── Quick Actions ──────────────────────────────────── */}
          {opp && (
            <div className="px-4 py-4 border-b border-border/60">
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em] mb-2.5">
                Quick actions
              </h4>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: ListTodo, label: "Task", onClick: () => setShowCreateTask(true) },
                  { icon: Layers, label: "Demo", onClick: () => setShowCreateDemo(true) },
                  { icon: ClipboardCheck, label: "Audit", onClick: undefined },
                ].map(({ icon: Icon, label, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    className="group flex flex-col items-center gap-1.5 py-3 text-[11px] font-medium text-foreground border border-border rounded-[9px] hover:border-primary/40 hover:bg-primary/[0.03] transition-all active:scale-[0.97]"
                  >
                    <span className="w-7 h-7 rounded-[7px] bg-muted/70 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
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
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Tag className="w-3 h-3" />
                Tags
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {opp.contact.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Qualification Q&A ──────────────────────────────── */}
          <div className="px-4 py-4 space-y-2.5">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <FileText className="w-3 h-3" />
              Qualification
            </h4>
            {qaPairs.length > 0 ? (
              <div className="space-y-2">
                {qaPairs.map((qa, i) => (
                  <div key={i} className="bg-muted/30 rounded-[7px] p-2.5 border border-border/50">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 leading-tight">
                      {qa.question}
                    </p>
                    {qa.isUrl && qa.cleanedUrl ? (
                      <a
                        href={qa.cleanedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1 break-all"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        {qa.cleanedUrl}
                      </a>
                    ) : (
                      <p className="text-xs text-foreground leading-relaxed">{qa.answer}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No qualification data</p>
            )}
          </div>

        </div>
      )}
    </div>

    {/* Modals */}
    {showCreateTask && opp && (
      <CreateTaskModal
        contactId={opp.contact?.id}
        contactName={opp.contact?.name}
        opportunityId={opp.id}
        onClose={() => setShowCreateTask(false)}
      />
    )}
    {showCreateDemo && opp && (
      <CreateDemoModal
        contactId={opp.contact?.id}
        contactName={opp.contact?.name}
        contactEmail={opp.contact?.email}
        contactPhone={opp.contact?.phone}
        opportunityId={opp.id}
        opportunitySource={opp.source}
        onClose={() => setShowCreateDemo(false)}
      />
    )}
    </>
  );
}
