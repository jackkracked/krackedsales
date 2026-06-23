import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/calls/[id]/stream/chunk?sid=<shareId>&key=<...>
 *
 * Proxies a single HLS .ts segment from Fathom (which serves it without CORS).
 * `sid` is validated to a Fathom share id; the remaining query is forwarded
 * verbatim to Fathom's video_chunk endpoint.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sid = sp.get("sid") ?? "";
  if (!/^[A-Za-z0-9_-]+$/.test(sid)) {
    return NextResponse.json({ error: "Bad stream id" }, { status: 400 });
  }

  // Forward every param except our own `sid` to Fathom's video_chunk endpoint.
  const forward = new URLSearchParams(sp);
  forward.delete("sid");
  const target = `https://fathom.video/share/${sid}/video_chunk?${forward.toString()}`;

  try {
    const res = await fetch(target, { cache: "no-store" });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: "Segment unavailable" }, { status: 502 });
    }
    return new NextResponse(res.body, {
      headers: {
        "Content-Type": "video/mp2t",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Segment fetch failed" }, { status: 502 });
  }
}
