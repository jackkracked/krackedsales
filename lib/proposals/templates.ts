// Single source of truth for proposal copy. Resolution order everywhere:
//   proposal.content (per-proposal snapshot) -> proposal_templates row -> hardcoded defaults.
// Web (proposal-signing-page via the public route), PDF (agreement-pdf), and the create-time
// snapshot all go through here so the three can never silently disagree.
import { db } from "@/lib/db";
import { proposalTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { defaultContentFor, type ProposalContent } from "@/lib/proposals/content";

export type ProposalType = "management" | "project";

/** The effective TEMPLATE copy for a type: the saved row if an admin has edited it, else the
 *  hardcoded defaults. Used when creating a proposal (to snapshot) and in the Settings editor. */
export async function getTemplateSections(type: ProposalType): Promise<ProposalContent> {
  try {
    const [row] = await db()
      .select({ sections: proposalTemplates.sections })
      .from(proposalTemplates)
      .where(eq(proposalTemplates.type, type))
      .limit(1);
    return row?.sections ?? defaultContentFor(type);
  } catch {
    // Table missing / DB hiccup: never break rendering, fall back to code defaults.
    return defaultContentFor(type);
  }
}

/** The copy to RENDER for a given proposal: its own snapshot if present (immutable once sent),
 *  else the live template, else defaults. `content` is the proposals.content JSONB column. */
export async function resolveProposalContent(proposal: {
  type: string;
  content?: ProposalContent | null;
}): Promise<ProposalContent> {
  if (proposal.content) return proposal.content;
  const type: ProposalType = proposal.type === "project" ? "project" : "management";
  return getTemplateSections(type);
}
