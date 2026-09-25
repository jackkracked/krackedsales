"use client";

import { QueryClient, QueryClientProvider, keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Tuned for a CRM: keep pages warm so back-navigation is instant, stop re-fetching
            // the whole app every time the window regains focus, and keep the previous data on
            // screen while a new key loads (no skeleton flash on filter/sort/paginate).
            // Volatile views can opt a shorter staleTime back in per-query.
            staleTime: 60 * 1000, // 60s
            gcTime: 30 * 60 * 1000, // keep cached data 30 min for instant revisits
            refetchOnWindowFocus: false,
            placeholderData: keepPreviousData,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
