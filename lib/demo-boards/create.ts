import { db } from "@/lib/db";
import { demoBoards, demoBoardEvents } from "@/lib/db/schema";
import { generateBoardToken } from "./tokens";
import { boardSlug, referenceCode } from "./integration-config";

export type CreateBoardInput = {
  contactName: string;
  contactEmail?: string | null;
  ghlContactId?: string | null;
  clickupTaskId?: string | null;
  repId?: string | null;
  title?: string | null;
  builtOn?: string | null;
};

/**
 * Create a demo board. The one place a board is born — used by the demo-request
 * auto-create and (later) the ClickUp task webhook. Generates the public token,
 * slug, and human reference code via the integration-config seam.
 */
export async function createBoard(input: CreateBoardInput) {
  const token = generateBoardToken();
  const [board] = await db()
    .insert(demoBoards)
    .values({
      token,
      slug: boardSlug(input.contactName),
      referenceCode: referenceCode(input.contactName),
      contactName: input.contactName,
      contactEmail: input.contactEmail ?? null,
      ghlContactId: input.ghlContactId ?? null,
      clickupTaskId: input.clickupTaskId ?? null,
      repId: input.repId ?? null,
      title: input.title ?? null,
      builtOn: input.builtOn ?? null,
      status: "awaiting_design",
      lastActivityAt: new Date(),
    })
    .returning();

  await db().insert(demoBoardEvents).values({ boardId: board.id, type: "created", actor: "system" });
  return board;
}

/**
 * Map a Create-Demo payload (the form keys the modal posts) to a board. Pulls the
 * contact, email, GHL linkage, and email type. Never throws to the caller's flow —
 * a board-create failure must not break demo creation.
 */
export async function createBoardFromDemo(payload: Record<string, unknown>) {
  const str = (k: string) => {
    const v = payload[k];
    return v == null ? "" : String(v).trim();
  };
  const contactName = str("Contact Name") || str("Brand Name") || "New prospect";
  return createBoard({
    contactName,
    contactEmail: str("Email") || null,
    // GHL contact linkage — the modal forwards the lead id; prefer it for sends.
    ghlContactId: str("Comment Lead ID") || str("Opportunity ID") || null,
    title: str("Email Type") || null,
  });
}
