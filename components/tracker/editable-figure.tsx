"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { shortDate } from "@/components/tracker/tracker-api";

/**
 * One of the three numbers at the top of a month, editable in place, like the yellow cell at the
 * top of Kelsey's sheet. Click, type, Enter. Esc cancels. The change applies to this month only,
 * and says so under the field while editing.
 *
 * The value shown while saving is the one typed (optimistic). If the save fails it snaps back and
 * the error is shown in the field's own space, never in a toast that vanishes before it is read.
 */
export function EditableFigure({
  label, display, rawValue, unit, editable, onSave, edited, hint, muted = false, monthName, emphasis,
}: {
  label: string;
  /** What reads when not editing: "$1,500", "Not set", "5%". */
  display: string;
  /** The number the input opens with, in the unit the person types (dollars, or percent). */
  rawValue: number | null;
  unit: "dollars" | "percent";
  editable: boolean;
  onSave: (value: number | null) => Promise<void>;
  edited?: { byName: string; at: string };
  hint?: string;
  muted?: boolean;
  monthName: string;
  /** A second line under the value, e.g. "13 × $25". */
  emphasis?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // What was typed, remembered against the server value it replaced. When the server's value
  // changes, `basis` no longer matches and the typed value simply stops showing: no effect needed.
  const [typed, setTyped] = useState<{ value: string; basis: string } | null>(null);
  const optimistic = typed && typed.basis === display ? typed.value : null;
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const start = () => {
    if (!editable) return;
    setDraft(rawValue === null ? "" : String(rawValue));
    setError(null);
    setEditing(true);
  };

  const commit = async () => {
    const trimmed = draft.replace(/[$,%\s]/g, "");
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError(unit === "percent" ? "Enter a percentage, like 5" : "Enter an amount, like 1500");
      return;
    }
    if (unit === "percent" && value === null) { setError("Enter a percentage, like 5"); return; }
    if (value === rawValue) { setEditing(false); return; }
    setEditing(false);
    setTyped({ value: value === null ? "Not set" : unit === "percent" ? `${value}%` : `$${value.toLocaleString("en-US")}`, basis: display });
    try {
      await onSave(value);
    } catch (e) {
      setTyped(null);
      setError(e instanceof Error ? e.message : "Could not save");
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3" title={editing ? undefined : hint}>
      <span className="flex items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {edited && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary"
            title={`Edited by ${edited.byName}, ${shortDate(edited.at)}`}
            aria-label={`Edited by ${edited.byName}, ${shortDate(edited.at)}`}
          />
        )}
      </span>

      {editing ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1 rounded-[7px] border border-border bg-background px-2 focus-within:ring-2 focus-within:ring-ring/30">
            {unit === "dollars" && <span className="text-[15px] text-muted-foreground">$</span>}
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void commit(); }
                if (e.key === "Escape") { e.preventDefault(); setEditing(false); setError(null); }
              }}
              onBlur={() => void commit()}
              inputMode="decimal"
              aria-label={`${label} for ${monthName}`}
              className="h-8 w-full min-w-0 bg-transparent text-[16px] font-medium tabular-nums text-foreground outline-none"
            />
            {unit === "percent" && <span className="text-[15px] text-muted-foreground">%</span>}
          </div>
          <span className="text-[11px] text-muted-foreground">Applies to {monthName} only</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={!editable}
          aria-label={editable ? `Edit ${label} for ${monthName}` : undefined}
          className={cn(
            "group -mx-1 flex min-w-0 items-center gap-1.5 rounded-[6px] px-1 text-left",
            editable ? "cursor-text hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" : "cursor-default",
          )}
        >
          <span className={cn("truncate text-[17px] font-medium tabular-nums text-foreground", (muted && !optimistic) && "text-muted-foreground")}>
            {optimistic ?? display}
          </span>
          {editable && <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
        </button>
      )}

      {emphasis && !editing && <span className="truncate text-[12px] tabular-nums text-muted-foreground">{emphasis}</span>}
      {error && <span role="alert" className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}
