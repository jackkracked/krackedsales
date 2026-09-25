"use client";

import { useMemo, useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { Table } from "@/components/untitled/application/table/table";
import { Badge } from "@/components/untitled/base/badges/badges";
import { cn } from "@/lib/utils/cn";
import type { SetterMonth, SetterMonthRow } from "@/lib/tracker/setter";
import { EditableFigure } from "@/components/tracker/editable-figure";
import { RowEditor } from "@/components/tracker/row-editor";
import { AddBooking } from "@/components/tracker/add-booking";
import {
  money, monthLabel, monthShort, shortDate, shortDateTime, signedMoney, useTrackerAction, type TrackerResponse,
} from "@/components/tracker/tracker-api";

type BadgeColor = "gray" | "success" | "error" | "warning" | "blue" | "brand";

/**
 * The setter's month. Three layers, top to bottom (tasks/setter-tracker-shape.md):
 *   A. the answer, with its working written out;
 *   B. what needs a person, and only when something does;
 *   C. the rows: every column of Kelsey's sheet, grouped so it fits.
 * Every figure in A is a sum of money on rows in C. Pending money is never inside the total.
 */
export function SetterView({ res, initialNeeds, onMonth }: { res: TrackerResponse; initialNeeds: boolean; onMonth: (m: string) => void }) {
  const data = res.data as SetterMonth & { name: string };
  const { viewer } = res;
  const action = useTrackerAction();
  const [needsOnly, setNeedsOnly] = useState(initialNeeds);
  const [editing, setEditing] = useState<SetterMonthRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [rowError, setRowError] = useState<{ rowKey: string; message: string } | null>(null);
  const monthName = monthShort(data.month);
  const who = viewer.isSelf ? "you" : data.name.split(" ")[0];

  const saveSetting = (field: string, value: number | null) =>
    action.mutateAsync({ action: "setting", userId: data.userId, month: data.month, field, value }).then(() => undefined);

  const act = async (rowKey: string, body: Record<string, unknown>) => {
    setRowError(null);
    try {
      await action.mutateAsync(body);
    } catch (e) {
      setRowError({ rowKey, message: e instanceof Error ? e.message : "Could not save" });
    }
  };

  const needsRow = (r: SetterMonthRow) =>
    r.credit.state === "suggested" || r.credit.state === "clash" || r.outcome === "awaiting";
  const rows = useMemo(() => (needsOnly ? data.rows.filter(needsRow) : data.rows), [data.rows, needsOnly]);
  const needsTotal = data.needsYou.confirm + data.needsYou.clash + data.needsYou.awaitingOutcome;

  const t = data.totals;
  const rc = data.reconciliation;
  const bonus = data.settings.bookingBonusCents;
  const baseSet = data.settings.basePayCents !== null;
  const payKnown = baseSet || t.paidCents > 0;
  // The bonus money from THIS month's calls and restorations: the right-hand side of the working.
  // Adjustments to closed months are their own term, never folded into this sum.
  const countedCents = t.countedBonusCents;

  return (
    <>
      {/* ── A. The answer, and its working ───────────────────────────────────────────────── */}
      <div className="mt-5 grid gap-3 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col justify-center rounded-[10px] border border-border bg-card px-5 py-4">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total estimated pay</span>
          <span
            className={cn("mt-1 truncate text-[28px] font-semibold leading-tight tabular-nums", payKnown ? "text-foreground" : "text-muted-foreground")}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {payKnown ? money(t.paidCents) : "Not set"}
          </span>
          <span className="mt-1 text-[12px] text-muted-foreground">
            {t.pendingCents > 0
              ? <>Confirmed only. <span className="font-medium text-foreground">{money(t.pendingCents)}</span> more is pending.</>
              : data.closed ? "Final. This month is closed." : "Confirmed. Nothing pending."}
          </span>
        </div>

        <div className="overflow-hidden rounded-[10px] border border-border bg-card">
          <div className="grid h-full grid-cols-2 divide-x divide-y divide-border lg:grid-cols-4 lg:divide-y-0">
            <EditableFigure
              label="Base pay" monthName={monthName}
              display={baseSet ? money(data.settings.basePayCents!) : "Not set"} muted={!baseSet}
              rawValue={baseSet ? data.settings.basePayCents! / 100 : null} unit="dollars"
              editable={viewer.canEdit} edited={data.settings.edited.basePayCents}
              onSave={(v) => saveSetting("basePayCents", v === null ? null : Math.round(v * 100))}
              hint="Monthly base pay for this month"
            />
            <EditableFigure
              label="Booking bonus" monthName={monthName}
              display={money(countedCents)}
              emphasis={rc.bonusIsUniform ? `${rc.counted} × ${money(bonus)}` : `${rc.counted} counted, some amounts corrected`}
              rawValue={bonus / 100} unit="dollars"
              editable={viewer.canEdit} edited={data.settings.edited.bookingBonusCents}
              onSave={(v) => saveSetting("bookingBonusCents", Math.round((v ?? 0) * 100))}
              hint="Paid for each booked call that actually happened. Click to change the amount per call."
            />
            <EditableFigure
              label="Closed value" monthName={monthName}
              display={money(Math.round(t.closedValue * 100))}
              rawValue={null} unit="dollars" editable={false}
              hint="Proposals on your bookings whose commission landed this month"
              onSave={async () => {}}
            />
            <EditableFigure
              label={`Commission (${data.settings.commissionPct}%)`} monthName={monthName}
              display={money(t.commissionCents)}
              rawValue={data.settings.commissionPct} unit="percent"
              editable={viewer.canEdit} edited={data.settings.edited.commissionPct}
              onSave={(v) => saveSetting("commissionPct", v)}
              hint="Your percentage of proposals closed on calls you booked. Click to change the rate for this month."
            />
          </div>
        </div>
      </div>

      {/* The working, in words. This line is the answer to "why did my number go down". */}
      {!data.historical && rc.booked + rc.restored > 0 && (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{rc.booked} booked</span>
          {rc.cancelled > 0 && <span>−{rc.cancelled} cancelled</span>}
          {rc.noShow > 0 && <span>−{rc.noShow} no-show</span>}
          {rc.waiting > 0 && <span>−{rc.waiting} pending</span>}
          {rc.rebooks > 0 && <span>−{rc.rebooks} rebook{rc.rebooks === 1 ? "" : "s"}, paid on the original</span>}
          {rc.restored > 0 && <span className="text-success">+{rc.restored} restored</span>}
          <span aria-hidden>=</span>
          <span className="font-medium text-foreground">
            {rc.bonusIsUniform ? `${rc.counted} counted × ${money(bonus)} = ${money(countedCents)}` : `${rc.counted} counted = ${money(countedCents)}`}
          </span>
          {t.adjustmentsCents !== 0 && (
            <span>
              and <span className="font-medium text-foreground">{signedMoney(t.adjustmentsCents)}</span> of changes to closed months, listed below
            </span>
          )}
        </p>
      )}

      {/* State of the month, said once. */}
      <MonthNote data={data} closedAt={res.closedAt} laterCount={data.laterBookings.count} laterCents={data.laterBookings.pendingCents} />

      {!viewer.isSelf || baseSet ? null : (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Base pay is not set for {monthName}. Click it above to add it, so this total is complete.
        </p>
      )}

      {/* ── B. Needs you ──────────────────────────────────────────────────────────────────── */}
      {data.needsElsewhere.length > 0 && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Also waiting on {viewer.isSelf ? "you" : "a decision"}:{" "}
          {data.needsElsewhere.map((n, i) => (
            <span key={n.month}>
              {i > 0 && ", "}
              <button type="button" onClick={() => onMonth(n.month)} className="font-medium text-primary hover:underline">
                {n.count} in {monthShort(n.month)}
              </button>
            </span>
          ))}
        </p>
      )}
      {needsTotal > 0 && !data.closed && (
        <button
          type="button"
          onClick={() => setNeedsOnly((v) => !v)}
          aria-pressed={needsOnly}
          className={cn(
            "mt-5 flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border px-4 py-3 text-left text-[13px] transition-colors",
            needsOnly ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:bg-muted/50",
          )}
        >
          <span className="font-semibold text-foreground">Needs {viewer.isSelf ? "you" : "a decision"}</span>
          {data.needsYou.confirm > 0 && <span>{data.needsYou.confirm} {data.needsYou.confirm === 1 ? "booking looks" : "bookings look"} like {viewer.isSelf ? "yours" : `${who}'s`}</span>}
          {data.needsYou.clash > 0 && <span>{data.needsYou.clash} claimed by two people</span>}
          {data.needsYou.awaitingOutcome > 0 && <span>{data.needsYou.awaitingOutcome} {data.needsYou.awaitingOutcome === 1 ? "call needs" : "calls need"} an outcome</span>}
          <span className="ml-auto text-[12px] font-medium text-primary">{needsOnly ? "Show all rows" : "Show only these"}</span>
        </button>
      )}

      {/* ── C. The rows ───────────────────────────────────────────────────────────────────── */}
      <div className="mt-5 overflow-hidden rounded-[10px] border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold text-foreground">
            {needsOnly ? "Needs a decision" : `Booked calls in ${monthLabel(data.month)}`}
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-[12px] tabular-nums text-muted-foreground">{rows.length} {rows.length === 1 ? "row" : "rows"}</span>
            {viewer.canEdit && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-border bg-background px-2.5 text-[12px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <Plus className="size-3.5" aria-hidden /> Add a booking
              </button>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-foreground">
              {needsOnly ? "Nothing needs a decision" : `No booked calls in ${monthLabel(data.month)} yet`}
            </p>
            {!needsOnly && (
              <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
                A call shows here in the month it takes place. Bookings from a tracked link, or booked in the app, appear on their own.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Desktop: the sheet, grouped into 8 columns. */}
            {/* Seven columns hold all thirteen of the sheet's: the closer (her "Sales Rep") rides
                under the call it ran, which is where the eye already is. Scrolls sideways only as a
                safety net at narrow desktop widths. */}
            <div className="hidden overflow-x-auto md:block">
              <Table aria-label={`Booked calls in ${monthLabel(data.month)}`} size="sm" className="min-w-[860px] table-fixed">
                <Table.Header>
                  <Table.Head id="prospect" label="Prospect" isRowHeader className="w-[19%]" />
                  <Table.Head id="booked" label="Booked" className="w-[14%]" />
                  <Table.Head id="call" label="Call" className="w-[25%]" />
                  <Table.Head id="bonus" label="Bonus" className="w-[8%]" />
                  <Table.Head id="proposal" label="Proposal" className="w-[14%]" />
                  <Table.Head id="commission" label="Commission" className="w-[9%]" />
                  <Table.Head id="notes" label="Notes" className="w-[11%]" />
                </Table.Header>
                <Table.Body items={rows.map((r) => ({ ...r, id: r.rowKey }))}>
                  {(r: SetterMonthRow & { id: string }) => (
                    <Table.Row id={r.id} className={cn(dimmed(r) && "[&_td]:text-muted-foreground")}>
                      <Table.Cell>
                        <ProspectCell r={r} canEdit={viewer.canCorrectRows} onEdit={() => setEditing(r)} />
                      </Table.Cell>
                      <Table.Cell className="tabular-nums">
                        <span className="block">{shortDate(r.bookedAt)}</span>
                        <span className="block truncate text-[11px] text-muted-foreground" title={sourceLabel(r, viewer.isSelf, data.name)}>{sourceLabel(r, viewer.isSelf, data.name)}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <CallCell r={r} viewer={viewer} busy={action.isPending} month={data.month}
                          onOutcome={(o) => act(r.rowKey, { action: "outcome", rowRef: r.appointmentId ?? r.rowKey, outcome: o })}
                          onCredit={(decision, setterUserId) => act(r.rowKey, {
                            action: "credit", decision, setterUserId,
                            ...(r.appointmentId ? { appointmentId: r.appointmentId } : { manualRowId: r.manualRowId }),
                          })}
                          subjectId={data.userId}
                        />
                        {rowError?.rowKey === r.rowKey && <span role="alert" className="mt-1 block text-[11px] text-destructive">{rowError.message}</span>}
                      </Table.Cell>
                      <Table.Cell className="tabular-nums"><BonusCell r={r} rate={bonus} month={data.month} /></Table.Cell>
                      <Table.Cell><ProposalCell r={r} /></Table.Cell>
                      <Table.Cell className="tabular-nums"><CommissionCell r={r} /></Table.Cell>
                      <Table.Cell>
                        <NoteCell r={r} editable={viewer.canEdit} onSave={(v) => act(r.rowKey, { action: "override", subjectUserId: data.userId, rowKey: r.rowKey, field: "notes", value: v })} />
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table>
            </div>

            {/* Phone: the same facts, stacked. */}
            <ul className="divide-y divide-border md:hidden">
              {rows.map((r) => (
                <li key={r.rowKey} className={cn("flex flex-col gap-2 px-4 py-3", dimmed(r) && "text-muted-foreground")}>
                  <div className="flex items-start justify-between gap-3">
                    <ProspectCell r={r} canEdit={viewer.canCorrectRows} onEdit={() => setEditing(r)} />
                    <span className="shrink-0 text-right text-[13px] tabular-nums"><BonusCell r={r} rate={bonus} month={data.month} /></span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                    <span>Booked {shortDate(r.bookedAt)} · {sourceLabel(r, viewer.isSelf, data.name)}</span>
                    {r.proposal && <span>Proposal {r.proposal.state.toLowerCase()} · {money(Math.round(r.proposal.amount * 100))}</span>}
                    {(r.commissionPayableCents !== 0 || r.commissionPendingCents > 0) && <span>Commission <CommissionCell r={r} /></span>}
                  </div>
                  <CallCell r={r} viewer={viewer} busy={action.isPending} month={data.month} full
                    onOutcome={(o) => act(r.rowKey, { action: "outcome", rowRef: r.appointmentId ?? r.rowKey, outcome: o })}
                    onCredit={(decision, setterUserId) => act(r.rowKey, {
                      action: "credit", decision, setterUserId,
                      ...(r.appointmentId ? { appointmentId: r.appointmentId } : { manualRowId: r.manualRowId }),
                    })}
                    subjectId={data.userId}
                  />
                  {rowError?.rowKey === r.rowKey && <span role="alert" className="text-[11px] text-destructive">{rowError.message}</span>}
                  {r.notes && <p className="text-[12px] text-muted-foreground">{r.notes}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {editing && (
        <RowEditor
          row={editing}
          subjectUserId={data.userId}
          isAdmin={viewer.isAdmin}
          month={data.month}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && <AddBooking setterUserId={data.userId} onClose={() => setAdding(false)} />}
    </>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────

/** Rows that put no money on this month are shown quieter, so the eye lands on what pays. */
function dimmed(r: SetterMonthRow) {
  return ["cancelled", "moved", "no_show_waiting", "never_rebooked", "superseded", "before_tracker"].includes(r.bonusState) && !r.isRestoration && r.commissionPayableCents === 0;
}

function sourceLabel(r: SetterMonthRow, isSelf: boolean, name: string) {
  const you = isSelf ? "you" : name.split(" ")[0];
  switch (r.credit.source) {
    case "link": return "Tracked link";
    case "in_app": return "Booked in the app";
    case "ghl_manual": return "Booked in GoHighLevel";
    case "owner":
      if (r.credit.state === "suggested") {
        const lead = `${isSelf ? "your" : `${you}'s`} lead`;
        return r.credit.bookedByName ? `Booked by ${r.credit.bookedByName} · ${lead}` : `Self-booked · ${lead}`;
      }
      return `Confirmed by ${you}`;
    case "manual": return `Added by ${you}`;
  }
}

function ProspectCell({ r, canEdit, onEdit }: { r: SetterMonthRow; canEdit: boolean; onEdit: () => void }) {
  const edited = Object.keys(r.overridden).filter((k) => k !== "notes");
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <div className="min-w-0">
        <span className="block max-w-[220px] truncate font-medium text-foreground" title={r.company ?? r.contactName ?? undefined}>
          {r.company ?? r.contactName ?? "Unknown prospect"}
        </span>
        {r.company && r.contactName && (
          <span className="block max-w-[220px] truncate text-[11px] text-muted-foreground" title={r.contactName}>{r.contactName}</span>
        )}
        {edited.length > 0 && (
          <span className="mt-0.5 block text-[11px] text-primary" title={edited.map((k) => `${k}: ${r.overridden[k].byName}, ${shortDate(r.overridden[k].at)}`).join("\n")}>
            Edited by {r.overridden[edited[0]].byName}
          </span>
        )}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Correct this row: ${r.company ?? r.contactName ?? "booking"}`}
          className="mt-0.5 shrink-0 rounded-[5px] p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

const OUTCOME_BADGE: Record<string, { label: string; color: BadgeColor }> = {
  held: { label: "Held", color: "success" },
  no_show: { label: "No-show", color: "error" },
  cancelled: { label: "Cancelled", color: "gray" },
  moved: { label: "Moved off sales calendar", color: "gray" },
  upcoming: { label: "Upcoming", color: "gray" },
  awaiting: { label: "Awaiting outcome", color: "warning" },
};

function CallCell({
  r, viewer, busy, onOutcome, onCredit, subjectId, full = false,
}: {
  r: SetterMonthRow;
  viewer: TrackerResponse["viewer"];
  busy: boolean;
  month: string;
  onOutcome: (o: "held" | "no_show") => void;
  onCredit: (decision: "claim" | "reject", setterUserId: string) => void;
  subjectId: string;
  full?: boolean;
}) {
  const badge = OUTCOME_BADGE[r.outcome] ?? OUTCOME_BADGE.awaiting;
  const btn = "inline-flex h-6 items-center rounded-[6px] border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const canDecide = viewer.isSelf || viewer.isAdmin;

  return (
    <div className={cn("flex flex-col gap-1", full && "gap-1.5")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="whitespace-nowrap tabular-nums">{shortDateTime(r.callAt)}</span>
        <Badge size="sm" color={badge.color}>{badge.label}</Badge>
      </div>
      {r.closerName && <span className="truncate text-[11px] text-muted-foreground" title={`Closer: ${r.closerName}`}>with {r.closerName}</span>}
      <StateCaption r={r} />

      {r.credit.state === "suggested" && canDecide && (
        <div className="flex flex-nowrap items-center gap-1">
          <span className="mr-0.5 whitespace-nowrap text-[11px] text-muted-foreground">{viewer.isSelf ? "Yours?" : "Theirs?"}</span>
          <button type="button" className={btn} disabled={busy} onClick={() => onCredit("claim", subjectId)} aria-label={viewer.isSelf ? "Yes, this booking is mine" : "Yes, this booking is theirs"}>Yes</button>
          <button type="button" className={btn} disabled={busy} onClick={() => onCredit("reject", subjectId)} aria-label={viewer.isSelf ? "No, not mine" : "No, not theirs"}>No</button>
        </div>
      )}

      {r.credit.state === "clash" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge size="sm" color="warning">Also claimed by {r.credit.clashWith.join(", ")}</Badge>
          {viewer.isAdmin ? (
            <button
              type="button" className={btn} disabled={busy}
              onClick={() => r.credit.clashWithIds.forEach((id) => onCredit("reject", id))}
            >
              Award to this person
            </button>
          ) : viewer.isSelf ? (
            <button type="button" className={btn} disabled={busy} onClick={() => onCredit("reject", subjectId)}>Not mine</button>
          ) : null}
        </div>
      )}

      {r.outcome === "awaiting" && (viewer.isAdmin || viewer.isSelf) && (
        <div className="flex flex-nowrap items-center gap-1">
          <span className="mr-0.5 whitespace-nowrap text-[11px] text-muted-foreground">Showed?</span>
          <button type="button" className={btn} disabled={busy} onClick={() => onOutcome("held")} aria-label="Yes, they showed">Yes</button>
          <button type="button" className={btn} disabled={busy} onClick={() => onOutcome("no_show")} aria-label="No, it was a no-show">No-show</button>
        </div>
      )}
    </div>
  );
}

/** One quiet line explaining the row's money, in the product's own words. */
function StateCaption({ r }: { r: SetterMonthRow }) {
  const cap = (text: string, tone?: "success" | "warning") => (
    <span className={cn("text-[11px]", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-muted-foreground")}>{text}</span>
  );
  if (r.isRestoration) return cap(`No-show on ${shortDate(r.callAt)}, rebooked and showed`, "success");
  if (r.isAdjustment) return cap(`Changed after ${monthShort(r.month)} closed`, "warning");
  switch (r.bonusState) {
    case "restored": return cap(`Rebook showed ${shortDate(r.restoredIn?.callAt)}, paid in ${monthShort(r.restoredIn!.month)}`, "success");
    case "no_show_waiting": return cap("Waiting for a rebook");
    case "never_rebooked": return cap("Never rebooked");
    case "superseded": return cap("Paid on the first booking in this chain");
    case "rebook_of": return cap(`Rebook of ${shortDate(r.rebookOf?.callAt)}, paid there`);
    case "before_tracker": return cap("Before the tracker, paid from the spreadsheet");
  }
  if (r.evidence?.selfReported) return cap(`Marked by the setter, not the closer`, "warning");
  if (r.evidence?.byName && r.outcome === "held") return cap(`Confirmed by ${r.evidence.byName}`);
  return null;
}

function BonusCell({ r, rate }: { r: SetterMonthRow; rate: number; month: string }) {
  if (r.isRestoration || r.isAdjustment) {
    const v = r.bonusPayableCents;
    if (v === 0 && r.bonusPendingCents > 0) return <span className="text-muted-foreground">{money(r.bonusPendingCents)} pending</span>;
    return v === 0 ? <span className="text-muted-foreground">—</span> : <span className={cn("font-medium", v > 0 ? "text-success" : "text-destructive")}>{signedMoney(v)}</span>;
  }
  if (r.bonusPayableCents > 0) return <span className="font-medium text-foreground">{money(r.bonusPayableCents)}</span>;
  if (r.bonusPendingCents > 0) return <span className="text-muted-foreground">{money(r.bonusPendingCents)} <span className="text-[11px]">pending</span></span>;
  switch (r.bonusState) {
    case "cancelled": case "moved": case "no_show_waiting": case "never_rebooked": case "superseded": case "restored":
      return (
        <span className="flex flex-col">
          <span className="text-muted-foreground line-through" aria-label={`${money(r.bonusAtStake || rate)} not paid`}>{money(r.bonusAtStake || rate)}</span>
          {r.bonusState === "restored" && <span className="text-[11px] text-success">back in {monthShort(r.restoredIn!.month)}</span>}
        </span>
      );
  }
  return <span className="text-muted-foreground">—</span>;
}

function ProposalCell({ r }: { r: SetterMonthRow }) {
  if (!r.proposal) return <span className="text-muted-foreground">—</span>;
  const color: BadgeColor = r.proposal.state === "Closed" ? "success" : r.proposal.state === "Signed" ? "blue" : r.proposal.state === "Lost" ? "error" : "gray";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <Badge size="sm" color={color}>{r.proposal.state}</Badge>
        <span className="tabular-nums">{money(Math.round(r.proposal.amount * 100))}</span>
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        Sent {shortDate(r.proposal.sentAt)}{r.proposal.paidAt ? ` · paid ${shortDate(r.proposal.paidAt)}` : ""}
      </span>
    </div>
  );
}

function CommissionCell({ r }: { r: SetterMonthRow }) {
  if (r.commissionPayableCents !== 0) {
    return <span className={cn("font-medium", r.commissionPayableCents < 0 && "text-destructive")}>{r.isAdjustment ? signedMoney(r.commissionPayableCents) : money(r.commissionPayableCents)}</span>;
  }
  if (r.commissionPendingCents > 0) return <span className="text-muted-foreground">{money(r.commissionPendingCents)} <span className="text-[11px]">pending</span></span>;
  return <span className="text-muted-foreground">—</span>;
}

function NoteCell({ r, editable, onSave }: { r: SetterMonthRow; editable: boolean; onSave: (v: string | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(r.notes ?? "");
  if (!editable) return <span className="block max-w-[180px] truncate text-muted-foreground" title={r.notes ?? undefined}>{r.notes ?? "—"}</span>;
  if (editing) {
    return (
      <input
        autoFocus value={draft} maxLength={2000}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if ((draft.trim() || null) !== (r.notes ?? null)) void onSave(draft.trim() || null); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setDraft(r.notes ?? ""); setEditing(false); }
        }}
        aria-label="Note"
        className="h-7 w-full min-w-[120px] rounded-[6px] border border-border bg-background px-2 text-[12px] outline-none focus:ring-2 focus:ring-ring/30"
      />
    );
  }
  return (
    <button
      type="button" onClick={() => { setDraft(r.notes ?? ""); setEditing(true); }}
      className="block max-w-[180px] truncate rounded-[5px] px-1 text-left text-[12px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      title={r.notes ?? "Add a note"}
    >
      {r.notes ?? "Add a note"}
    </button>
  );
}

function MonthNote({ data, closedAt, laterCount, laterCents }: { data: SetterMonth; closedAt: string | null; laterCount: number; laterCents: number }) {
  const parts: React.ReactNode[] = [];
  if (data.historical) parts.push(`${monthLabel(data.month)} was paid from the spreadsheet. Shown for reference; nothing here changes pay.`);
  else if (data.closed) parts.push(`Closed ${closedAt ? shortDate(closedAt) : ""}. These figures are final; any later change shows in the next open month.`);
  else if (data.isCurrentMonth) parts.push(`${monthLabel(data.month)} is still in progress, so these figures will keep moving.`);
  else parts.push(`${monthLabel(data.month)} is over but not closed yet. Pending rows can still resolve into it.`);
  if (laterCount > 0 && data.isCurrentMonth) parts.push(` ${laterCount} more ${laterCount === 1 ? "booking is" : "bookings are"} set for later months (${money(laterCents)} if they happen).`);
  return <p className="mt-2 text-[12px] text-muted-foreground">{parts}</p>;
}

