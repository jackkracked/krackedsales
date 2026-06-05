"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { ReactFlowProvider, type Node, type Edge } from "@xyflow/react";
import { WorkflowCanvas } from "@/components/workflows/canvas/WorkflowCanvas";
import { NodeLibrary } from "@/components/workflows/canvas/NodeLibrary";
import { NodePanel } from "@/components/workflows/canvas/NodePanel";
import { ExecutionsView } from "@/components/workflows/canvas/ExecutionsView";
import { useWorkflowCanvasStore } from "@/store/workflow-canvas-store";
import { NODE_CATALOG } from "@/lib/workflows/node-catalog";
import { ArrowLeft, Save, Play, Loader2, CheckCircle2, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import Link from "next/link";

interface WorkflowDetail {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  nodes: Node[];
  edges: Edge[];
  viewport: unknown;
}

export default function WorkflowCanvasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"editor" | "executions">("editor");
  const [libraryCollapsed, setLibraryCollapsed] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const listeningRef = useRef<NodeJS.Timeout | null>(null);
  const lastRunIdRef = useRef<string | null>(null);
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null);
  const preListenEnabledRef = useRef(false);

  const { nodes, edges, viewport, setNodes, setEdges, setIsDirty, isDirty, updateNodeData } =
    useWorkflowCanvasStore();

  const latestValuesRef = useRef({ nodes, edges, viewport, workflowName, enabled });
  useEffect(() => {
    latestValuesRef.current = { nodes, edges, viewport, workflowName, enabled };
  }, [nodes, edges, viewport, workflowName, enabled]);

  // Load workflow
  useEffect(() => {
    fetch(`/api/workflows/${id}`)
      .then((r) => r.json())
      .then((data: WorkflowDetail) => {
        setWorkflowName(data.name);
        setEnabled(data.enabled);
        setNodes(Array.isArray(data.nodes) ? data.nodes : [], false);
        setEdges(Array.isArray(data.edges) ? data.edges : [], false);
        setIsDirty(false);
      })
      .finally(() => setLoading(false));
  }, [id, setNodes, setEdges, setIsDirty]);

  // Save
  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await fetch(`/api/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workflowName, enabled, nodes, edges, viewport }),
      });
      setIsDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [id, workflowName, enabled, nodes, edges, viewport, saving, setIsDirty]);

  // Autosave — 1.5s debounce after any dirty change
  useEffect(() => {
    if (!isDirty) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      const v = latestValuesRef.current;
      setSaving(true);
      try {
        await fetch(`/api/workflows/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: v.workflowName, enabled: v.enabled, nodes: v.nodes, edges: v.edges, viewport: v.viewport }),
        });
        setIsDirty(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } finally {
        setSaving(false);
      }
    }, 1500);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
  }, [isDirty, id, setIsDirty]);

  // Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  // Add node from library
  const handleAddNode = useCallback(
    (type: string) => {
      const def = NODE_CATALOG.find((d) => d.type === type);
      if (!def) return;
      const newNode: Node = {
        id: `${type}_${Date.now()}`,
        type,
        position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: { label: def.label, nodeType: type, icon: def.icon, category: def.category, config: {} },
      };
      setNodes([...nodes, newNode]);
    },
    [nodes, setNodes]
  );

  // Run workflow
  const handleRun = useCallback(async () => {
    if (running) return;
    await save();
    setRunning(true);
    try {
      await fetch(`/api/workflows/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerData: {} }),
      });
      setSelectedNodeId(null);
      setMode("executions");
    } finally {
      setRunning(false);
    }
  }, [id, running, save]);

  // Listen mode
  const startListening = useCallback(async () => {
    const v = latestValuesRef.current;
    preListenEnabledRef.current = !v.enabled;

    // Single PATCH: save latest canvas state, force enabled=true, and set listenMode so
    // the executor stops after the trigger node (no downstream actions fire during capture)
    await fetch(`/api/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: v.workflowName,
        enabled: true,
        listenMode: true,
        nodes: v.nodes,
        edges: v.edges,
        viewport: v.viewport,
      }),
    });
    setIsDirty(false);

    // Update React state so latestValuesRef reflects enabled=true
    setEnabled(true);

    // Visually mark all trigger nodes as "listening" on the canvas
    const store = useWorkflowCanvasStore.getState();
    store.nodes.filter((n) => n.type?.startsWith("trigger.")).forEach((n) => {
      store.updateNodeData(n.id, { isListening: true });
    });

    // Clear dirty flag AFTER updateNodeData — updateNodeData always sets isDirty: true,
    // and the autosave effect would fire 1.5s later using latestValuesRef.current.enabled
    // which was still false before the setEnabled(true) call above.
    setIsDirty(false);

    const res = await fetch(`/api/workflows/${id}/runs`);
    const runs = await res.json() as Array<{ id: string; status: string }>;
    lastRunIdRef.current = runs[0]?.id ?? null;
    setIsListening(true);
    setSelectedNodeId(null);
  }, [id, setIsDirty]);

  const stopListening = useCallback(() => {
    setIsListening(false);
    if (listeningRef.current) {
      clearInterval(listeningRef.current);
      listeningRef.current = null;
    }
    // Always clear listenMode, and restore enabled state if we temporarily enabled it
    fetch(`/api/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listenMode: false,
        ...(preListenEnabledRef.current ? { enabled: false } : {}),
      }),
    }).catch(() => {});
    preListenEnabledRef.current = false;
    // Clear listening indicator from trigger nodes
    const store = useWorkflowCanvasStore.getState();
    store.nodes.filter((n) => n.type?.startsWith("trigger.")).forEach((n) => {
      store.updateNodeData(n.id, { isListening: false });
    });
  }, [id]);

  useEffect(() => {
    if (!isListening) return;
    listeningRef.current = setInterval(async () => {
      const res = await fetch(`/api/workflows/${id}/runs`);
      const runs = await res.json() as Array<{ id: string; status: string; triggerEvent: string }>;
      if (runs[0] && runs[0].id !== lastRunIdRef.current) {
        lastRunIdRef.current = runs[0].id;
        const detailRes = await fetch(`/api/workflows/${id}/runs/${runs[0].id}`);
        const detail = await detailRes.json() as {
          logs: Array<{ nodeId: string; status: string; outputData: Record<string, unknown> | null }>;
        };
        for (const log of detail.logs) {
          updateNodeData(log.nodeId, {
            isRunSuccess: log.status === "success",
            isRunError: log.status === "error",
            isRunning: log.status === "running",
            lastRunOutput: log.outputData,
          });
        }
        // Switch to executions tab so the result is visible
        setMode("executions");
        stopListening();
      }
    }, 2000);
    return () => { if (listeningRef.current) clearInterval(listeningRef.current); };
  }, [isListening, id, updateNodeData, stopListening]);

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-muted/40">
      {/* Top bar row */}
      <div className="shrink-0 px-4 pt-3 pb-0 pointer-events-none relative flex items-center justify-center">

        {/* + Add node — top left, in line with bar */}
        {mode === "editor" && libraryCollapsed && (
          <button
            onClick={() => setLibraryCollapsed(false)}
            className="absolute left-4 w-9 h-9 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition-colors pointer-events-auto"
            title="Add node"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}

        {/* Centered floating bar */}
        <div className="flex items-center gap-3 px-4 py-2 bg-card border border-border rounded-[12px] shadow-sm pointer-events-auto max-w-fit">
        <Link
          href="/workflows"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-border/50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        {/* Editable name — auto-sizes to content */}
        <input
          value={workflowName}
          onChange={(e) => { setWorkflowName(e.target.value); setIsDirty(true); }}
          size={Math.max((workflowName || "Workflow name...").length, 16)}
          className="text-sm font-bold bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground"
          placeholder="Workflow name..."
        />

        {/* Editor / Executions pill toggle */}
        <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
          {(["editor", "executions"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                if (m === "editor") setSelectedNodeId(null);
              }}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-semibold transition-colors",
                mode === m
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Test / Listen — editor mode only */}
        {mode === "editor" && (
          <button
            onClick={isListening ? stopListening : startListening}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
              isListening
                ? "bg-amber-500 text-white animate-pulse"
                : "bg-border/50 text-muted-foreground hover:text-foreground hover:bg-border"
            )}
            title={isListening ? "Stop listening" : "Listen for next event"}
          >
            <span>{isListening ? "⏸" : "👂"}</span>
            {isListening ? "Listening…" : "Test"}
          </button>
        )}

        {/* Save */}
        <button
          onClick={save}
          disabled={saving}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
            saved
              ? "bg-green-500/10 text-green-600 border border-green-500/30"
              : isDirty
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-border/50 text-muted-foreground"
          )}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {saved ? "Saved" : "Save"}
        </button>

        {/* Run Now */}
        <button
          onClick={handleRun}
          disabled={running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Run Now
        </button>
        </div>

        {/* Enable toggle — top right, in line with bar */}
        <div className="absolute right-4 flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-[12px] shadow-sm pointer-events-auto">
          <span className="text-xs text-muted-foreground">{enabled ? "Enabled" : "Disabled"}</span>
          <button
            onClick={() => { setEnabled(!enabled); setIsDirty(true); }}
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              enabled ? "bg-green-500" : "bg-muted"
            )}
          >
            <span className={cn(
              "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-4" : "translate-x-1"
            )} />
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {mode === "editor" ? (
          <>
            <NodeLibrary
              onAddNode={handleAddNode}
              collapsed={libraryCollapsed}
              onToggle={() => setLibraryCollapsed(!libraryCollapsed)}
              showCollapsedButton={false}
            />

            <ReactFlowProvider>
              <div className="flex-1 relative min-w-0">
                <WorkflowCanvas
                  onNodeSelect={handleNodeSelect}
                  onOpenLibrary={() => setLibraryCollapsed(false)}
                />
              </div>
            </ReactFlowProvider>

            {selectedNodeId && (
              <NodePanel
                workflowId={id}
                nodeId={selectedNodeId}
                onClose={() => setSelectedNodeId(null)}
                onStartListening={startListening}
              />
            )}
          </>
        ) : (
          <ExecutionsView workflowId={id} nodes={nodes} edges={edges} />
        )}
      </div>
    </div>
  );
}
