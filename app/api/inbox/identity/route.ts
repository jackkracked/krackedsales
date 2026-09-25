import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaPages } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Our own brand avatars (the connected Instagram / Facebook accounts). Used as the
 * outbound "us" avatar in the inbox thread so replies show our real profile picture,
 * per channel, the way GoHighLevel does. Returns only the avatar URLs — never tokens.
 */
export async function GET() {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db().select().from(metaPages);
  const instagram = rows.find((r) => r.instagramAvatar)?.instagramAvatar ?? null;
  const facebook = rows.find((r) => r.pageAvatar)?.pageAvatar ?? null;

  return NextResponse.json({ instagram, facebook });
}
