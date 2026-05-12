/**
 * A/B test winner detection helpers.
 *
 * Chi-square test (2×2 contingency table, df=1).
 * Critical value at p<0.05: χ² > 3.84
 * Additional guards: ≥10 sends per variant, winner rate ≥1.3× loser rate.
 */

import { db } from "@/lib/db";
import { replyTemplates, templateSends, templateResponses, abTestResults } from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

export interface VariantStats {
  templateId: string;
  templateName: string;
  abGroup: string;
  sends: number;
  responses: number;
  rate: number; // 0–1
}

export interface ABGroupResult {
  abGroup: string;
  variants: VariantStats[];
  winner: VariantStats | null;
  loser: VariantStats | null;
  chiSquare: number | null;
  isSignificant: boolean;
  detectedAt?: string;
}

/** Compute chi-square statistic for a 2×2 contingency table */
function chiSquare2x2(
  aResp: number, aSends: number,
  bResp: number, bSends: number
): number {
  const a = aResp;
  const b = aSends - aResp;
  const c = bResp;
  const d = bSends - bResp;
  const N = a + b + c + d;
  if (N === 0) return 0;
  const denom = (a + b) * (c + d) * (a + c) * (b + d);
  if (denom === 0) return 0;
  return (N * Math.pow(a * d - b * c, 2)) / denom;
}

/** Load send/response counts for all templates in active A/B groups */
export async function loadABStats(): Promise<ABGroupResult[]> {
  const client = db();

  // All templates with an abGroup
  const templates = await client
    .select({ id: replyTemplates.id, name: replyTemplates.name, abGroup: replyTemplates.abGroup })
    .from(replyTemplates)
    .where(sql`${replyTemplates.abGroup} is not null`);

  if (templates.length === 0) return [];

  const templateIds = templates.map((t) => t.id);

  // Send counts per template
  const sendCounts = await client
    .select({
      templateId: templateSends.templateId,
      count: sql<number>`count(*)::int`,
    })
    .from(templateSends)
    .where(inArray(templateSends.templateId, templateIds))
    .groupBy(templateSends.templateId);

  // Response counts per template (join templateSends → templateResponses)
  const responseCounts = await client
    .select({
      templateId: templateSends.templateId,
      count: sql<number>`count(*)::int`,
    })
    .from(templateResponses)
    .innerJoin(templateSends, eq(templateResponses.sendId, templateSends.id))
    .where(inArray(templateSends.templateId, templateIds))
    .groupBy(templateSends.templateId);

  const sendsMap = new Map(sendCounts.map((r) => [r.templateId, r.count]));
  const responsesMap = new Map(responseCounts.map((r) => [r.templateId, r.count]));

  // Group by abGroup
  const groupMap = new Map<string, typeof templates>();
  for (const t of templates) {
    if (!t.abGroup) continue;
    if (!groupMap.has(t.abGroup)) groupMap.set(t.abGroup, []);
    groupMap.get(t.abGroup)!.push(t);
  }

  const results: ABGroupResult[] = [];

  for (const [abGroup, groupTemplates] of groupMap) {
    const variants: VariantStats[] = groupTemplates.map((t) => {
      const sends = sendsMap.get(t.id) ?? 0;
      const responses = responsesMap.get(t.id) ?? 0;
      return {
        templateId: t.id,
        templateName: t.name,
        abGroup,
        sends,
        responses,
        rate: sends > 0 ? responses / sends : 0,
      };
    });

    // Only evaluate groups with exactly 2 variants
    if (variants.length !== 2) {
      results.push({ abGroup, variants, winner: null, loser: null, chiSquare: null, isSignificant: false });
      continue;
    }

    const [a, b] = variants;
    const chi = chiSquare2x2(a.responses, a.sends, b.responses, b.sends);
    const minSends = Math.min(a.sends, b.sends);
    const maxRate = Math.max(a.rate, b.rate);
    const minRate = Math.min(a.rate, b.rate);
    const effectRatio = minRate > 0 ? maxRate / minRate : (maxRate > 0 ? Infinity : 1);

    const isSignificant = chi > 3.84 && minSends >= 10 && effectRatio >= 1.3;
    const winner = a.rate >= b.rate ? a : b;
    const loser = a.rate >= b.rate ? b : a;

    results.push({
      abGroup,
      variants,
      winner: isSignificant ? winner : null,
      loser: isSignificant ? loser : null,
      chiSquare: chi,
      isSignificant,
    });
  }

  return results;
}

/**
 * Detect A/B winners and write to abTestResults.
 * Idempotent: skips groups already marked as won.
 * Returns number of new winners written.
 */
export async function detectAndPersistWinners(): Promise<number> {
  const client = db();
  const groups = await loadABStats();
  let newWinners = 0;

  for (const group of groups) {
    if (!group.isSignificant || !group.winner || !group.loser) continue;

    // Skip if already have a result for this group
    const existing = await client
      .select({ id: abTestResults.id })
      .from(abTestResults)
      .where(eq(abTestResults.abGroup, group.abGroup))
      .limit(1);
    if (existing.length > 0) continue;

    const { winner, loser, chiSquare } = group;

    // Write result row
    await client.insert(abTestResults).values({
      abGroup: group.abGroup,
      winnerTemplateId: winner.templateId,
      loserTemplateId: loser.templateId,
      winnerSends: winner.sends,
      winnerResponses: winner.responses,
      loserSends: loser.sends,
      loserResponses: loser.responses,
      winnerRate: String(winner.rate.toFixed(4)),
      loserRate: String(loser.rate.toFixed(4)),
      chiSquare: String((chiSquare ?? 0).toFixed(4)),
    });

    // Mark winner on the template row
    await client
      .update(replyTemplates)
      .set({ isWinner: true })
      .where(eq(replyTemplates.id, winner.templateId));

    newWinners++;
  }

  return newWinners;
}
