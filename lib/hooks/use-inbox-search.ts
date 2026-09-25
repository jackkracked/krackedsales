"use client";

import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { InboxSearchConversation } from "@/app/api/inbox/search/route";

/**
 * Global inbox search. Hits the mirror, not GHL, so it reaches every conversation rather than
 * the 100 the live endpoint is hard-capped at.
 *
 * Debounced, because this fires on every keystroke and each call is a leading-wildcard ILIKE
 * across conversations, contacts, tags and custom fields.
 */
export function useInboxSearch(query: string) {
  // Real debounce. Typing "saude.supps" previously fired ten queries, each a leading-wildcard
  // ILIKE across thirteen predicates including two jsonb-to-text casts.
  const [debounced, setDebounced] = useState(query.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const q = debounced;

  return useQuery<{ conversations: InboxSearchConversation[]; truncated?: boolean }>({
    queryKey: ["inbox-search", q],
    queryFn: async () => {
      const res = await fetch(`/api/inbox/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      return res.json();
    },
    // Two characters is the floor the endpoint enforces too; below that we do not even ask.
    enabled: q.length >= 2,
    // Keep the previous results on screen while the next query lands, so the list does not
    // flash empty mid-type and make it look like nothing was found.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
