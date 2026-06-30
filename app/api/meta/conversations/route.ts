import { NextRequest, NextResponse } from "next/server";
import { meta, metaForPage } from "@/lib/meta/client";
import { db } from "@/lib/db";
import { metaPages, socialLeads } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface MetaConversation {
  id: string;
  updated_time: string;
  participants?: {
    data: Array<{ id: string; name?: string; username?: string }>;
  };
  messages?: {
    data: Array<{
      message: string;
      from: { id: string; name?: string; username?: string };
      created_time: string;
    }>;
  };
}

interface NormalisedConversation {
  id: string;
  platform: "facebook" | "instagram";
  participantName: string;
  participantId: string;
  lastMessage: string;
  updatedAt: string;
  // Contact data already attached to this DM (social_leads), if any — for the inbox
  // "only show data we don't have" rule. Undefined until something has been attached.
  email?: string | null;
  phone?: string | null;
  website?: string | null;
}

function normalise(
  conv: MetaConversation,
  platform: "facebook" | "instagram",
  currentPageId: string
): NormalisedConversation {
  // Find the participant who is NOT the page itself
  const otherParticipant = conv.participants?.data.find(
    (p) => p.id !== currentPageId
  );

  const participantName =
    otherParticipant?.name ??
    otherParticipant?.username ??
    "Unknown";

  const participantId = otherParticipant?.id ?? "";
  const lastMessage = conv.messages?.data?.[0]?.message ?? "";

  return {
    id: conv.id,
    platform,
    participantName,
    participantId,
    lastMessage,
    updatedAt: conv.updated_time,
  };
}

export async function GET(_req: NextRequest) {
  const fields =
    "id,participants,updated_time,messages.limit(1){message,from,created_time}";

  const allConversations: NormalisedConversation[] = [];
  const errors: string[] = [];

  // Load connected pages from DB
  const connectedPages = await db().select().from(metaPages).catch(() => []);

  if (connectedPages.length > 0) {
    // DB-first path: iterate each connected page with its own token
    for (const page of connectedPages) {
      const client = metaForPage(page.pageAccessToken);

      // Facebook Messenger conversations for this page
      try {
        const fbRes = await client.get<{ data: MetaConversation[] }>(
          `/${page.pageId}/conversations`,
          { platform: "messenger", fields, limit: "25" }
        );
        const normalised = (fbRes.data ?? []).map((c) =>
          normalise(c, "facebook", page.pageId)
        );
        allConversations.push(...normalised);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Meta /conversations] Facebook (page ${page.pageId}):`, msg);
        errors.push(`FB[${page.pageName}]: ${msg}`);
      }

      // Instagram DMs for this page
      try {
        const igRes = await client.get<{ data: MetaConversation[] }>(
          `/${page.pageId}/conversations`,
          { platform: "instagram", fields, limit: "25" }
        );
        const normalised = (igRes.data ?? []).map((c) =>
          normalise(c, "instagram", page.pageId)
        );
        allConversations.push(...normalised);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Meta /conversations] Instagram (page ${page.pageId}):`, msg);
        errors.push(`IG[${page.pageName}]: ${msg}`);
      }
    }
  } else {
    // Env var fallback path — zero disruption to existing setup
    const envPageId = process.env.META_PAGE_ID ?? "";
    let fbError: string | null = null;
    let igError: string | null = null;

    try {
      const fbRes = await meta.get<{ data: MetaConversation[] }>(
        "/me/conversations",
        { platform: "messenger", fields, limit: "25" }
      );
      allConversations.push(
        ...(fbRes.data ?? []).map((c) => normalise(c, "facebook", envPageId))
      );
    } catch (err) {
      fbError = err instanceof Error ? err.message : String(err);
      console.error("[Meta /conversations] Facebook:", fbError);
    }

    try {
      const igRes = await meta.get<{ data: MetaConversation[] }>(
        "/me/conversations",
        { platform: "instagram", fields, limit: "25" }
      );
      allConversations.push(
        ...(igRes.data ?? []).map((c) => normalise(c, "instagram", envPageId))
      );
    } catch (err) {
      igError = err instanceof Error ? err.message : String(err);
      console.error("[Meta /conversations] Instagram:", igError);
    }

    // Original behaviour: return 500 if both channels fail
    if (fbError && igError) {
      return NextResponse.json({ error: `FB: ${fbError}` }, { status: 500 });
    }
  }

  // Merge and sort newest first
  const conversations = allConversations.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  // Enrich with any contact data already attached to these DMs (social_leads, matched by
  // platform + commenterId) so the thread can hide values we already have on file.
  const participantIds = [...new Set(conversations.map((c) => c.participantId).filter(Boolean))];
  if (participantIds.length) {
    const rows = await db()
      .select({
        platform: socialLeads.platform,
        commenterId: socialLeads.commenterId,
        email: socialLeads.email,
        phone: socialLeads.phone,
        website: socialLeads.website,
      })
      .from(socialLeads)
      .where(inArray(socialLeads.commenterId, participantIds))
      .catch(
        () =>
          [] as Array<{
            platform: string;
            commenterId: string | null;
            email: string | null;
            phone: string | null;
            website: string | null;
          }>
      );
    const byKey = new Map(
      rows.filter((r) => r.commenterId).map((r) => [`${r.platform}:${r.commenterId}`, r])
    );
    for (const c of conversations) {
      const m = byKey.get(`${c.platform}:${c.participantId}`);
      if (m) {
        c.email = m.email;
        c.phone = m.phone;
        c.website = m.website;
      }
    }
  }

  return NextResponse.json({ conversations, errors: errors.length ? errors : undefined });
}
