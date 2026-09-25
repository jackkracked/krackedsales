"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Receipt } from "lucide-react";
import { Table } from "@/components/untitled/application/table/table";
import { Badge } from "@/components/untitled/base/badges/badges";
import { cn } from "@/lib/utils/cn";

/**
 * A person's pay for one month, and the deals that prove it.
 *
 * THE ONE RULE THIS SCREEN OBEYS
 * Every figure at the top can be traced to rows underneath it. This replaces a spreadsheet
 * somebody maintained by hand, and the reason people trust a spreadsheet is that they can see
 * the arithmetic. A total with no visible working is a number an employee has to take on faith
 * about their own pay, which is exactly the thing worth avoiding.
 */

interface Row {
  proposalId: string;
  client: string;
  title: string;
  state: string;
  amount: number;
  sentAt: string | null;
  paidAt: string | null;
  commission: number;
}

interface TrackerData {
  userId: string;
  name: string;
  month: string;
  payoutTiming: string;
  commissionPct: number;
  basePay: number;
  proposalsSent: number;
  dealsClosed: number;
  closedValue: number;
  commission: number;
  totalEstimatedPay: number;
  rows: Row[];
  months: string[];
  people?: Array<{ id: string; name: string; role: string }>;
  isCurrentMonth: boolean;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";

/** How the payout-timing setting reads to a human, so the screen can say it out loud. */
const TIMING_LABEL: Record<string, string> = {
  full_paid: "when a proposal is paid in full",
  first_instalment: "when the first instalment is paid",
  split: "as each instalment is paid",
};

const STATE_COLOR: Record<string, "success" | "blue" | "gray" | "error"> = {
  Closed: "success",
  Signed: "blue",
  Sent: "gray",
  Lost: "error",
  Draft: "gray",
};

/** One figure in the summary strip. `hero` is the number the page exists to answer. */
function Figure({ label, value, hint, muted = false, span = false }: {
  label: string; value: string; hint?: string; muted?: boolean; span?: boolean;
}) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1 px-4 py-3", span && "col-span-2 lg:col-span-1")}
      title={hint}
    >
      <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("truncate text-[17px] font-medium tabular-nums text-foreground", muted && "text-muted-foreground")}>
        {value}
      </span>
    </div>
  );
}

