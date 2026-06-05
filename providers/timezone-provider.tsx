"use client";

import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";

const TimezoneContext = createContext<string | null>(null);

/**
 * Returns the user's stored timezone (IANA string), or falls back to the
 * browser's timezone if the user hasn't set one / data hasn't loaded yet.
 */
export function useUserTimezone(): string {
  const ctx = useContext(TimezoneContext);
  return ctx ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery<{ id: string; role: string; timezone: string | null }>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/me").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <TimezoneContext.Provider value={data?.timezone ?? null}>
      {children}
    </TimezoneContext.Provider>
  );
}
