"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addMinutes, parseISO } from "date-fns";
import { X, Phone, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  name: string;
  email: string;
  ghlUserId: string | null;
  color: string;
}

interface ContactResult {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface GhlCalendarOption {
  id: string;
  name: string;
}

interface BusyBlock {
  start: string;
  end: string;
}

interface BookCallDrawerProps {
  open: boolean;
  onClose: () => void;
  onBooked?: () => void;
  initialDate?: string;      // "yyyy-MM-dd"
  initialStartTime?: string; // "HH:mm"
}

interface FormState {
  contactId: string;
  contactName: string;
  contactEmail: string;
  repEmail: string;
  callType: "meet" | "dialer";
  ghlCalendarId: string;
  date: string;       // "yyyy-MM-dd"
  startTime: string;  // "HH:mm"
  endTime: string;    // "HH:mm"
  notes: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr(tz: string): string {
  return format(toZonedDate(new Date(), tz), "yyyy-MM-dd");
}

function defaultEndTime(startTime: string): string {
  try {
    const [h, m] = startTime.split(":").map(Number);
    const base = new Date(2000, 0, 1, h, m);
    return format(addMinutes(base, 30), "HH:mm");
  } catch {
    return startTime;
  }
}

function buildISODateTime(date: string, time: string): string {
  // Returns ISO 8601 string like "2026-05-07T14:00:00"
  return `${date}T${time}:00`;
}

// ─── Conflict helpers ─────────────────────────────────────────────────────────

const TIMELINE_START_HOUR = 8;
const TIMELINE_END_HOUR = 18;
const TIMELINE_SPAN = TIMELINE_END_HOUR - TIMELINE_START_HOUR; // 10 hours

/** Convert "HH:mm" to fractional hours. */
function timeToHours(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h + m / 60;
}

/** Convert an ISO datetime string to fractional hours. */
function isoToHours(iso: string): number {
  const d = parseISO(iso);
  return d.getHours() + d.getMinutes() / 60;
}

/** Convert fractional hours to a % offset within the 8am-6pm window. */
function hoursToPercent(hours: number): number {
  return Math.max(0, Math.min(100, ((hours - TIMELINE_START_HOUR) / TIMELINE_SPAN) * 100));
}

function ConflictTimeline({
  busyBlocks,
  startTime,
  endTime,
}: {
  busyBlocks: BusyBlock[];
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
}) {
  const selStart = hoursToPercent(timeToHours(startTime));
  const selEnd = hoursToPercent(timeToHours(endTime));
  const selWidth = Math.max(selEnd - selStart, 1);

  // Check if selected window overlaps any busy block
  const selStartH = timeToHours(startTime);
  const selEndH = timeToHours(endTime);
  const hasOverlap = busyBlocks.some((b) => {
    const bStart = isoToHours(b.start);
    const bEnd = isoToHours(b.end);
    return bStart < selEndH && bEnd > selStartH;
  });

  return (
    <div className="space-y-2">
      {/* Timeline bar */}
      <div className="relative w-full h-6 bg-muted/40 rounded-[6px] border border-border overflow-hidden">
        {/* Busy blocks */}
        {busyBlocks.map((b, i) => {
          const left = hoursToPercent(isoToHours(b.start));
          const right = hoursToPercent(isoToHours(b.end));
          const width = Math.max(right - left, 0.5);
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 bg-rose-400/50 rounded-[2px]"
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          );
        })}
        {/* Selected time window */}
        <div
          className="absolute top-0 bottom-0 bg-primary/60 rounded-[2px] border border-primary/80"
          style={{ left: `${selStart}%`, width: `${selWidth}%` }}
        />
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
        <span>8 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
      </div>

      {/* Status */}
      {hasOverlap ? (
        <div className="flex items-center gap-1.5 text-xs text-amber-600">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Conflicts with existing events</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-emerald-600">
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span>No conflicts</span>
        </div>
      )}
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

const INPUT_CLS =
  "w-full px-3 py-2 text-sm border border-border rounded-[8px] bg-card placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/40 transition-all";

const SELECT_CLS =
  "w-full px-3 py-2 text-sm border border-border rounded-[8px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/40 transition-all appearance-none";

// ─── Contact search ───────────────────────────────────────────────────────────

function ContactSearch({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (c: ContactResult) => void;
}) {
  const [query, setQuery]           = useState(value);
  const [debounced, setDebounced]   = useState("");
  const [open, setOpen]             = useState(false);
  const containerRef                = useRef<HTMLDivElement>(null);

  // Update display if parent clears
  useEffect(() => {
    if (!value) setQuery("");
  }, [value]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isLoading } = useQuery<{ contacts: ContactResult[] }>({
    queryKey: ["contact-search", debounced],
    queryFn: () =>
      fetch(`/api/ghl/contacts/search?q=${encodeURIComponent(debounced)}`).then((r) => r.json()),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const results = data?.contacts ?? [];

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(c: ContactResult) {
    setQuery(c.name);
    setOpen(false);
    onSelect(c);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => query.length >= 2 && setOpen(true)}
        placeholder="Search contacts…"
        className={INPUT_CLS}
        autoComplete="off"
      />
      {open && debounced.length >= 2 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-border rounded-[8px] shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {isLoading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No results found</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
              >
                <p className="font-medium text-foreground">{c.name}</p>
                {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function BookCallDrawer({ open, onClose, onBooked, initialDate, initialStartTime }: BookCallDrawerProps) {
  const tz = useUserTimezone();
  const [form, setForm]       = useState<FormState>({
    contactId:    "",
    contactName:  "",
    contactEmail: "",
    repEmail:     "",
    callType:     "meet",
    ghlCalendarId: "",
    date:          initialDate ?? todayStr(tz),
    startTime:     initialStartTime ?? "09:00",
    endTime:       defaultEndTime(initialStartTime ?? "09:00"),
    notes:         "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  // ── Team members ──────────────────────────────────────────────────────────
  const { data: teamData } = useQuery<{ members: TeamMember[] }>({
    queryKey: ["calendar-team"],
    queryFn: () => fetch("/api/calendar/team").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });

  const teamMembers = teamData?.members ?? [];

  // ── GHL calendars (for dropdown) ──────────────────────────────────────
  const { data: ghlCalData, isLoading: ghlCalendarsLoading } = useQuery<{
    calendars: GhlCalendarOption[];
  }>({
    queryKey: ["ghl-calendars"],
    queryFn: () => fetch("/api/calendar/ghl-calendars").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });

  const ghlCalendars = ghlCalData?.calendars ?? [];

  // ── Conflict detection ────────────────────────────────────────────────
  const conflictsEnabled = !!form.repEmail && !!form.date;
  const { data: conflictData } = useQuery<{ busyBlocks: BusyBlock[] }>({
    queryKey: ["conflicts", form.repEmail, form.date],
    queryFn: () => {
      const since = `${form.date}T00:00:00`;
      const until = `${form.date}T23:59:59`;
      return fetch(
        `/api/calendar/conflicts?repEmail=${encodeURIComponent(form.repEmail)}&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`
      ).then((r) => r.json());
    },
    enabled: conflictsEnabled,
    staleTime: 30_000,
  });

  const busyBlocks = conflictData?.busyBlocks ?? [];

  // Seed first rep when members load
  useEffect(() => {
    if (teamMembers.length > 0 && !form.repEmail) {
      const first = teamMembers[0];
      setForm((f) => ({
        ...f,
        repEmail: first.email,
      }));
    }
  }, [teamMembers]); // eslint-disable-line react-hooks/exhaustive-deps

  // When rep changes, update email
  function handleRepChange(email: string) {
    setForm((f) => ({
      ...f,
      repEmail: email,
    }));
  }

  // Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Reset form when drawer opens
  useEffect(() => {
    if (open) {
      setSuccess(false);
      setError(null);
      const date = initialDate ?? todayStr(tz);
      const startTime = initialStartTime ?? "09:00";
      setForm((f) => ({
        ...f,
        date,
        startTime,
        endTime: defaultEndTime(startTime),
      }));
    }
  }, [open, initialDate, initialStartTime]);

  const handleContactSelect = useCallback((c: ContactResult) => {
    setForm((f) => ({
      ...f,
      contactId:    c.id,
      contactName:  c.name,
      contactEmail: c.email ?? "",
    }));
  }, []);

  function handleStartTimeChange(val: string) {
    setForm((f) => ({
      ...f,
      startTime: val,
      endTime:   defaultEndTime(val),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.contactId || !form.repEmail || !form.ghlCalendarId) {
      setError("Please fill in all required fields.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/calendar/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId:     form.contactId,
          contactName:   form.contactName,
          repEmail:      form.repEmail,
          callType:      form.callType,
          startTime:     buildISODateTime(form.date, form.startTime),
          endTime:       buildISODateTime(form.date, form.endTime),
          notes:         form.notes || undefined,
          ghlCalendarId: form.ghlCalendarId,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server error ${res.status}`);
      }

      setSuccess(true);
      setTimeout(() => {
        onBooked?.();
        onClose();
      }, 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Book a call"
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-[420px] max-w-[90vw]",
          "bg-card border-l border-border shadow-xl flex flex-col",
          "transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <p
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Book a Call
          </p>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          {success ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <Phone className="w-5 h-5 text-emerald-600" />
              </div>
              <p className="text-sm font-semibold text-foreground">Call booked!</p>
              <p className="text-xs text-muted-foreground">
                Appointment created for {form.contactName}.
              </p>
            </div>
          ) : (
            <form id="book-call-form" onSubmit={handleSubmit} className="space-y-4">

              {/* Contact search */}
              <Field label="Contact *">
                <ContactSearch
                  value={form.contactName}
                  onSelect={handleContactSelect}
                />
              </Field>

              {/* Rep */}
              <Field label="Rep *">
                <select
                  value={form.repEmail}
                  onChange={(e) => handleRepChange(e.target.value)}
                  className={SELECT_CLS}
                  required
                >
                  <option value="" disabled>Select a rep…</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.email}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Call type — Google Meet checkbox */}
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <span
                  className={cn(
                    "flex items-center justify-center w-[18px] h-[18px] rounded-[4px] border transition-all shrink-0",
                    form.callType === "meet"
                      ? "bg-primary border-primary"
                      : "border-border bg-card group-hover:border-primary/40"
                  )}
                >
                  {form.callType === "meet" && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
                </span>
                <input
                  type="checkbox"
                  checked={form.callType === "meet"}
                  onChange={(e) => set("callType", e.target.checked ? "meet" : "dialer")}
                  className="sr-only"
                />
                <span className="text-sm text-foreground">Create Google Meet link</span>
              </label>

              {/* GHL Calendar */}
              <Field label="GHL Calendar *">
                <select
                  value={form.ghlCalendarId}
                  onChange={(e) => set("ghlCalendarId", e.target.value)}
                  className={SELECT_CLS}
                  required
                >
                  <option value="" disabled>
                    {ghlCalendarsLoading ? "Loading calendars…" : "Select a calendar…"}
                  </option>
                  {ghlCalendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.name}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Date */}
              <Field label="Date *">
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                  className={INPUT_CLS}
                  required
                />
              </Field>

              {/* Start / End time */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start Time *">
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                    className={INPUT_CLS}
                    required
                  />
                </Field>
                <Field label="End Time *">
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => set("endTime", e.target.value)}
                    className={INPUT_CLS}
                    required
                  />
                </Field>
              </div>

              {/* Conflict preview */}
              {conflictsEnabled && (
                <ConflictTimeline
                  busyBlocks={busyBlocks}
                  startTime={form.startTime}
                  endTime={form.endTime}
                />
              )}

              {/* Notes */}
              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Optional notes…"
                  rows={3}
                  className={cn(INPUT_CLS, "resize-none")}
                />
              </Field>

              {/* Error */}
              {error && (
                <div className="px-3 py-2.5 rounded-[8px] bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  {error}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="px-5 py-4 border-t border-border shrink-0">
            <button
              type="submit"
              form="book-call-form"
              disabled={loading || !form.contactId}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-[8px] text-sm font-medium transition-all",
                loading || !form.contactId
                  ? "bg-primary/40 text-primary-foreground/60 cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Booking…
                </>
              ) : (
                "Book Call"
              )}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
