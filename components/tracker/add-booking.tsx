"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils/cn";
import { shortDateTime, shortDate, useTrackerAction } from "@/components/tracker/tracker-api";

/**
 * Add a booking the system missed. Two steps: who, then which call.
 *
 * The real appointment is always offered first. Claiming it (rather than typing a date) is what
 * lets a later cancellation or no-show follow the row, so the typed fallback only appears when
 * GoHighLevel has no appointment for that person at all. The server enforces the same rule.
 */

interface Contact { id: string; name: string; email: string | null }
interface Appt { id: string; calendarName: string | null; startTime: string; dateAdded: string | null; status: string }

export function AddBooking({ setterUserId, onClose }: { setterUserId: string; onClose: () => void }) {
  const action = useTrackerAction();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const [appts, setAppts] = useState<Appt[] | null>(null);
  const [manual, setManual] = useState({ company: "", callAt: "", bookedAt: "" });
  const [error, setError] = useState<string | null>(null);

  // Debounced search against the same contact search the rest of the app uses.
  useEffect(() => {
    if (contact || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/ghl/contacts/search?q=${encodeURIComponent(q.trim())}`);
        const json = await res.json();
        setResults(Array.isArray(json.contacts) ? json.contacts : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, contact]);

  useEffect(() => {
    if (!contact) { setAppts(null); return; }
    fetch(`/api/tracker/appointments?contactId=${encodeURIComponent(contact.id)}`)
      .then((r) => r.json())
      .then((j) => setAppts(Array.isArray(j.appointments) ? j.appointments : []))
      .catch(() => setAppts([]));
  }, [contact]);

  const claim = async (appointmentId: string) => {
    setError(null);
    try {
      await action.mutateAsync({ action: "manual", setterUserId, appointmentId, contactId: contact!.id, contactName: contact!.name, callAt: "" });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add it"); }
  };

  const addTyped = async () => {
    setError(null);
    if (!manual.callAt) { setError("When was the call?"); return; }
    try {
      await action.mutateAsync({
        action: "manual", setterUserId, contactId: contact?.id ?? null, contactName: contact?.name ?? q.trim(),
        companyName: manual.company || null,
        callAt: new Date(`${manual.callAt}T12:00:00-05:00`).toISOString(),
        bookedAt: manual.bookedAt ? new Date(`${manual.bookedAt}T12:00:00-05:00`).toISOString() : null,
      });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add it"); }
  };

  const input = "h-8 w-full rounded-[7px] border border-border bg-background px-2.5 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring/30";
  const live = appts?.filter((a) => a.status !== "deleted") ?? [];

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} label="Add a booking" size="max-w-md" showClose>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Add a booking</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">For a call you booked that is not on your sheet. It counts straight away, marked as added by you.</p>
        </div>

        {!contact ? (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 rounded-[7px] border border-border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring/30">
              <Search className="size-3.5 text-muted-foreground" aria-hidden />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, email or company"
                aria-label="Search contacts" className="h-8 w-full bg-transparent text-[13px] outline-none" />
            </label>
            {searching && <p className="text-[12px] text-muted-foreground">Searching…</p>}
            {!searching && q.trim().length >= 2 && results.length === 0 && (
              <p className="text-[12px] text-muted-foreground">No contact matches “{q.trim()}”.</p>
            )}
            <ul className="flex max-h-60 flex-col overflow-y-auto">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setContact(c)}
                    className="flex w-full flex-col rounded-[6px] px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                    <span className="truncate text-[13px] font-medium text-foreground">{c.name}</span>
                    {c.email && <span className="truncate text-[11px] text-muted-foreground">{c.email}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 rounded-[8px] bg-muted/60 px-3 py-2">
              <span className="truncate text-[13px] font-medium text-foreground">{contact.name}</span>
              <button type="button" onClick={() => { setContact(null); setError(null); }} className="text-[12px] font-medium text-primary hover:underline">Change</button>
            </div>

            {appts === null ? (
              <p className="text-[12px] text-muted-foreground">Looking for their calls…</p>
            ) : live.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-muted-foreground">Which call did you book?</span>
                {live.map((a) => (
                  <button key={a.id} type="button" onClick={() => claim(a.id)} disabled={action.isPending}
                    className={cn("flex items-center justify-between gap-3 rounded-[8px] border border-border px-3 py-2 text-left hover:bg-muted disabled:opacity-60",
                      a.status === "cancelled" && "opacity-70")}>
                    <span className="flex flex-col">
                      <span className="text-[13px] font-medium tabular-nums text-foreground">{shortDateTime(a.startTime)}</span>
                      <span className="text-[11px] text-muted-foreground">{a.calendarName ?? "Calendar"}{a.dateAdded ? ` · booked ${shortDate(a.dateAdded)}` : ""}</span>
                    </span>
                    {a.status === "cancelled" && <span className="text-[11px] text-muted-foreground">Cancelled</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <p className="text-[12px] text-muted-foreground">GoHighLevel has no call for {contact.name}. Enter it here.</p>
                <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">Company
                  <input className={input} value={manual.company} onChange={(e) => setManual((m) => ({ ...m, company: e.target.value }))} maxLength={200} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">Call date
                    <input type="date" className={input} value={manual.callAt} onChange={(e) => setManual((m) => ({ ...m, callAt: e.target.value }))} />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">Booked on
                    <input type="date" className={input} value={manual.bookedAt} onChange={(e) => setManual((m) => ({ ...m, bookedAt: e.target.value }))} />
                  </label>
                </div>
                <button type="button" onClick={addTyped} disabled={action.isPending}
                  className="h-8 self-end rounded-[7px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                  {action.isPending ? "Adding…" : "Add booking"}
                </button>
              </div>
            )}
          </div>
        )}

        {error && <p role="alert" className="text-[12px] text-destructive">{error}</p>}
        <p className="text-[11px] text-muted-foreground">It lands on the month of the call. If someone else also claims it, both of you see it flagged until an admin decides.</p>
      </div>
    </Modal>
  );
}
