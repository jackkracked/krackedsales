import { NextRequest, NextResponse } from "next/server";
import { and, or, ilike, isNull, eq, gt, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { localConversations, localContacts, conversationFlags } from "@/lib/db/schema";
import type { GHLConversation, GHLChannelType } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

/**
 * Inbox search, across EVERYTHING rather than what happens to be on screen.
 *
 * WHY THIS EXISTS (Gage, 2026-08-24): he searched "saude.supps", got "No matches", and concluded
 * the contact did not exist. It did. Two separate narrowings caused it:
 *   1. `lib/hooks/use-conversations.ts` fetches a hard 100 conversations and then filters to
 *      UNREAD *client-side*. Gage was on the Unread tab with nothing unread, so the search ran
 *      against an empty array.
 *   2. Even on All, the old search only filtered those same 100 rows. Anything older was
 *      invisible.
 *
 * GHL's /conversations/search is hard-capped at 100 and ignores its cursor (see
 * lib/inbox/mirror-source.ts), so searching live is impossible. This reads `local_conversations`
 * instead: 1,173 rows against the live endpoint's 100.
 *
 * SCOPE OF THE HAYSTACK — Jack: "every single piece of information from a contact should be
 * searchable". So: conversation name/email/phone/last message, plus the joined contact's name
 * parts, email, phone, company, website, tags and custom field VALUES. The custom-field part
 * matters: app/api/contacts/route.ts already searches them because Gage previously could not find
 * brands whose URL lived in a custom field.
 *
 * KNOWN LIMIT, deliberate: message history is not searchable. `message_index` and
 * `local_messages` are both EMPTY in production, so only `last_message_body` (the most recent
 * message per conversation) can be matched. Wiring up history means populating those tables
 * first; it is not a change to this route.
 */

/**
 * Results are returned as `GHLConversation`, the exact shape the inbox list already renders.
 * A parallel type would force every consumer to branch on which kind of conversation it holds.
 */
export type InboxSearchConversation = GHLConversation;

// Same key list the live conversations route normalises, because GHL is inconsistent about
// which one it populates. Without this, search results render initials while the identical
// conversation shows a photo in the normal list — reads as a broken image pipeline.
const AVATAR_KEYS = [
  "avatarUrl", "avatar", "profilePhoto", "profilePicture", "photo",
  "contactPhoto", "userProfilePhoto", "userProfileImg", "profilePicUrl", "image",
] as const;

function pickAvatarUrl(...sources: Array<unknown>): string | undefined {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    const raw = src as Record<string, unknown>;
    for (const key of AVATAR_KEYS) {
      const v = raw[key];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }
  }
  return undefined;
}

const MAX_Q = 128;
const LIMIT = 60;

export async function GET(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Cap the term: this runs a leading-wildcard ILIKE, so an unbounded string is a gift to
  // anyone wanting to make the database work hard.
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, MAX_Q);
  if (q.length < 2) return NextResponse.json({ conversations: [] });

  const like = `%${q}%`;

  try {
    const rows = await db()
      .select({
        id: localConversations.id,
        contactId: localConversations.contactId,
        convName: localConversations.contactName,
        convEmail: localConversations.contactEmail,
        convPhone: localConversations.contactPhone,
        lastMessageBody: localConversations.lastMessageBody,
        lastMessageDate: localConversations.lastMessageDate,
        unreadCount: localConversations.unreadCount,
        type: localConversations.type,
        contactName: localContacts.fullName,
        contactEmail: localContacts.email,
        contactPhone: localContacts.phone,
        flagStarred: conversationFlags.starred,
        flagReadState: conversationFlags.readState,
        flagDeletedAt: conversationFlags.deletedAt,
        convRaw: localConversations.rawData,
        contactRaw: localContacts.rawData,
      })
      .from(localConversations)
      // LEFT join: a conversation whose contact is missing or deleted in GHL must still be
      // findable. Ghost contacts are excluded from the RESULT below, not from the join.
      .leftJoin(localContacts, eq(localContacts.id, localConversations.contactId))
      .leftJoin(conversationFlags, eq(conversationFlags.conversationId, localConversations.id))
      .where(
        and(
          or(
            ilike(localConversations.contactName, like),
            ilike(localConversations.contactEmail, like),
            ilike(localConversations.contactPhone, like),
            ilike(localConversations.lastMessageBody, like),
            ilike(localContacts.fullName, like),
            ilike(localContacts.firstName, like),
            ilike(localContacts.lastName, like),
            ilike(localContacts.email, like),
            ilike(localContacts.phone, like),
            ilike(localContacts.companyName, like),
            ilike(localContacts.website, like),
            // Tags and custom-field VALUES, cast to text so a single ILIKE covers the whole
            // structure. This is what makes "every piece of information" true rather than
            // aspirational.
            sql`${localContacts.tags}::text ILIKE ${like}`,
            sql`${localContacts.customFields}::text ILIKE ${like}`,
          ),
          // Never surface a contact GHL has deleted. `isNull` on a LEFT join also keeps
          // conversations that have no contact row at all, which is what we want.
          or(
            isNull(localContacts.id),
            isNull(localContacts.deletedInGhlAt),
          ),
          // Soft-deleted threads stay hidden unless the contact messaged again afterwards.
          // Done in SQL rather than after the fact so LIMIT counts only rows we will show.
          or(
            isNull(conversationFlags.deletedAt),
            gt(localConversations.lastMessageDate, conversationFlags.deletedAt),
          ),
        ),
      )
      .orderBy(sql`${localConversations.lastMessageDate} DESC NULLS LAST`)
      // One extra row purely to detect truncation, so we can say "refine your search" instead
      // of implying the result set is complete.
      .limit(LIMIT + 1);

    const truncated = rows.length > LIMIT;
    const conversations: GHLConversation[] = rows
      .slice(0, LIMIT)
      .map((r) => {
        // Same read-state override the live route applies, so a thread marked read here does not
        // reappear bold in search results.
        let unread = r.unreadCount ?? 0;
        if (r.flagReadState === "read") unread = 0;
        else if (r.flagReadState === "unread") unread = Math.max(unread, 1);
        const name = r.contactName ?? r.convName ?? "";
        const email = r.contactEmail ?? r.convEmail ?? undefined;
        const phone = r.contactPhone ?? r.convPhone ?? undefined;
        return {
          id: r.id,
          contactId: r.contactId ?? "",
          fullName: name || undefined,
          email,
          phone,
          lastMessageBody: r.lastMessageBody ?? undefined,
          lastMessageDate: r.lastMessageDate ? new Date(r.lastMessageDate).toISOString() : undefined,
          // GHL stores the channel unreliably (saude.supps' Instagram thread is TYPE_PHONE), so
          // carry the mirrored value through and let the UI's own alias matching decide.
          type: (r.type ?? "TYPE_PHONE") as GHLChannelType,
          lastMessageType: r.type ?? undefined,
          unreadCount: unread,
          starred: !!r.flagStarred,
          avatarUrl: pickAvatarUrl(r.convRaw, r.contactRaw),
          contact: r.contactId ? { id: r.contactId, name, email, phone } : undefined,
        };
      });

    return NextResponse.json({ conversations, truncated });
  } catch (err) {
    console.error("[GET /api/inbox/search]", err);
    return NextResponse.json({ conversations: [], error: "Search failed" }, { status: 500 });
  }
}