export function TrackerClient({ isAdmin, selfId }: { isAdmin: boolean; selfId: string }) {
  const thisMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [month, setMonth] = useState(thisMonth);
  const [userId, setUserId] = useState(selfId);

  const { data, isLoading, error } = useQuery<TrackerData>({
    queryKey: ["tracker", userId, month],
    queryFn: async () => {
      const res = await fetch(`/api/tracker/closer?month=${month}&userId=${userId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not load the tracker");
      return res.json();
    },
  });

  // Months that have something in them, plus the current one even when it is still empty, so
  // the switcher never opens on a month the person cannot get back to.
  const months = useMemo(() => {
    const set = new Set(data?.months ?? []);
    set.add(thisMonth);
    return [...set].sort().reverse();
  }, [data?.months, thisMonth]);

  const earnsCommission = (data?.commissionPct ?? 0) > 0;
  const basePaySet = (data?.basePay ?? 0) > 0;

  // "$0" and "we have not been told their base pay" are very different statements to put in
  // front of someone about their own wages. Only claim a total when one is actually knowable.
  const payIsKnown = basePaySet || (data?.commission ?? 0) > 0;
  const payNote = !data
    ? ""
    : basePaySet
      ? (earnsCommission ? "Base pay plus commission this month" : "Base pay this month")
      : payIsKnown
        ? "Commission only, no base pay set"
        : "No base pay set for this person";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
        {/* ── Title, and the two things that change what is on screen ───────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-border bg-card">
              <Receipt className="h-4 w-4 text-muted-foreground" />
            </span>
            <div>
              <h1 className="text-[17px] font-semibold leading-tight text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                Pay Tracker
              </h1>
              <p className="text-[12px] text-muted-foreground">
                {data ? (isAdmin && userId !== selfId ? data.name : "Your earnings") : " "}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && (data?.people?.length ?? 0) > 0 && (
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                aria-label="Whose tracker to show"
                className="h-8 rounded-[7px] border border-border bg-card px-2.5 text-[12px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
              >
                {data!.people!.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.id === selfId ? " (you)" : ""}</option>
                ))}
              </select>
            )}
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Which month to show"
              className="h-8 rounded-[7px] border border-border bg-card px-2.5 text-[12px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              {months.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── The answer, before the evidence ───────────────────────────────────────── */}
        {error ? (
          <div className="mt-5 flex items-start gap-2.5 rounded-[10px] border border-border bg-card p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Could not load this tracker</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{(error as Error).message}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-5 grid gap-3 lg:grid-cols-[300px_1fr]">
              {/* THE ANSWER, in its own frame.
                  It used to sit as one more cell in a shared grid, which left it stranded on a
                  second row beside a wide empty gap whenever the number of supporting figures
                  did not divide evenly. Giving the total its own panel means the layout can
                  never go ragged, and the figure people came for reads first on every width. */}
              <div className="flex flex-col justify-center rounded-[10px] border border-border bg-card px-5 py-4">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Total estimated pay
                </span>
                {isLoading || !data ? (
                  <div className="mt-2 h-8 w-32 animate-pulse rounded bg-muted" />
                ) : (
                  <>
                    <span
                      className={cn(
                        "mt-1 truncate text-[28px] font-semibold leading-tight tabular-nums",
                        payIsKnown ? "text-foreground" : "text-muted-foreground",
                      )}
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {payIsKnown ? money(data.totalEstimatedPay) : "Not set"}
                    </span>
                    <span className="mt-1 text-[12px] text-muted-foreground">{payNote}</span>
                  </>
                )}
              </div>

              <div className="overflow-hidden rounded-[10px] border border-border bg-card">
                {isLoading || !data ? (
                  <div className="grid grid-cols-2 divide-x divide-y divide-border lg:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex flex-col gap-2 px-4 py-3">
                        <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
                        <div className="h-5 w-20 animate-pulse rounded bg-muted" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={cn(
                    "grid h-full grid-cols-2 divide-x divide-y divide-border",
                    earnsCommission ? "lg:grid-cols-4" : "lg:grid-cols-3",
                  )}>
                    <Figure
                      label="Base pay"
                      value={basePaySet ? money(data.basePay) : "Not set"}
                      muted={!basePaySet}
                      hint={basePaySet ? "Monthly base pay, set in team settings" : "No base pay has been set for this person yet"}
                    />
                    <Figure
                      label="Proposals sent"
                      value={String(data.proposalsSent)}
                      hint={`Proposals sent during ${monthLabel(data.month)}`}
                    />
                    {/* Count and value together: the value IS the detail of the count, and
                        splitting them made five tiles, which no row divides evenly. */}
                    <Figure
                      label="Deals closed"
                      value={data.dealsClosed === 0 ? "0" : `${data.dealsClosed} · ${money(data.closedValue)}`}
                      hint="A deal counts on the day it was PAID, not the day it was signed"
                      span={!earnsCommission}
                    />
                    {earnsCommission && (
                      <Figure
                        label={`Commission (${data.commissionPct}%)`}
                        value={money(data.commission)}
                        hint={`Recognised ${TIMING_LABEL[data.payoutTiming] ?? data.payoutTiming}`}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* The current month is not finished, so its total is a projection. Say so. */}
            {data?.isCurrentMonth && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                {monthLabel(month)} is still in progress, so these figures will keep moving.
              </p>
            )}

            {!isLoading && data && !basePaySet && isAdmin && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                No base pay is set for {userId === selfId ? "you" : data.name}.{" "}
                <Link href="/settings?tab=team" className="font-medium text-foreground underline underline-offset-2">
                  Set it in team settings
                </Link>
                {" "}so this total is complete.
              </p>
            )}

            {/* ── The evidence ────────────────────────────────────────────────────────── */}
            <div className="mt-6 overflow-hidden rounded-[10px] border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-[13px] font-semibold text-foreground">
                  Deals in {monthLabel(month)}
                </h2>
                {!isLoading && data && (
                  // Ties to the figures above. A bare "12 proposals" beside "Proposals sent 10"
                  // reads as a contradiction rather than as two different questions.
                  <span className="text-[12px] tabular-nums text-muted-foreground">
                    {data.proposalsSent} sent · {data.dealsClosed} closed
                  </span>
                )}
              </div>

              {isLoading ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-4">
                      <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                      <div className="ml-auto h-3 w-16 animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
              ) : !data || data.rows.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <p className="text-sm font-medium text-foreground">Nothing yet in {monthLabel(month)}</p>
                  <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
                    Proposals appear here the month they are sent, and again the month they are paid.
                  </p>
                </div>
              ) : (
                <Table aria-label={`Deals in ${monthLabel(month)}`} size="sm">
                  <Table.Header>
                    <Table.Head id="client" label="Client" isRowHeader className="w-[38%]" />
                    <Table.Head id="state" label="Status" />
                    <Table.Head id="amount" label="Amount" />
                    <Table.Head id="sent" label="Sent" />
                    <Table.Head id="closed" label="Closed" />
                    {earnsCommission && <Table.Head id="commission" label="Commission" />}
                  </Table.Header>
                  <Table.Body items={data.rows}>
                    {(row: Row) => (
                      <Table.Row id={row.proposalId}>
                        <Table.Cell>
                          <Link
                            href={`/proposals/${row.proposalId}`}
                            className="block max-w-[320px] truncate font-medium text-foreground hover:underline"
                            title={row.client}
                          >
                            {row.client}
                          </Link>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge size="sm" color={STATE_COLOR[row.state] ?? "gray"}>{row.state}</Badge>
                        </Table.Cell>
                        <Table.Cell className="tabular-nums">{money(row.amount)}</Table.Cell>
                        <Table.Cell className="tabular-nums text-muted-foreground">{shortDate(row.sentAt)}</Table.Cell>
                        <Table.Cell className="tabular-nums text-muted-foreground">{shortDate(row.paidAt)}</Table.Cell>
                        {earnsCommission && (
                          <Table.Cell className="tabular-nums font-medium">
                            {row.commission > 0 ? money(row.commission) : <span className="text-muted-foreground">—</span>}
                          </Table.Cell>
                        )}
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
