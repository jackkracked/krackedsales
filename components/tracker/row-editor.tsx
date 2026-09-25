"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import type { SetterMonthRow } from "@/lib/tracker/setter";
import { money, monthShort, shortDate, useTrackerAction } from "@/components/tracker/tracker-api";

/**
 * Correct any cell on a row, like typing over a cell in the sheet. The automatic value is always
 * shown next to the field, so a correction never hides the data it replaced, and "Use automatic"
 * puts it back. Every change is saved with who made it and when, and the row is marked edited.
 */

type Field = "company" | "contactName" | "bookedAt" | "callAt" | "outcome" | "bonus" | "commission" | "closer";

const toDateInput = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : "");
/** A date typed in New York, stored as noon New York so no timezone can tip it into another day. */
const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00-05:00`).toISOString() : null);

export function RowEditor({
  row, subjectUserId, month, isAdmin, onClose,
}: {
  row: SetterMonthRow;
  subjectUserId: string;
  month: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const action = useTrackerAction();
  const commissionField = `commission@${month}`;
  const initial: Record<Field, string> = {
    company: row.company ?? "",
    contactName: row.contactName ?? "",
    bookedAt: toDateInput(row.bookedAt),
    callAt: toDateInput(row.callAt),
    outcome: row.overridden.outcome ? row.outcome : "",
    bonus: row.overridden.bonus ? String(row.bonusPayableCents / 100) : "",
    commission: row.overridden[commissionField] ? String(row.commissionPayableCents / 100) : "",
    closer: row.closerName ?? "",
  };
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (f: Field, v: string) => setValues((s) => ({ ...s, [f]: v }));

  const fieldKey = (f: Field) => (f === "commission" ? commissionField : f);
  const isOverridden = (f: Field) => !!row.overridden[fieldKey(f)];

  const reset = async (f: Field) => {
    setError(null);
    try {
      await action.mutateAsync({ action: "override", subjectUserId, rowKey: row.rowKey, field: fieldKey(f), value: null });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset");
    }
  };

  const save = async () => {
    setError(null);
    const changes: Array<{ field: string; value: unknown }> = [];
    for (const f of Object.keys(values) as Field[]) {
      if (values[f] === initial[f]) continue;
      const v = values[f].trim();
      if (f === "bookedAt" || f === "callAt") changes.push({ field: f, value: fromDateInput(v) });
      else if (f === "bonus" || f === "commission") {
        if (v === "") { changes.push({ field: fieldKey(f), value: null }); continue; }
        const n = Number(v.replace(/[$,]/g, ""));
        if (!Number.isFinite(n) || n < 0) { setError("Amounts must be a number of dollars, like 25"); return; }
        changes.push({ field: fieldKey(f), value: Math.round(n * 100) });
      } else if (f === "outcome") changes.push({ field: f, value: v || null });
      else changes.push({ field: f, value: v || null });
    }
    if (changes.length === 0) { onClose(); return; }
    setSaving(true);
    try {
      for (const c of changes) {
        await action.mutateAsync({ action: "override", subjectUserId, rowKey: row.rowKey, field: c.field, value: c.value });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const input = "h-8 w-full rounded-[7px] border border-border bg-background px-2.5 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring/30";

  // A plain function, not a component: a component declared inside render would remount every
  // input on each keystroke and throw away focus.
  const field = (f: Field, label: string, children: React.ReactNode, auto?: string) => (
    <label key={f} className="grid grid-cols-[110px_1fr] items-start gap-3">
      <span className="pt-2 text-[12px] font-medium text-muted-foreground">{label}</span>
      <span className="flex flex-col gap-1">
        {children}
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {auto && <span>Automatic: {auto}</span>}
          {isOverridden(f) && (
            <button type="button" onClick={() => reset(f)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <RotateCcw className="size-3" aria-hidden /> Use automatic
            </button>
          )}
        </span>
      </span>
    </label>
  );

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} label="Correct this booking" size="max-w-lg" showClose>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Correct this booking</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Changes are marked on the row with your name. {isAdmin ? "" : "Pay cells lock once the month is closed."}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {field("company", "Company", <input className={input} value={values.company} onChange={(e) => set("company", e.target.value)} maxLength={200} />)}
          {field("contactName", "Contact", <input className={input} value={values.contactName} onChange={(e) => set("contactName", e.target.value)} maxLength={200} />)}
          {field("bookedAt", "Booked on", <input type="date" className={input} value={values.bookedAt} onChange={(e) => set("bookedAt", e.target.value)} />)}
          {field("callAt", "Call date", <input type="date" className={input} value={values.callAt} onChange={(e) => set("callAt", e.target.value)} />, isOverridden("callAt") ? undefined : "from GoHighLevel")}
          {field("outcome", "Did it happen?", <select className={input} value={values.outcome} onChange={(e) => set("outcome", e.target.value)}>
              <option value="">Automatic</option>
              <option value="held">Showed</option>
              <option value="no_show">No-show</option>
              <option value="cancelled">Cancelled</option>
            </select>, isOverridden("outcome") ? undefined : row.outcome.replace("_", "-"))}
          {field("bonus", "Bonus", <input className={input} inputMode="decimal" placeholder="Automatic" value={values.bonus} onChange={(e) => set("bonus", e.target.value)} />, isOverridden("bonus") ? undefined : money(row.bonusPayableCents || row.bonusPendingCents || row.bonusAtStake))}
          {field("commission", `Commission in ${monthShort(month)}`, <input className={input} inputMode="decimal" placeholder="Automatic" value={values.commission} onChange={(e) => set("commission", e.target.value)} />, isOverridden("commission") ? undefined : money(row.commissionPayableCents + row.commissionPendingCents))}
          {field("closer", "Closer", <input className={input} value={values.closer} onChange={(e) => set("closer", e.target.value)} maxLength={200} />)}
        </div>

        {row.overridden.outcome && (
          <p className="text-[11px] text-muted-foreground">Outcome typed by {row.overridden.outcome.byName} on {shortDate(row.overridden.outcome.at)}.</p>
        )}
        {error && <p role="alert" className="text-[12px] text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-[7px] border border-border bg-background px-3 text-[13px] font-medium text-foreground hover:bg-muted">Cancel</button>
          <button
            type="button" onClick={save} disabled={saving}
            className="h-8 rounded-[7px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save corrections"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
