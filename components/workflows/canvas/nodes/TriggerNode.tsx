"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export const TriggerNode = memo(function TriggerNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, unknown>;
  return (
    <BaseNode
      id={id}
      data={{
        label: d.label as string | undefined,
        nodeType: d.nodeType as string,
        icon: d.icon as string | undefined,
        category: "trigger",
        isRunSuccess: d.isRunSuccess as boolean | undefined,
        isRunError: d.isRunError as boolean | undefined,
        isRunning: d.isRunning as boolean | undefined,
        isListening: d.isListening as boolean | undefined,
        execViewStatus: d.execViewStatus as "success" | "error" | "partial" | "running" | "skipped" | undefined,
        pinnedOutput: d.pinnedOutput as Record<string, unknown> | undefined,
        lastRunOutput: d.lastRunOutput as Record<string, unknown> | null | undefined,
      }}
      selected={selected}
      showTargetHandle={false}
    />
  );
});
