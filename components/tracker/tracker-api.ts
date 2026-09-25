"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SetterMonth } from "@/lib/tracker/setter";
import type { CloserMonth } from "@/lib/tracker/closer";

/** What GET /api/tracker returns. */
export interface TrackerResponse {
  data: (SetterMonth & { name: string }) | CloserMonth;
  people?: Array<{ id: string; name: string; role: string }>;
  nextToClose: string | null;
  /** Admin only: self-edited pay to look at before closing `nextToClose`. */
  closeReview?: string[];
  viewer: { id: string; isAdmin: boolean; isSelf: boolean; canEdit: boolean; canCorrectRows: boolean; canRecordOutcomes: boolean };
  closedAt: string | null;
}

export const money = (cents: number) => {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
  });
};

/** "+$25" / "−$25": a true minus sign, so a deduction never reads as a hyphen. */
export const signedMoney = (cents: number) => (cents < 0 ? `−${money(-cents)}` : `+${money(cents)}`);

export const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};
export const monthShort = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
};

/** Dates are shown in New York, the business timezone the months are cut in. */
export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "—";

export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export class ActionError extends Error {}

/** Every write, one path. Refetches the month after, so every figure stays a sum of its rows. */
export function useTrackerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/tracker/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new ActionError(json.error ?? "Could not save that change");
      return json;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tracker"] }),
  });
}
