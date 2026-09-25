"use client";

import { useState } from "react";
import Link from "next/link";
import { Table } from "@/components/untitled/application/table/table";
import { Badge } from "@/components/untitled/base/badges/badges";
import { cn } from "@/lib/utils/cn";
import type { CloserMonth, CloserRow } from "@/lib/tracker/closer";
import { EditableFigure } from "@/components/tracker/editable-figure";
import {
  money, monthLabel, monthShort, shortDate, shortDateTime, signedMoney, useTrackerAction, type TrackerResponse,
} from "@/components/tracker/tracker-api";

/** How the payout-timing setting reads to a human, so the screen can say it out loud. */
const TIMING_LABEL: Record<string, string> = {
  full_paid: "when a proposal is paid in full",
  first_instalment: "when the first instalment is paid",
  split: "as each instalment is paid",
};

const STATE_COLOR: Record<string, "success" | "blue" | "gray" | "error"> = {
  Closed: "success", Signed: "blue", Sent: "gray", Lost: "error", Draft: "gray",
};

/**
 * A closer's month: the shipped view (tasks/closer-tracker-shape.md), plus the same editable month
 * numbers and notes as the setter's, and the calls this closer ran that still need an outcome,
 * because a setter's pay waits on them.
 */
export function CloserView({ res, initialNeeds }: { res: TrackerResponse; initialNeeds: boolean }) {
  const data = res.data as CloserMonth;
  const { viewer } = res;
  const action = useTrackerAction();
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const monthName = monthShort(data.month);
  const earnsCommission = data.commissionPct > 0 || data.commission !== 0;
  const payKnown = data.basePaySet || data.commission !== 0;

  const saveSetting = (field: string, value: number | null) =>
    action.mutateAsync({ action: "setting", userId: data.userId, month: data.month, field, value }).then(() => undefined);

  const record = async (appointmentId: string, outcome: "held" | "no_show") => {
    setOutcomeError(null);
    try {
      await action.mutateAsync({ action: "outcome", rowRef: appointmentId, outcome });
    } catch (e) {
      setOutcomeError(e instanceof Error ? e.message : "Could not save");
    }
  };

  const payNote = data.closed
    ? "Final. This month is closed."
    : data.basePaySet
      ? (earnsCommission ? "Base pay plus commission this month" : "Base pay this month")
      : payKnown ? "Commission only, no base pay set" : "No base pay set";

  const btn = "inline-flex h-7 items-center rounded-[7px] border border-border bg-background px-2.5 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

  return (
    <>
      <div className="mt-5 grid gap-3 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col justify-center rounded-[10px] border border-border bg-card px-5 py-4">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total estimated pay</span>
          <span className={cn("mt-1 truncate text-[28px] font-semibold leading-tight tabular-nums", payKnown ? "text-foreground" : "text-muted-foreground")}
            style={{ fontFamily: "var(--font-heading)" }}>
            {payKnown ? money(Math.round(data.totalEstimatedPay * 100)) : "Not set"}
          </span>
          <span className="mt-1 text-[12px] text-muted-foreground">{payNote}</span>
        </div>

        <div className="overflow-hidden rounded-[10px] border border-border bg-card">
          <div className={cn("grid h-full grid-cols-2 divide-x divide-y divide-border lg:divide-y-0", earnsCommission ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
            <EditableFigure
              label="Base pay" monthName={monthName}
              display={data.basePaySet ? money(data.settings.basePayCents!) : "Not set"} muted={!data.basePaySet}
              rawValue={data.basePaySet ? data.settings.basePayCents! / 100 : null} unit="dollars"
              editable={viewer.canEdit} edited={data.settings.edited.basePayCents}
              onSave={(v) => saveSetting("basePayCents", v === null ? null : Math.round(v * 100))}
              hint="Monthly base pay for this month"
            />
            <EditableFigure
              label="Proposals sent" monthName={monthName} display={String(data.proposalsSent)}
              rawValue={null} unit="dollars" editable={false} onSave={async () => {}}
              hint={`Proposals sent during ${monthLabel(data.month)}`}
            />
            <EditableFigure
              label="Deals closed" monthName={monthName}
              display={data.dealsClosed === 0 ? "0" : `${data.dealsClosed} · ${money(Math.round(data.closedValue * 100))}`}
              rawValue={null} unit="dollars" editable={false} onSave={async () => {}}
              hint="A deal counts on the day it was PAID, not the day it was signed"
            />
            {earnsCommission && (
              <EditableFigure
                label={`Commission (${data.commissionPct}%)`} monthName={monthName}
                display={money(Math.round(data.commission * 100))}
                rawValue={data.commissionPct} unit="percent"
                editable={viewer.canEdit} edited={data.settings.edited.commissionPct}
                onSave={(v) => saveSetting("commissionPct", v)}
                hint={`Recognised ${TIMING_LABEL[data.payoutTiming] ?? data.payoutTiming}. Click to change the rate for this month.`}
              />
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 text-[12px] text-muted-foreground">
        {data.historical
          ? `${monthLabel(data.month)} was paid before the tracker went live. Shown for reference.`
          : data.closed
            ? `Closed ${res.closedAt ? shortDate(res.closedAt) : ""}. These figures are final; any later change shows in the next open month.`
            : data.isCurrentMonth
              ? `${monthLabel(data.month)} is still in progress, so these figures will keep moving.`
              : `${monthLabel(data.month)} is over but not closed yet.`}
        {data.adjustments !== 0 && ` Includes ${signedMoney(Math.round(data.adjustments * 100))} of changes to closed months.`}
      </p>

      {/* Calls this closer ran that nobody has marked. A setter is paid on these. */}
      {(viewer.isSelf || viewer.isAdmin) && data.awaitingOutcome.length > 0 && (
        <div className={cn("mt-5 overflow-hidden rounded-[10px] border bg-card", initialNeeds ? "border-primary/40" : "border-border")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold text-foreground">
              {data.awaitingOutcome.length} {data.awaitingOutcome.length === 1 ? "call needs" : "calls need"} an outcome
            </h2>
            <span className="text-[12px] text-muted-foreground">A setter is paid on these once {viewer.isSelf ? "you say" : "the closer says"} whether they showed.</span>
          </div>
          <ul className="divide-y divide-border">
            {data.awaitingOutcome.map((c) => (
              <li key={c.appointmentId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-medium text-foreground">{c.contactName ?? "Unknown prospect"}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{shortDateTime(c.startTime)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <button type="button" className={btn} disabled={action.isPending} onClick={() => record(c.appointmentId, "held")}>Showed</button>
                  <button type="button" className={btn} disabled={action.isPending} onClick={() => record(c.appointmentId, "no_show")}>No-show</button>
                </span>
              </li>
            ))}
          </ul>
          {outcomeError && <p role="alert" className="px-4 pb-3 text-[12px] text-destructive">{outcomeError}</p>}
        </div>
      )}

      {!data.basePaySet && viewer.isAdmin && !viewer.isSelf && !data.historical && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          No base pay is set for {data.name} in {monthName}. Click it above, or{" "}
          <Link href="/settings?tab=team" className="font-medium text-foreground underline underline-offset-2">set a default in team settings</Link>.
        </p>
      )}

      <div className="mt-5 overflow-hidden rounded-[10px] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold text-foreground">Deals in {monthLabel(data.month)}</h2>
          <span className="text-[12px] tabular-nums text-muted-foreground">{data.proposalsSent} sent · {data.dealsClosed} closed</span>
        </div>
        {data.rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-foreground">Nothing yet in {monthLabel(data.month)}</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">Proposals appear here the month they are sent, and again the month they are paid.</p>
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <Table aria-label={`Deals in ${monthLabel(data.month)}`} size="sm">
                <Table.Header>
                  <Table.Head id="client" label="Client" isRowHeader className="w-[30%]" />
                  <Table.Head id="state" label="Status" />
                  <Table.Head id="amount" label="Amount" />
                  <Table.Head id="sent" label="Sent" />
                  <Table.Head id="closed" label="Closed" />
                  {earnsCommission && <Table.Head id="commission" label="Commission" />}
                  <Table.Head id="notes" label="Notes" className="w-[18%]" />
                </Table.Header>
                <Table.Body items={data.rows.map((r) => ({ ...r, id: r.rowKey }))}>
                  {(row: CloserRow & { id: string }) => (
                    <Table.Row id={row.id}>
                      <Table.Cell>
                        <Link href={`/proposals?id=${row.proposalId}`} className="block max-w-[300px] truncate font-medium text-foreground hover:underline" title={row.client}>{row.client}</Link>
                        {row.isAdjustment && <span className="block text-[11px] text-warning">Changed after its month closed</span>}
                      </Table.Cell>
                      <Table.Cell><Badge size="sm" color={STATE_COLOR[row.state] ?? "gray"}>{row.state}</Badge></Table.Cell>
                      <Table.Cell className="tabular-nums">{money(Math.round(row.amount * 100))}</Table.Cell>
                      <Table.Cell className="tabular-nums text-muted-foreground">{shortDate(row.sentAt)}</Table.Cell>
                      <Table.Cell className="tabular-nums text-muted-foreground">{shortDate(row.paidAt)}</Table.Cell>
                      {earnsCommission && (
                        <Table.Cell className="tabular-nums font-medium">
                          {row.commission !== 0
                            ? (row.isAdjustment ? signedMoney(Math.round(row.commission * 100)) : money(Math.round(row.commission * 100)))
                            : <span className="text-muted-foreground">—</span>}
                        </Table.Cell>
                      )}
                      <Table.Cell>
                        <CloserNote row={row} editable={viewer.canEdit} subjectUserId={data.userId} />
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {data.rows.map((row) => (
                <li key={row.rowKey} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/proposals?id=${row.proposalId}`} className="truncate text-[13px] font-medium text-foreground">{row.client}</Link>
                    <span className="shrink-0 text-[13px] font-medium tabular-nums">{row.commission !== 0 ? money(Math.round(row.commission * 100)) : "—"}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                    <Badge size="sm" color={STATE_COLOR[row.state] ?? "gray"}>{row.state}</Badge>
                    <span className="tabular-nums">{money(Math.round(row.amount * 100))}</span>
                    <span>Sent {shortDate(row.sentAt)}</span>
                    {row.paidAt && <span>Paid {shortDate(row.paidAt)}</span>}
                  </div>
                  {row.notes && <p className="text-[12px] text-muted-foreground">{row.notes}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function CloserNote({ row, editable, subjectUserId }: { row: CloserRow; editable: boolean; subjectUserId: string }) {
  const action = useTrackerAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!editable) return <span className="block max-w-[200px] truncate text-muted-foreground" title={row.notes ?? undefined}>{row.notes ?? "—"}</span>;
  const save = async () => {
    setEditing(false);
    const v = draft.trim() || null;
    if (v === (row.notes ?? null)) return;
    try {
      await action.mutateAsync({ action: "override", subjectUserId, rowKey: row.rowKey, field: "notes", value: v });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
  };
  return editing ? (
    <input autoFocus value={draft} maxLength={2000} aria-label="Note" onChange={(e) => setDraft(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(row.notes ?? ""); setEditing(false); } }}
      className="h-7 w-full min-w-[120px] rounded-[6px] border border-border bg-background px-2 text-[12px] outline-none focus:ring-2 focus:ring-ring/30" />
  ) : (
    <span className="flex flex-col">
      <button type="button" onClick={() => { setDraft(row.notes ?? ""); setEditing(true); }} title={row.notes ?? "Add a note"}
        className="block max-w-[200px] truncate rounded-[5px] px-1 text-left text-[12px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
        {row.notes ?? "Add a note"}
      </button>
      {error && <span role="alert" className="text-[11px] text-destructive">{error}</span>}
    </span>
  );
}
