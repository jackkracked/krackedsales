"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export const ActionNode = memo(function ActionNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, unknown>;
  return (
    <BaseNode
      id={id}
      data={{
        label: d.label as string | undefined,
        nodeType: d.nodeType as string,
        icon: d.icon as string | undefined,
        category: d.category as string | undefined,
        isRunSuccess: d.isRunSuccess as boolean | undefined,
        isRunError: d.isRunError as boolean | undefined,
        isRunning: d.isRunning as boolean | undefined,
        execViewStatus: d.execViewStatus as "success" | "error" | "partial" | "running" | "skipped" | undefined,
        pinnedOutput: d.pinnedOutput as Record<string, unknown> | undefined,
        lastRunOutput: d.lastRunOutput as Record<string, unknown> | null | undefined,
      }}
      selected={selected}
    />
  );
});
