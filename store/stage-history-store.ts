"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface StageChange {
  opportunityId: string;
  timestamp: number; // Unix ms — matched against activity message dateAdded
  fromStage: string;
  toStage: string;
}

interface StageHistoryStore {
  changes: StageChange[];
  recordChange: (change: StageChange) => void;
}

export const useStageHistoryStore = create<StageHistoryStore>()(
  persist(
    (set) => ({
      changes: [],
      recordChange: (change) =>
        set((s) => ({
          // Keep last 200 changes max to avoid unbounded growth
          changes: [change, ...s.changes].slice(0, 200),
        })),
    }),
    { name: "kracked-stage-history" }
  )
);

/** Find a stored stage change within 30s of an activity message timestamp.
 *  opportunityId is optional — when not provided, matches by timestamp only.
 *  This allows the Inbox thread to show from/to stage info. */
export function findStageChange(
  changes: StageChange[],
  activityTimestamp: string,
  opportunityId?: string
): StageChange | null {
  const ts = new Date(activityTimestamp).getTime();
  return (
    changes.find(
      (c) =>
        (!opportunityId || c.opportunityId === opportunityId) &&
        Math.abs(c.timestamp - ts) < 30_000 // within 30 seconds
    ) ?? null
  );
}
