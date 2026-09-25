"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, CalendarPlus, Copy, Send, Check, Loader2, CalendarClock } from "lucide-react";
import { Button } from "@/components/untitled/base/buttons/button";
import { cn } from "@/lib/utils/cn";

/**
 * Send a prospect a booking link, and record who sent it.
 *
 * WHY IT MINTS OUR OWN LINK INSTEAD OF SHOWING THE GOHIGHLEVEL ONE
 * GoHighLevel gives one shared URL per calendar with nothing to say who sent it. Measured
 * 2026-09-22: 68% of appointments are created by the prospect off a link, so there is no user
 * recorded against them and a setter's booked call cannot be credited. A link minted here is
 * unique per send, so the booking that follows belongs to whoever did the work.
 *
 * The raw GoHighLevel URL is NEVER shown. If a rep pastes that out of habit we are blind
 * again, so the tracked link has to be the easiest thing in reach — which is why Copy sits
 * right next to Send rather than behind a menu.
 */
interface Channel { type: string; label: string; conversationId?: string }

export function BookingLinkModal({
  contactId,
  contactName,
  contactPhone,
  contactEmail,
  threadChannel,
  conversationId,
  onClose,
  onSent,
}: {
  contactId: string;
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  /** The channel of the conversation this was opened from, e.g. TYPE_INSTAGRAM. */
  threadChannel?: string | null;
  conversationId?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [calendarId, setCalendarId] = useState("");
  const [channel, setChannel] = useState<string>("");
  const [message, setMessage] = useState(
    `Hi ${contactName.split(" ")[0] || "there"}, here's my calendar — grab whichever time suits you:`,
  );
  const [busy, setBusy] = useState<"send" | "copy" | "book" | null>(null);
  const [done, setDone] = useState<"sent" | "copied" | "booked" | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Two moments, two paths.
   *
   * "book" is for when the prospect is ON THE PHONE: closing the time while you have their
   * attention beats handing them homework, and Kelsey is predominantly outbound calls.
   * "link" is for async — a DM or a follow-up, where negotiating a time takes six messages
   * and a slot they chose themselves shows up better.
   */
  const [mode, setMode] = useState<"book" | "link">("book");
  const [slot, setSlot] = useState<string>("");

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data: slotData, isFetching: loadingSlots, isError: slotsError } = useQuery<{ days: Array<{ date: string; slots: string[] }>; timezone: string }>({
    queryKey: ["booking-slots", calendarId, tz],
    queryFn: async () => {
      const r = await fetch(`/api/booking-links/slots?calendarId=${calendarId}&timezone=${encodeURIComponent(tz)}`);
      if (!r.ok) throw new Error("slots");
      return r.json();
    },
    enabled: mode === "book" && !!calendarId,
    // Availability moves by the minute; a stale slot means a double booking.
    staleTime: 30_000,
  });
  const days = useMemo(() => slotData?.days ?? [], [slotData]);
  const [openDay, setOpenDay] = useState<string>("");
  useEffect(() => {
    if (days.length && !days.some((d) => d.date === openDay)) setOpenDay(days[0].date);
  }, [days, openDay]);
  useEffect(() => { setSlot(""); }, [calendarId, openDay]);

  async function book() {
    if (busy || !slot) return;
    setBusy("book"); setError(null);
    try {
      const res = await fetch("/api/booking-links/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, contactName, calendarId, startTime: slot, timezone: tz }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error ?? "Could not book that slot"); return; }
      setDone("booked");
      onSent?.();
      setTimeout(onClose, 1600);
    } catch {
      setError("Could not book that slot");
    } finally { setBusy(null); }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const fmtDay = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const { data: calData, isLoading: loadingCals } = useQuery<{ calendars: Array<{ id: string; name: string; recentBookings: number }> }>({
    queryKey: ["booking-calendars"],
    queryFn: async () => {
      const r = await fetch("/api/booking-links/calendars");
      if (!r.ok) throw new Error("calendars");
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
  });
  const calendars = useMemo(() => calData?.calendars ?? [], [calData]);
  useEffect(() => {
    if (!calendarId && calendars.length) setCalendarId(calendars[0].id);
  }, [calendars, calendarId]);

  /**
   * Only channels that can actually reach this person.
   *
   * SMS and Email need a number and an address. Instagram and Messenger cannot be started
   * cold — you may only reply inside a thread the person opened — so they appear only when
   * this WAS that thread. Offering a channel that is going to fail is worse than not offering
   * it, because the failure lands after the rep thinks the job is done.
   */
  const channels = useMemo<Channel[]>(() => {
    const out: Channel[] = [];
    if (threadChannel && conversationId) {
      const label =
        threadChannel === "TYPE_INSTAGRAM" ? "Instagram"
        : threadChannel === "TYPE_FB" ? "Messenger"
        : threadChannel === "TYPE_EMAIL" ? "Email"
        : "SMS";
      out.push({ type: threadChannel, label: `${label} (this thread)`, conversationId });
    }
    if (contactPhone && !out.some((c) => c.type === "TYPE_SMS")) out.push({ type: "TYPE_SMS", label: "SMS" });
    if (contactEmail && !out.some((c) => c.type === "TYPE_EMAIL")) out.push({ type: "TYPE_EMAIL", label: "Email" });
    return out;
  }, [threadChannel, conversationId, contactPhone, contactEmail]);

  useEffect(() => {
    if (!channel && channels.length) setChannel(channels[0].type);
  }, [channels, channel]);

  async function submit(delivery: "sent" | "copied") {
    if (busy) return;
    setBusy(delivery === "sent" ? "send" : "copy");
    setError(null);
    try {
      const target = channels.find((c) => c.type === channel);
      const res = await fetch("/api/booking-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          contactName,
          calendarId,
          delivery,
          message: delivery === "sent" ? message : undefined,
          targets: delivery === "sent" && target ? [{ type: target.type, conversationId: target.conversationId }] : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error ?? "Could not create the link"); return; }

      if (delivery === "copied") {
        await navigator.clipboard.writeText(data.url).catch(() => {});
        setDone("copied");
      } else {
        setDone("sent");
        onSent?.();
        setTimeout(onClose, 1200);
      }
    } catch {
      setError("Could not create the link");
    } finally {
      setBusy(null);
    }
  }

  const canSend = !!calendarId && !!channel && !!message.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--overlay)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send a booking link"
        className="w-full max-w-md overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_24px_60px_-20px_rgba(28,35,51,0.4)]"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            <CalendarPlus className="h-4 w-4" /> Send a booking link
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Calendar</label>
            {loadingCals ? (
              <div className="flex items-center gap-2 py-2 text-[13px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading calendars…
              </div>
            ) : (
              <select
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                className="w-full rounded-[7px] border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.recentBookings > 0 ? ` — ${c.recentBookings} booked recently` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Two moments. Booking is first because it is the stronger move when the prospect
              is on the phone, which is where a setter spends most of their day. */}
          <div className="inline-flex w-full rounded-[9px] border border-border bg-muted/40 p-0.5">
            {([
              { key: "book", label: "Book a time" },
              { key: "link", label: "Send a link" },
            ] as const).map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => { setMode(o.key); setError(null); }}
                className={cn(
                  "flex-1 rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold transition-all",
                  mode === o.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {mode === "book" ? (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pick a time
              </label>
              {loadingSlots ? (
                <div className="flex items-center gap-2 py-3 text-[13px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the calendar…
                </div>
              ) : slotsError ? (
                <p className="rounded-[7px] border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-destructive">
                  Could not read availability. Try the link instead.
                </p>
              ) : days.length === 0 ? (
                <p className="rounded-[7px] border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
                  No open slots on this calendar in the next two weeks.
                </p>
              ) : (
                <>
                  {/* Days across, times below: the shape of the decision, not a dropdown of 200 */}
                  <div className="-mx-0.5 mb-2 flex gap-1.5 overflow-x-auto pb-1">
                    {days.map((d) => (
                      <button
                        key={d.date}
                        type="button"
                        onClick={() => setOpenDay(d.date)}
                        className={cn(
                          "shrink-0 rounded-[8px] border px-2.5 py-1.5 text-[12px] font-medium transition-all",
                          openDay === d.date
                            ? "border-primary/50 bg-primary/5 text-foreground"
                            : "border-border text-muted-foreground hover:bg-muted/50",
                        )}
                      >
                        {fmtDay(d.date)}
                        <span className="ml-1.5 text-[10px] text-muted-foreground/70">{d.slots.length}</span>
                      </button>
                    ))}
                  </div>
                  <div className="grid max-h-[148px] grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4">
                    {(days.find((d) => d.date === openDay)?.slots ?? []).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setSlot(t)}
                        className={cn(
                          "rounded-[7px] border px-2 py-1.5 text-[12px] font-medium tabular-nums transition-all",
                          slot === t
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-foreground hover:bg-muted/50",
                        )}
                      >
                        {fmtTime(t)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {`Times shown in your timezone. ${contactName.split(" ")[0]} gets GoHighLevel's confirmation and reminders.`}
                  </p>
                </>
              )}
            </div>
          ) : (
          <>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Send on</label>
            {channels.length === 0 ? (
              // Honest rather than broken: say why, and leave Copy available.
              <p className="rounded-[7px] border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
                No phone, email or open conversation for {contactName.split(" ")[0]}. Copy the link and send it yourself.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {channels.map((c) => (
                  <button
                    key={c.type}
                    type="button"
                    onClick={() => setChannel(c.type)}
                    className={cn(
                      "rounded-[7px] border px-3 py-2 text-xs font-medium transition-all",
                      channel === c.type ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-[7px] border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Your tracked link is added at the end, so the booking is credited to you.
            </p>
          </div>
          </>
          )}

          {error && <p className="text-[12.5px] text-destructive">{error}</p>}
          {done === "copied" && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-success">
              <Check className="h-3.5 w-3.5" /> Link copied. It still credits you when they book.
            </p>
          )}
          {done === "sent" && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-success">
              <Check className="h-3.5 w-3.5" /> Sent to {contactName.split(" ")[0]}.
            </p>
          )}
          {done === "booked" && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-success">
              <Check className="h-3.5 w-3.5" />
              Booked {slot ? `${fmtDay(slot.slice(0, 10))} at ${fmtTime(slot)}` : ""}. It is in the calendar and credited to you.
            </p>
          )}
        </div>

        <div className={cn(
          "flex items-center gap-2 border-t border-border px-5 py-3.5",
          mode === "link" ? "justify-between" : "justify-end",
        )}>
          {mode === "link" ? (
            <button
              onClick={() => submit("copied")}
              disabled={!calendarId || !!busy}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              {busy === "copy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
              Copy link
            </button>
          ) : null}
          <div className="flex items-center gap-2">
            <Button color="secondary" size="sm" onClick={onClose}>Cancel</Button>
            {mode === "book" ? (
              <Button
                color="primary"
                size="sm"
                onClick={book}
                isDisabled={!slot || !!busy}
                isLoading={busy === "book"}
                showTextWhileLoading
                iconLeading={CalendarClock}
              >
                {slot ? `Book ${fmtTime(slot)}` : "Pick a time"}
              </Button>
            ) : (
              <Button
                color="primary"
                size="sm"
                onClick={() => submit("sent")}
                isDisabled={!canSend || !!busy}
                isLoading={busy === "send"}
                showTextWhileLoading
                iconLeading={Send}
              >
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
