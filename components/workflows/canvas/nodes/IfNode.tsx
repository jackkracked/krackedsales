"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export const IfNode = memo(function IfNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, unknown>;
  return (
    <BaseNode
      id={id}
      data={{
        label: d.label as string | undefined,
        nodeType: d.nodeType as string,
        icon: d.icon as string | undefined,
        category: "control",
        isRunSuccess: d.isRunSuccess as boolean | undefined,
        isRunError: d.isRunError as boolean | undefined,
        isRunning: d.isRunning as boolean | undefined,
        execViewStatus: d.execViewStatus as "success" | "error" | "partial" | "running" | "skipped" | undefined,
        pinnedOutput: d.pinnedOutput as Record<string, unknown> | undefined,
        lastRunOutput: d.lastRunOutput as Record<string, unknown> | null | undefined,
      }}
      selected={selected}
      showSourceHandle={false}
      extraHandles={
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: "35%" }}
            className="!w-3 !h-3 !bg-green-500 !border-2 !border-background"
          />
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: "65%" }}
            className="!w-3 !h-3 !bg-red-500 !border-2 !border-background"
          />
        </>
      }
    >
      <div className="mt-1 flex flex-col gap-1">
        <span className="text-[11px] text-green-600 font-semibold">✓ True</span>
        <span className="text-[11px] text-red-500 font-semibold">✗ False</span>
      </div>
    </BaseNode>
  );
});
