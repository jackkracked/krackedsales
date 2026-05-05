"use client";

import { Handle, Position } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export function ConditionNode({ data }: { data: { label: string } }) {
  return (
    <div className="relative" style={{ width: 200 }}>
      <div
        className="select-none rounded-xl px-4 py-3"
        style={{
          background: "#fffbeb",
          border: "2px solid #f59e0b",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "#f59e0b" }}
          >
            <GitBranch className="w-2.5 h-2.5 text-white" />
          </div>
          <span
            className="text-[10px] font-bold uppercase tracking-wide"
            style={{ color: "#92400e" }}
          >
            Decision
          </span>
        </div>

        {/* Label */}
        <p className="text-sm font-semibold leading-snug" style={{ color: "#78350f" }}>
          {data.label}
        </p>

        {/* Branch labels */}
        <div className="flex items-center justify-between mt-2.5 pt-2" style={{ borderTop: "1px solid #fde68a" }}>
          <span className="text-[10px] font-bold" style={{ color: "#dc2626" }}>← No</span>
          <span className="text-[10px] font-bold" style={{ color: "#16a34a" }}>Yes ↓</span>
        </div>
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        style={{ background: "#f59e0b", border: "2px solid white", width: 10, height: 10 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        style={{ background: "#16a34a", border: "2px solid white", width: 10, height: 10 }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="no"
        style={{ background: "#dc2626", border: "2px solid white", width: 10, height: 10 }}
      />
    </div>
  );
}
