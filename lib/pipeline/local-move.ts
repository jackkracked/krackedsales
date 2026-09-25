/**
 * Record a move in the mirror the instant GoHighLevel accepts it.
 *
 * WHY THIS EXISTS
 * `PATCH /api/ghl/opportunities/{id}` used to push the move to GHL and write nothing locally.
 * The board then did this, every single drag:
 *   1. `use-pipeline.ts` optimistically moves the card (it groups on `pipelineStageId`).
 *   2. The PATCH succeeds in GHL.
 *   3. `onSettled` invalidates `["opportunities"]`, which refetches from the MIRROR, which
 *      still holds the old stage, so the card snaps back to where it came from.
 * The move had worked. The board just said it had not, and then disagreed with GHL until the
 * next sync, up to six hours later.
 *
 * WHY IT MERGES `raw_data` INSTEAD OF REPLACING IT
 * `lib/pipeline/mirror-source.ts` renders each card FROM `raw_data`, including
 * `contact.name`, `contact.id` and the rest. GHL's single-opportunity responses do not carry
 * the same shape as the search feed that originally populated it, so writing a response
 * straight in would blank the contact details, breaking the board's search box and the
 * `?contact=` auto-open. Merging only the fields we actually changed cannot do that, and it
 * means we never have to depend on the response shape of a write.
 *
 * It also clears `deleted_in_ghl_at`: a deal we just successfully moved plainly exists, and
 * `lib/ghl/sync.ts` never clears that flag, so a wrongly soft-deleted row would otherwise
 * stay invisible on the board forever.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

interface LocalMove {
  opportunityId: string;
  /** Omit to leave the stage alone (a value-only edit). */
  pipelineStageId?: string;
  /** Omit to leave the value alone. */
  monetaryValue?: number;
}

/** Look up the stage's name and owning pipeline, so the mirror stays auditable. */
async function findStage(stageId: string): Promise<{ pipelineId: string; stageName: string } | null> {
  const rows = await db().execute<{ pipeline_id: string; stage_name: string }>(sql`
    SELECT p.id AS pipeline_id, s->>'name' AS stage_name
      FROM local_pipelines p, jsonb_array_elements(p.stages) s
     WHERE s->>'id' = ${stageId}
     LIMIT 1
  `);
  const r = (rows.rows ?? [])[0];
  return r ? { pipelineId: r.pipeline_id, stageName: r.stage_name } : null;
}

/**
 * Returns true if a mirror row was updated.
 *
 * False means the opportunity is not mirrored yet, which is normal for a deal created
 * seconds ago; the next sync or sweep will bring it in. Never throws for that case.
 */
export async function applyLocalOpportunityMove(move: LocalMove): Promise<boolean> {
  const { opportunityId, pipelineStageId, monetaryValue } = move;
  if (!pipelineStageId && monetaryValue === undefined) return false;

  const stage = pipelineStageId ? await findStage(pipelineStageId) : null;

  // Only the fields we actually changed, merged over whatever raw_data already holds.
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (pipelineStageId) patch.pipelineStageId = pipelineStageId;
  if (monetaryValue !== undefined) patch.monetaryValue = monetaryValue;
  if (stage) patch.pipelineId = stage.pipelineId;

  const res = await db().execute<{ id: string }>(sql`
    UPDATE local_opportunities
       SET raw_data          = coalesce(raw_data, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
           pipeline_stage_id = coalesce(${pipelineStageId ?? null}, pipeline_stage_id),
           pipeline_id       = coalesce(${stage?.pipelineId ?? null}, pipeline_id),
           stage_name        = coalesce(${stage?.stageName ?? null}, stage_name),
           monetary_value    = coalesce(${monetaryValue ?? null}, monetary_value),
           deleted_in_ghl_at = NULL,
           updated_at        = now(),
           synced_at         = now()
     WHERE id = ${opportunityId}
    RETURNING id
  `);
  return (res.rows ?? []).length > 0;
}
