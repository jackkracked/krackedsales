import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Generous cap — big enough for images/PDFs/short clips, small enough to stay well within
// channel limits and avoid runaway uploads.
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Upload a composer attachment to Vercel Blob and return its public URL. The URL is then passed
 * to GHL's send API as an attachment. Auth-gated. Files land on the public blob domain (separate
 * origin), so they can't touch the app's cookies/session.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File is too large (max 20 MB)" }, { status: 413 });
    }
    // Block only the file types that execute inline in a browser (stored-XSS vectors). Everything
    // else is allowed — the goal is "attach anything" minus the actively dangerous handful.
    const BLOCKED_TYPES = new Set([
      "image/svg+xml", "text/html", "application/xhtml+xml", "text/javascript", "application/javascript",
    ]);
    if (BLOCKED_TYPES.has(file.type) || /\.(svg|html?|xhtml|m?js)$/i.test(file.name || "")) {
      return NextResponse.json({ error: "That file type isn't allowed" }, { status: 415 });
    }

    const safeName = (file.name || "file")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(-120);
    const key = `inbox-attachments/${randomUUID()}-${safeName}`;

    const blob = await put(key, file, {
      access: "public",
      contentType: file.type || "application/octet-stream",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return NextResponse.json({
      url: blob.url,
      name: file.name || safeName,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    });
  } catch (err) {
    console.error("[POST /api/inbox/upload]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
