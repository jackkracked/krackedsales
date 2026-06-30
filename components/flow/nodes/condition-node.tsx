"use client";

import { Handle, Position } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export function ConditionNode({ data }: { data: { label: string } }) {
  return (
    <div className="relative" style={{ width: 200 }}>
      <div
        data-r10n-flow-node="condition"
        className="select-none rounded-xl px-4 py-3"
        style={{
          background: "var(--r10n-flow-cond-bg, #fffbeb)",
          border: "2px solid var(--r10n-flow-cond-border, #f59e0b)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--r10n-flow-cond-icon-bg, #f59e0b)" }}
          >
            <GitBranch className="w-2.5 h-2.5 text-white" />
          </div>
          <span
            data-r10n-flow-node-label
            className="text-[10px] font-bold uppercase tracking-wide"
            style={{ color: "var(--r10n-flow-cond-eyebrow, #92400e)" }}
          >
            Decision
          </span>
        </div>

        {/* Label */}
        <p
          data-r10n-flow-node-title
          className="text-sm font-semibold leading-snug"
          style={{ color: "var(--r10n-flow-cond-title, #78350f)" }}
        >
          {data.label}
        </p>

        {/* Branch labels */}
        <div
          className="flex items-center justify-between mt-2.5 pt-2"
          style={{ borderTop: "1px solid var(--r10n-flow-cond-divider, #fde68a)" }}
        >
          <span className="text-[10px] font-bold" style={{ color: "var(--r10n-flow-branch-no, #dc2626)" }}>← No</span>
          <span className="text-[10px] font-bold" style={{ color: "var(--r10n-flow-branch-yes, #16a34a)" }}>Yes ↓</span>
        </div>
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        style={{ background: "var(--r10n-flow-cond-icon-bg, #f59e0b)", border: "2px solid white", width: 10, height: 10 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        style={{ background: "var(--r10n-flow-branch-yes, #16a34a)", border: "2px solid white", width: 10, height: 10 }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="no"
        style={{ background: "var(--r10n-flow-branch-no, #dc2626)", border: "2px solid white", width: 10, height: 10 }}
      />
    </div>
  );
}
