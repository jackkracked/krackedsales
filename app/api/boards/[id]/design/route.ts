import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { db } from "@/lib/db";
import { demoBoards, demoBoardDesigns, users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { logBoardEvent } from "@/lib/demo-boards/queries";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 500 * 1024 * 1024; // 500MB — generous cap; client uploads stream direct to Blob.

/**
 * POST /api/boards/[id]/design  (team only)
 *
 * Vercel Blob CLIENT-side direct upload handler. The browser streams the file
 * straight to Blob (no ~4.5MB serverless body cap, with live progress), and this
 * route plays two roles via `handleUpload`:
 *
 *   1. Token request  — `onBeforeGenerateToken` enforces auth + validates the board,
 *      then mints a scoped upload token. width/height arrive in the client payload.
 *   2. Completion call — `onUploadCompleted` is invoked server-to-server by Vercel
 *      (NO session cookie — handleUpload validates the callback itself) once the
 *      file lands. We create the `demoBoardDesigns` version row here.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // A connected Vercel Blob store exposes either the classic BLOB_READ_WRITE_TOKEN
  // or the newer connected-store vars (BLOB_STORE_ID + auto-auth at runtime).
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    return NextResponse.json(
      { error: "Blob storage isn’t configured yet." },
      { status: 503 },
    );
  }

  const { id: boardId } = await params;
  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,

      // Runs for the token request — this is where auth lives.
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const user = await getSessionUser();
        if (!user) throw new Error("Unauthorized");

        const [board] = await db()
          .select({ id: demoBoards.id })
          .from(demoBoards)
          .where(eq(demoBoards.id, boardId))
          .limit(1);
        if (!board) throw new Error("Board not found");

        let width: number | null = null;
        let height: number | null = null;
        if (clientPayload) {
          try {
            const parsed = JSON.parse(clientPayload) as { width?: number; height?: number };
            width = Number(parsed.width) || null;
            height = Number(parsed.height) || null;
          } catch {
            // Ignore malformed dims — width/height are an optimisation, not required.
          }
        }

        return {
          allowedContentTypes: ACCEPTED,
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_BYTES,
          tokenPayload: JSON.stringify({ boardId, uploadedBy: user.id, width, height }),
        };
      },

      // Runs server-to-server from Vercel once the blob is stored (no cookie here).
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (!tokenPayload) return;
        const { boardId: bId, uploadedBy, width, height } = JSON.parse(tokenPayload) as {
          boardId: string;
          uploadedBy: string;
          width: number | null;
          height: number | null;
        };

        // Next version number for this board.
        const [prev] = await db()
          .select({ version: demoBoardDesigns.version })
          .from(demoBoardDesigns)
          .where(eq(demoBoardDesigns.boardId, bId))
          .orderBy(desc(demoBoardDesigns.version))
          .limit(1);
        const version = (prev?.version ?? 0) + 1;

        const [design] = await db()
          .insert(demoBoardDesigns)
          .values({
            boardId: bId,
            blobUrl: blob.url,
            mimeType: blob.contentType || null,
            width,
            height,
            version,
            uploadedBy: uploadedBy || null,
          })
          .returning();
        if (!design) return;

        // First upload assigns the designer; later uploads keep the original.
        const [board] = await db()
          .select({ designerId: demoBoards.designerId })
          .from(demoBoards)
          .where(eq(demoBoards.id, bId))
          .limit(1);
        if (board && !board.designerId && uploadedBy) {
          await db().update(demoBoards).set({ designerId: uploadedBy }).where(eq(demoBoards.id, bId));
        }

        // Resolve the uploader's name for the activity actor (no session in this callback).
        let actor: string | null = null;
        if (uploadedBy) {
          const [u] = await db()
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, uploadedBy))
            .limit(1);
          actor = u?.name ?? null;
        }

        await logBoardEvent({
          boardId: bId,
          type: "design_uploaded",
          actor,
          metadata: { version },
        });
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/boards/[id]/design] upload failed", boardId, err);
    const message = err instanceof Error ? err.message : "Upload failed";
    const status = message === "Unauthorized" ? 401 : message === "Board not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
