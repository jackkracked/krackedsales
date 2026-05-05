"use client";

import { Handle, Position } from "@xyflow/react";
import { Trophy, X, Clock } from "lucide-react";

type ActionType = "success" | "dead-end" | "wait";

const CONFIG: Record<ActionType, {
  bg: string;
  border: string;
  text: string;
  icon: React.ElementType;
}> = {
  success: {
    bg: "#dcfce7",
    border: "#16a34a",
    text: "#15803d",
    icon: Trophy,
  },
  "dead-end": {
    bg: "#f1f5f9",
    border: "#94a3b8",
    text: "#64748b",
    icon: X,
  },
  wait: {
    bg: "#fef9c3",
    border: "#d97706",
    text: "#92400e",
    icon: Clock,
  },
};

export function ActionNode({
  data,
}: {
  data: { label: string; actionType: ActionType; delay?: string };
}) {
  const type = data.actionType ?? "dead-end";
  const cfg = CONFIG[type] ?? CONFIG["dead-end"];
  const Icon = cfg.icon;
  const isSuccess = type === "success";
  const isWait = type === "wait";

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-full shadow-sm select-none"
      style={{
        background: cfg.bg,
        border: `2px solid ${cfg.border}`,
        minWidth: 150,
      }}
    >
      {!isSuccess && (
        <Handle
          type="target"
          position={Position.Top}
          id="in"
          style={{ background: cfg.border, border: "2px solid white", width: 10, height: 10 }}
        />
      )}

      <div
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
        style={{ background: cfg.border }}
      >
        <Icon className="w-3 h-3 text-white" />
      </div>
      <div>
        <p className="text-xs font-bold leading-tight" style={{ color: cfg.text }}>
          {data.label}
        </p>
        {isWait && data.delay && (
          <p className="text-[10px] font-medium" style={{ color: cfg.text, opacity: 0.8 }}>
            {data.delay}
          </p>
        )}
      </div>

      {isSuccess && (
        <Handle
          type="target"
          position={Position.Top}
          id="in"
          style={{ background: cfg.border, border: "2px solid white", width: 10, height: 10 }}
        />
      )}
      {isWait && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="out"
          style={{ background: cfg.border, border: "2px solid white", width: 10, height: 10 }}
        />
      )}
    </div>
  );
}
