"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addMinutes, parseISO } from "date-fns";
import { X, Video, Phone } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserCalendar {
  id: string;
  repName: string;
  repEmail: string;
  ghlCalendarId: string | null;
  color: string;
  isActive: boolean;
}

interface ContactResult {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface BookCallDrawerProps {
  open: boolean;
  onClose: () => void;
  onBooked?: () => void;
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

function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
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

export function BookCallDrawer({ open, onClose, onBooked }: BookCallDrawerProps) {
  const [form, setForm]       = useState<FormState>({
    contactId:    "",
    contactName:  "",
    contactEmail: "",
    repEmail:     "",
    callType:     "meet",
    ghlCalendarId: "",
    date:          todayStr(),
    startTime:     "09:00",
    endTime:       "09:30",
    notes:         "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  // ── User calendars ────────────────────────────────────────────────────────
  const { data: calData } = useQuery<{ userCalendars: UserCalendar[] }>({
    queryKey: ["user-calendars"],
    queryFn: () => fetch("/api/settings/user-calendars").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });

  const userCalendars = calData?.userCalendars?.filter((c) => c.isActive) ?? [];

  // Seed first rep when calendars load
  useEffect(() => {
    if (userCalendars.length > 0 && !form.repEmail) {
      const first = userCalendars[0];
      setForm((f) => ({
        ...f,
        repEmail:      first.repEmail,
        ghlCalendarId: first.ghlCalendarId ?? "",
      }));
    }
  }, [userCalendars]); // eslint-disable-line react-hooks/exhaustive-deps

  // When rep changes, update ghlCalendarId to that rep's calendar
  function handleRepChange(email: string) {
    const cal = userCalendars.find((c) => c.repEmail === email);
    setForm((f) => ({
      ...f,
      repEmail:      email,
      ghlCalendarId: cal?.ghlCalendarId ?? "",
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
    }
  }, [open]);

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
                Confirmation sent to {form.contactName}.
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
                  {userCalendars.map((uc) => (
                    <option key={uc.repEmail} value={uc.repEmail}>
                      {uc.repName}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Call type */}
              <Field label="Call Type">
                <div className="flex gap-2">
                  {(["meet", "dialer"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set("callType", t)}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-[8px] text-sm font-medium border transition-all",
                        form.callType === t
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      {t === "meet" ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                      {t === "meet" ? "Google Meet" : "Dialer"}
                    </button>
                  ))}
                </div>
              </Field>

              {/* GHL Calendar */}
              <Field label="GHL Calendar *">
                <input
                  value={form.ghlCalendarId}
                  onChange={(e) => set("ghlCalendarId", e.target.value)}
                  placeholder="GHL Calendar ID…"
                  className={INPUT_CLS}
                  required
                />
                {userCalendars.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Auto-filled from rep settings. Edit if needed.
                  </p>
                )}
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
