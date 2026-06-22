import { clickup } from "@/lib/clickup/client";
import { clickupConfig } from "./integration-config";

/**
 * Thin ClickUp adapter for demo boards. Every call reads `integration-config.ts`
 * (the Gage seam) so field ids / stage names live in ONE place. Each function is a
 * safe no-op when the relevant config is missing — so the board lifecycle never
 * breaks just because ClickUp isn't wired yet. Phase 6 confirms field ids from
 * Gage's repo; nothing here changes, only the config.
 */

/** Move the demo task into a named status (e.g. "Internal QA", "Scheduled/Live"). */
export async function moveTaskToStage(taskId: string | null, status: string): Promise<void> {
  if (!taskId) return;
  try {
    await clickup.put(`/task/${taskId}`, { status });
  } catch (err) {
    console.error("[clickup-adapter.moveTaskToStage]", taskId, status, err);
  }
}

/** Write the live board URL onto the task's board-link custom field. */
export async function setBoardLinkField(taskId: string | null, url: string): Promise<void> {
  const fieldId = clickupConfig.boardLinkFieldId();
  if (!taskId || !fieldId) return;
  try {
    await clickup.post(`/task/${taskId}/field/${fieldId}`, { value: url });
  } catch (err) {
    console.error("[clickup-adapter.setBoardLinkField]", taskId, err);
  }
}

/** Mirror a prospect comment onto the demo task as a ClickUp comment. */
export async function mirrorCommentToTask(
  taskId: string | null,
  text: string,
): Promise<void> {
  if (!taskId || !clickupConfig.mirrorCommentsToTask) return;
  try {
    await clickup.post(`/task/${taskId}/comment`, { comment_text: text, notify_all: true });
  } catch (err) {
    console.error("[clickup-adapter.mirrorCommentToTask]", taskId, err);
  }
}
