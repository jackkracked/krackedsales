import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Extract the Fathom share id from a share URL like https://fathom.video/share/<id>. */
function shareIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/share\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/**
 * GET /api/calls/[id]/stream
 *
 * Same-origin HLS playlist proxy for a call's Fathom recording. Fathom serves
 * the muxed (audio+video) HLS stream without CORS, so we fetch it server-side
 * and rewrite the chunk URLs to our own /chunk proxy. This lets us play the
 * recording in our own <video> (via hls.js) and drive transcript word-sync.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [call] = await db().select({ shareUrl: calls.fathomShareUrl }).from(calls).where(eq(calls.id, id)).limit(1);
  const sid = shareIdFromUrl(call?.shareUrl ?? null);
  if (!sid) return NextResponse.json({ error: "No recording for this call" }, { status: 404 });

  let playlist: string;
  try {
    const res = await fetch(`https://fathom.video/share/${sid}/video.m3u8`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "Recording unavailable" }, { status: 502 });
    playlist = await res.text();
  } catch {
    return NextResponse.json({ error: "Recording fetch failed" }, { status: 502 });
  }

  // Rewrite each "/share/<sid>/video_chunk?<query>" line to our chunk proxy.
  const rewritten = playlist.replace(
    /\/share\/[^/\s]+\/video_chunk\?/g,
    `/api/calls/${id}/stream/chunk?sid=${sid}&`,
  );

  return new NextResponse(rewritten, {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "private, max-age=60",
    },
  });
}
