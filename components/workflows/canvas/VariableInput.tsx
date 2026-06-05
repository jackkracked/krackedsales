"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Node, Edge } from "@xyflow/react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VariableItem {
  path: string;
  value: unknown;
}

export interface VariableGroup {
  nodeId: string;
  nodeName: string;
  items: VariableItem[];
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Flatten an object into dot-notation paths up to maxDepth levels. */
function flattenObject(obj: Record<string, unknown>, maxDepth = 3): VariableItem[] {
  const result: VariableItem[] = [];

  function walk(o: unknown, path: string, depth: number) {
    if (depth > maxDepth) return;
    if (o !== null && typeof o === "object" && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        const itemPath = path ? `${path}.${k}` : k;
        result.push({ path: itemPath, value: v });
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          walk(v, itemPath, depth + 1);
        }
      }
    }
  }

  walk(obj, "", 1);
  return result;
}

/** Build variable groups from all ancestor nodes that have run output. */
export function buildVariableGroups(
  currentNodeId: string,
  nodes: Node[],
  edges: Edge[]
): VariableGroup[] {
  // BFS backwards to find all ancestor node IDs
  const ancestors = new Set<string>();
  const queue = [currentNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.target === id && !ancestors.has(edge.source)) {
        ancestors.add(edge.source);
        queue.push(edge.source);
      }
    }
  }

  const ancestorNodes = nodes.filter((n) => ancestors.has(n.id));

  // Deduplicate node display names (append " 1", " 2" for collisions)
  const labelCount = new Map<string, number>();
  for (const node of ancestorNodes) {
    const label = String((node.data as Record<string, unknown>)?.label ?? node.type ?? node.id);
    labelCount.set(label, (labelCount.get(label) ?? 0) + 1);
  }
  const labelSeen = new Map<string, number>();
  const nodeNames = new Map<string, string>();
  for (const node of ancestorNodes) {
    const label = String((node.data as Record<string, unknown>)?.label ?? node.type ?? node.id);
    if ((labelCount.get(label) ?? 0) > 1) {
      const seen = (labelSeen.get(label) ?? 0) + 1;
      labelSeen.set(label, seen);
      nodeNames.set(node.id, `${label} ${seen}`);
    } else {
      nodeNames.set(node.id, label);
    }
  }

  // Only include nodes that have last-run output data
  const groups: VariableGroup[] = [];
  for (const node of ancestorNodes) {
    const data = node.data as Record<string, unknown>;
    const output = data.lastRunOutput as Record<string, unknown> | null | undefined;
    if (!output) continue;
    const items = flattenObject(output);
    if (items.length === 0) continue;
    groups.push({
      nodeId: node.id,
      nodeName: nodeNames.get(node.id) ?? node.id,
      items,
    });
  }

  return groups;
}

/** Format a value for the picker's preview column. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 32 ? v.slice(0, 32) + "…" : v;
  if (Array.isArray(v)) return `[Array, ${v.length} items]`;
  if (typeof v === "object") return "{Object}";
  return String(v);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface VariableInputProps {
  as?: "input" | "textarea";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  variableGroups: VariableGroup[];
}

export function VariableInput({
  as: Tag = "input",
  value,
  onChange,
  placeholder,
  className,
  rows,
  variableGroups,
}: VariableInputProps) {
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [slashPos, setSlashPos] = useState(0);
  const [filter, setFilter] = useState("");
  const [popoverRect, setPopoverRect] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const openPicker = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPopoverRect({ left: rect.left, top: rect.bottom + 4, width: rect.width });
    setPickerOpen(true);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const newVal = e.target.value;
      const cursor = e.target.selectionStart ?? newVal.length;

      if (newVal.length > value.length) {
        const charAdded = newVal[cursor - 1];
        if (charAdded === "/") {
          setSlashPos(cursor - 1);
          setFilter("");
          openPicker();
        } else if (pickerOpen) {
          const filterText = newVal.slice(slashPos + 1, cursor);
          if (filterText.includes(" ") || cursor <= slashPos) {
            setPickerOpen(false);
          } else {
            setFilter(filterText);
          }
        }
      } else if (pickerOpen) {
        if (cursor <= slashPos) {
          setPickerOpen(false);
        } else {
          setFilter(newVal.slice(slashPos + 1, cursor));
        }
      }

      onChange(newVal);
    },
    [value, slashPos, pickerOpen, onChange, openPicker]
  );

  const insertVariable = useCallback(
    (nodeName: string, path: string) => {
      const syntax = `{{${nodeName}.${path}}}`;
      const before = value.slice(0, slashPos);
      const after = value.slice(slashPos + 1 + filter.length);
      const newVal = before + syntax + after;
      onChange(newVal);
      setPickerOpen(false);
      requestAnimationFrame(() => {
        if (!inputRef.current) return;
        inputRef.current.focus();
        const newCursor = slashPos + syntax.length;
        inputRef.current.setSelectionRange(newCursor, newCursor);
      });
    },
    [value, slashPos, filter, onChange]
  );

  // Close on Escape
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pickerOpen]);

  // Filter groups by typed text
  const filterLower = filter.toLowerCase();
  const filteredGroups = variableGroups
    .map((group) => ({
      ...group,
      items: filter
        ? group.items.filter((item) => item.path.toLowerCase().includes(filterLower))
        : group.items,
    }))
    .filter((group) => group.items.length > 0);

  return (
    <>
      <Tag
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
        placeholder={placeholder}
        className={className}
        {...(Tag === "textarea" ? { rows } : {})}
      />

      {pickerOpen &&
        popoverRect &&
        createPortal(
          <div
            className="fixed z-[2000] bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
            style={{
              left: popoverRect.left,
              top: popoverRect.top,
              width: popoverRect.width,
              maxHeight: 260,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {filter && (
              <div className="px-3 py-1.5 border-b border-border bg-muted/50 shrink-0">
                <span className="text-[10px] font-mono text-muted-foreground">/{filter}</span>
              </div>
            )}

            <div className="overflow-y-auto" style={{ maxHeight: filter ? 220 : 240 }}>
              {filteredGroups.length === 0 ? (
                <div className="px-3 py-5 text-center text-[11px] text-muted-foreground">
                  {variableGroups.length === 0
                    ? "Run upstream nodes first to see variables"
                    : "No matching variables"}
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <div key={group.nodeId}>
                    <div className="px-3 py-1.5 bg-muted/40 sticky top-0">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                        {group.nodeName}
                      </span>
                    </div>
                    {group.items.map((item) => (
                      <button
                        key={item.path}
                        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-primary/10 transition-colors text-left group"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertVariable(group.nodeName, item.path);
                        }}
                      >
                        <span className="text-[11px] font-mono text-foreground group-hover:text-primary shrink-0 truncate max-w-[40%]">
                          {item.path}
                        </span>
                        <span className="text-[10px] text-muted-foreground truncate ml-auto">
                          {formatValue(item.value)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
