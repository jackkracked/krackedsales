"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Pin, PinOff, ChevronRight } from "lucide-react";
import { NODE_CATALOG } from "@/lib/workflows/node-catalog";
import { useWorkflowCanvasStore } from "@/store/workflow-canvas-store";
import { cn } from "@/lib/utils/cn";
import { VariableInput, buildVariableGroups, type VariableGroup } from "./VariableInput";

interface NodePanelProps {
  workflowId: string;
  nodeId: string | null;
  onClose: () => void;
  onStartListening?: () => void;
}

export function NodePanel({ workflowId, nodeId, onClose, onStartListening }: NodePanelProps) {
  const { nodes, edges, updateNodeData } = useWorkflowCanvasStore();

  const node = nodeId ? nodes.find((n) => n.id === nodeId) : null;
  const def = node ? NODE_CATALOG.find((d) => d.type === (node.type ?? "")) : null;

  const nodeData = (node?.data ?? {}) as Record<string, unknown>;
  const config = (nodeData.config ?? {}) as Record<string, unknown>;

  const isTrigger = node?.type?.startsWith("trigger.") ?? false;

  const variableGroups: VariableGroup[] = useMemo(() => {
    if (!nodeId) return [];
    return buildVariableGroups(nodeId, nodes, edges);
  }, [nodeId, nodes, edges]);

  const upstreamEdge = nodeId ? edges.find((e) => e.target === nodeId) : null;
  const upstreamNode = upstreamEdge ? nodes.find((n) => n.id === upstreamEdge.source) : null;
  const upstreamLabel = upstreamNode
    ? String((upstreamNode.data as Record<string, unknown>)?.label ?? upstreamNode.type)
    : null;

  const [executing, setExecuting] = useState(false);
  const [execOutput, setExecOutput] = useState<Record<string, unknown> | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [noUpstream, setNoUpstream] = useState(false);

  const pinnedOutput = nodeData.pinnedOutput as Record<string, unknown> | undefined;
  const isPinned = !!pinnedOutput;

  useEffect(() => {
    setExecuting(false);
    setExecOutput(null);
    setExecError(null);
    setNoUpstream(false);
  }, [nodeId]);

  const handleExecute = useCallback(async () => {
    if (!nodeId || executing) return;

    if (isTrigger) {
      onStartListening?.();
      return;
    }

    setExecuting(true);
    setExecOutput(null);
    setExecError(null);
    setNoUpstream(false);

    try {
      const res = await fetch(`/api/workflows/${workflowId}/nodes/${nodeId}/execute`, {
        method: "POST",
      });
      const data = await res.json() as Record<string, unknown>;

      if (data.isTrigger) {
        onStartListening?.();
        return;
      }
      if (data.noUpstreamData) {
        setNoUpstream(true);
        return;
      }
      if (data.error && !data.output) {
        setExecError(String(data.error));
        return;
      }
      if (data.output) {
        const output = data.output as Record<string, unknown>;
        setExecOutput(output);
        updateNodeData(nodeId, {
          lastRunOutput: output,
          isRunSuccess: true,
          isRunError: false,
        });
      }
    } catch (err) {
      setExecError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setExecuting(false);
    }
  }, [nodeId, workflowId, isTrigger, executing, onStartListening, updateNodeData]);

  const handleExecuteRef = useRef(handleExecute);
  useEffect(() => { handleExecuteRef.current = handleExecute; }, [handleExecute]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId: targetId } = (e as CustomEvent<{ nodeId: string }>).detail;
      if (targetId === nodeId) handleExecuteRef.current();
    };
    document.addEventListener("wf:execute-node", handler);
    return () => document.removeEventListener("wf:execute-node", handler);
  }, [nodeId]);

  const handlePin = useCallback(() => {
    if (!nodeId) return;
    if (isPinned) {
      updateNodeData(nodeId, { pinnedOutput: undefined });
    } else if (execOutput) {
      updateNodeData(nodeId, { pinnedOutput: execOutput });
    }
  }, [nodeId, isPinned, execOutput, updateNodeData]);

  const updateConfig = useCallback(
    (key: string, value: unknown) => {
      if (!nodeId) return;
      updateNodeData(nodeId, { config: { ...config, [key]: value } });
    },
    [nodeId, config, updateNodeData]
  );

  const updateLabel = useCallback(
    (label: string) => {
      if (!nodeId) return;
      updateNodeData(nodeId, { label });
    },
    [nodeId, updateNodeData]
  );

  if (!node || !def) {
    return (
      <div className="w-[320px] h-full flex items-center justify-center border-l border-border bg-card text-muted-foreground text-sm">
        Select a node to configure it
      </div>
    );
  }

  return (
    <div className="w-[320px] h-full flex flex-col border-l border-border bg-card shrink-0">
      {/* Header */}
      <div className="shrink-0 px-5 pt-5 pb-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span className="text-xl shrink-0">{def.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground leading-none mb-1">
              {def.category}
            </p>
            <input
              value={String(nodeData.label ?? "")}
              onChange={(e) => updateLabel(e.target.value)}
              placeholder={def.label}
              className="w-full text-sm font-bold bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-border/60 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{def.description}</p>
      </div>

      {/* Config fields */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4 space-y-5">
          {def.configFields.length === 0 ? (
            <div className="space-y-4">
              {/* Last captured payload — shown after Listen */}
              {nodeData.lastRunOutput ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-emerald-600">Last captured payload</p>
                    <span className="text-[10px] text-muted-foreground">Use{" "}
                      <kbd className="font-mono bg-muted border border-border px-1 py-0.5 rounded text-[10px]">/</kbd>
                      {" "}in any field to reference these
                    </span>
                  </div>
                  <pre className="text-[11px] bg-muted/50 border border-border rounded-xl p-3 overflow-x-auto font-mono text-foreground/80 leading-relaxed max-h-96">
                    {JSON.stringify(nodeData.lastRunOutput, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-2xl mb-2">⚡</p>
                  <p className="text-sm font-medium text-foreground mb-1">Trigger node</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    No configuration needed. Press <strong>Test → Listen for event</strong> below to capture a sample payload.
                  </p>
                </div>
              )}
            </div>
          ) : (
            def.configFields.map((field) => (
              <div key={field.key}>
                <div className="flex items-baseline gap-1.5 mb-1.5">
                  <label className="text-xs font-semibold text-foreground/80">
                    {field.label}
                  </label>
                  {field.required && (
                    <span className="text-[10px] font-bold text-red-500">required</span>
                  )}
                </div>

                {field.description && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
                    {field.description}
                  </p>
                )}

                {field.type === "text" && (
                  <VariableInput
                    value={String(config[field.key] ?? "")}
                    onChange={(v) => updateConfig(field.key, v)}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all font-mono placeholder:text-muted-foreground/50"
                    variableGroups={variableGroups}
                  />
                )}

                {field.type === "number" && (
                  <input
                    type="number"
                    value={String(config[field.key] ?? "")}
                    onChange={(e) => updateConfig(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                  />
                )}

                {field.type === "textarea" && (
                  <VariableInput
                    as="textarea"
                    value={String(config[field.key] ?? "")}
                    onChange={(v) => updateConfig(field.key, v)}
                    placeholder={field.placeholder}
                    rows={4}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all font-mono placeholder:text-muted-foreground/50 resize-y"
                    variableGroups={variableGroups}
                  />
                )}

                {field.type === "code" && (
                  <VariableInput
                    as="textarea"
                    value={String(config[field.key] ?? "")}
                    onChange={(v) => updateConfig(field.key, v)}
                    placeholder={field.placeholder}
                    rows={8}
                    className="w-full px-3 py-2 text-xs bg-zinc-950 text-green-400 border border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/30 transition-all font-mono resize-y"
                    variableGroups={variableGroups}
                  />
                )}

                {field.type === "select" && (
                  <select
                    value={String(config[field.key] ?? "")}
                    onChange={(e) => updateConfig(field.key, e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all appearance-none"
                  >
                    <option value="">Select…</option>
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                )}

                {field.type === "pairs" && (
                  <PairsEditor
                    value={(config[field.key] as Array<{ key: string; value: string }>) ?? []}
                    onChange={(pairs) => updateConfig(field.key, pairs)}
                    variableGroups={variableGroups}
                  />
                )}
              </div>
            ))
          )}

          {/* Variable hint */}
          <div className="flex items-start gap-2 p-3 bg-muted/40 rounded-xl border border-border/50">
            <span className="text-base mt-0.5">💡</span>
            <div>
              <p className="text-[11px] font-semibold text-foreground/70 mb-0.5">Variables</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Type{" "}
                <kbd className="font-mono bg-background border border-border px-1 py-0.5 rounded text-[10px]">/</kbd>
                {" "}in any field to insert a variable from upstream nodes.
              </p>
            </div>
          </div>
        </div>

        {/* Test section */}
        <div className="px-5 pb-5">
          <div className="border border-border rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
              <span className="text-xs font-semibold text-foreground/70">Test</span>
              {!isTrigger && upstreamLabel && !noUpstream && (
                <>
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">using output from{" "}
                    <span className="font-semibold text-foreground">{upstreamLabel}</span>
                  </span>
                </>
              )}
            </div>
            <div className="p-3 space-y-3">
              {noUpstream && (
                <p className="text-[11px] text-muted-foreground text-center py-1">
                  No upstream data — run the full workflow first
                </p>
              )}

              <button
                onClick={handleExecute}
                disabled={executing}
                className={cn(
                  "flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50",
                  isTrigger
                    ? "bg-amber-500/10 text-amber-600 border border-amber-500/30 hover:bg-amber-500/15"
                    : "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
                )}
              >
                {executing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <span className="text-sm">{isTrigger ? "👂" : "▶"}</span>
                )}
                {isTrigger ? "Listen for event" : "Execute"}
              </button>

              {execError && (
                <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-1.5">Error</p>
                  <p className="text-[11px] text-red-400 font-mono break-all leading-relaxed">{execError}</p>
                </div>
              )}

              {execOutput && !execError && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                      Output
                    </p>
                    <button
                      onClick={handlePin}
                      className={cn(
                        "flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-colors",
                        isPinned
                          ? "bg-amber-500/20 text-amber-500"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {isPinned ? (
                        <><PinOff className="w-2.5 h-2.5" /> Pinned</>
                      ) : (
                        <><Pin className="w-2.5 h-2.5" /> Pin</>
                      )}
                    </button>
                  </div>
                  <pre className="text-[10px] bg-zinc-950 text-zinc-300 border border-zinc-800 rounded-xl p-3 overflow-x-auto font-mono max-h-48 leading-relaxed">
                    {JSON.stringify(execOutput, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PairsEditor({
  value,
  onChange,
  variableGroups,
}: {
  value: Array<{ key: string; value: string }>;
  onChange: (pairs: Array<{ key: string; value: string }>) => void;
  variableGroups: VariableGroup[];
}) {
  const pairs = value.length > 0 ? value : [{ key: "", value: "" }];

  return (
    <div className="space-y-2">
      {pairs.map((pair, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            value={pair.key}
            onChange={(e) => {
              const next = [...pairs];
              next[i] = { ...next[i], key: e.target.value };
              onChange(next);
            }}
            placeholder="key"
            className="flex-1 px-2.5 py-1.5 text-xs bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />
          <VariableInput
            value={pair.value}
            onChange={(v) => {
              const next = [...pairs];
              next[i] = { ...next[i], value: v };
              onChange(next);
            }}
            placeholder="value or {{var}}"
            className="flex-1 px-2.5 py-1.5 text-xs bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
            variableGroups={variableGroups}
          />
          <button
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            className="text-muted-foreground hover:text-red-500 text-sm px-1 transition-colors"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...pairs, { key: "", value: "" }])}
        className="text-[11px] font-semibold text-primary hover:text-primary/70 transition-colors"
      >
        + Add variable
      </button>
    </div>
  );
}
