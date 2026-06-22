import { db } from "@/lib/db";
import { demoBoards } from "@/lib/db/schema";
import { logBoardEvent } from "./queries";
import { clickupConfig } from "./integration-config";
import { setBoardLinkField } from "./clickup-adapter";
import { boardUrl } from "./urls";
import { eq } from "drizzle-orm";

/**
 * Demo Boards two-way sync from a ClickUp webhook payload.
 *
 * GAGE SEAM: the demo-list filter, exact status strings, and the board-link field
 * id come from Gage's repo via `integration-config.ts`. This does the safe,
 * buildable half — for a task we already track as a board, reflect the mapped
 * status back onto the board and backfill the board-link field. Creating a board
 * from a brand-new task needs Gage's contact mapping and is intentionally left as
 * a seam rather than guessed.
 */
export async function syncBoardFromClickupTask(payload: Record<string, unknown>): Promise<void> {
  const taskId = (payload?.task_id ?? payload?.taskId) as string | undefined;
  if (!taskId) return;

  const [board] = await db()
    .select()
    .from(demoBoards)
    .where(eq(demoBoards.clickupTaskId, taskId))
    .limit(1);
  if (!board) return; // not a board we track (yet)

  // Keep the task's board-link field pointed at the live board.
  await setBoardLinkField(taskId, boardUrl(board.token));

  // Reflect a status change, if any.
  const newStatus = extractStatus(payload);
  if (!newStatus) return;
  const mapped = reverseStageMap(newStatus);
  if (!mapped || mapped === board.status) return;

  await db()
    .update(demoBoards)
    .set({ status: mapped, updatedAt: new Date() })
    .where(eq(demoBoards.id, board.id));
  await logBoardEvent({
    boardId: board.id,
    type: "clickup_status_sync",
    actor: "clickup",
    metadata: { from: board.status, to: mapped, clickupStatus: newStatus },
  });
}

/** Pull the new status name out of ClickUp's history_items, if present. */
function extractStatus(payload: Record<string, unknown>): string | undefined {
  const items = (payload?.history_items as Array<Record<string, unknown>>) ?? [];
  for (const it of items) {
    if (it?.field === "status") {
      const after = it?.after as { status?: string } | undefined;
      if (after?.status) return after.status;
    }
  }
  return undefined;
}

/** Inverse of the board → ClickUp drive: a ClickUp stage name → a board status. */
function reverseStageMap(clickupStatus: string): string | null {
  const s = clickupStatus.toLowerCase();
  if (s === clickupConfig.stages.inReview.toLowerCase()) return "in_review";
  if (s === clickupConfig.stages.sentToClient.toLowerCase()) return "sent";
  return null;
}
