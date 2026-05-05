"use client";

import { Handle, Position } from "@xyflow/react";
import { Zap } from "lucide-react";

export function TriggerNode({ data }: { data: { label: string } }) {
  return (
    <div
      className="flex items-center gap-3 px-6 py-3.5 rounded-full shadow-lg select-none"
      style={{
        background: "linear-gradient(135deg, var(--primary) 0%, #1a5c8f 100%)",
        border: "1.5px solid rgba(255,255,255,0.2)",
        minWidth: 200,
      }}
    >
      <div className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center shrink-0">
        <Zap className="w-3.5 h-3.5 text-white" fill="white" />
      </div>
      <span className="text-sm font-bold text-white tracking-tight">{data.label}</span>

      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        style={{ background: "white", border: "2px solid var(--primary)", width: 10, height: 10 }}
      />
    </div>
  );
}
