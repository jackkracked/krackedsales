"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, RefreshCw, Trash2, Plus, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface UserCalendar {
  id: string;
  repName: string;
  repEmail: string;
  ghlCalendarId: string | null;
  conflictCalendarId: string;
  color: string;
  isActive: boolean;
}

async function fetchUserCalendars(): Promise<UserCalendar[]> {
  const res = await fetch("/api/settings/user-calendars");
  if (!res.ok) throw new Error("Failed to load calendars");
  const data = await res.json();
  return data.userCalendars;
}

async function updateUserCalendarField(
  id: string,
  field: string,
  value: string
): Promise<void> {
  const res = await fetch(`/api/settings/user-calendars/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [field]: value }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to update calendar");
  }
}

async function createUserCalendar(payload: {
  repName: string;
  repEmail: string;
  ghlCalendarId: string;
  color: string;
  conflictCalendarId: string;
}): Promise<UserCalendar> {
  const res = await fetch("/api/settings/user-calendars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to create calendar");
  return data.userCalendar;
}

async function deleteUserCalendar(id: string): Promise<void> {
  const res = await fetch(`/api/settings/user-calendars/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to delete calendar");
  }
}

async function toggleUserCalendar(id: string, isActive: boolean): Promise<void> {
  const res = await fetch(`/api/settings/user-calendars/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to update calendar");
  }
}

const INPUT_CLASS = cn(
  "w-full rounded-[6px] border border-border bg-background px-3 py-2",
  "text-sm text-foreground placeholder:text-muted-foreground",
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
  "transition-colors"
);

export function UserCalendarsSettings() {
  const queryClient = useQueryClient();

  const { data: calendars = [], isLoading } = useQuery<UserCalendar[]>({
    queryKey: ["user-calendars"],
    queryFn: fetchUserCalendars,
  });

  const [repName, setRepName] = useState("");
  const [repEmail, setRepEmail] = useState("");
  const [ghlCalendarId, setGhlCalendarId] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [conflictCalId, setConflictCalId] = useState("primary");
  const [addSuccess, setAddSuccess] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["user-calendars"] });

  const createMutation = useMutation({
    mutationFn: createUserCalendar,
    onSuccess: () => {
      invalidate();
      setRepName("");
      setRepEmail("");
      setGhlCalendarId("");
      setColor("#6366f1");
      setConflictCalId("primary");
      setAddSuccess(true);
      setTimeout(() => setAddSuccess(false), 3000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUserCalendar,
    onSuccess: invalidate,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      toggleUserCalendar(id, isActive),
    onSuccess: invalidate,
  });

  const updateFieldMutation = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: string; value: string }) =>
      updateUserCalendarField(id, field, value),
    onSuccess: invalidate,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({ repName, repEmail, ghlCalendarId, color, conflictCalendarId: conflictCalId });
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete calendar for ${name}? This cannot be undone.`)) return;
    deleteMutation.mutate(id);
  }

  const canSubmit = repName.trim() && repEmail.trim() && ghlCalendarId.trim();

  return (
    <div className="bg-card border border-border rounded-[10px] p-5" data-r10n-settings-card>
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="w-4 h-4 text-muted-foreground" data-r10n-settings-cardicon />
        <h2
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
          data-r10n-settings-cardtitle
        >
          Team Calendars
        </h2>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Link each rep&apos;s Google Workspace email to their GHL calendar.
      </p>

      {/* Existing rows */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-5">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Loading…
        </div>
      ) : calendars.length > 0 ? (
        <div className="mb-5 rounded-[8px] border border-border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_1fr_minmax(120px,0.7fr)_auto_auto_auto] items-center gap-3 px-3.5 py-2 border-b border-border bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">Rep Name</span>
            <span className="text-xs font-medium text-muted-foreground">Email</span>
            <span className="text-xs font-medium text-muted-foreground">GHL Calendar ID</span>
            <span className="text-xs font-medium text-muted-foreground" title="Google Calendar ID to check for scheduling conflicts">Conflict Cal</span>
            <span className="text-xs font-medium text-muted-foreground">Color</span>
            <span className="text-xs font-medium text-muted-foreground">Active</span>
            <span className="w-7" />
          </div>

          {/* Table rows */}
          {calendars.map((cal, i) => (
            <div
              key={cal.id}
              className={cn(
                "grid grid-cols-[1fr_1fr_1fr_minmax(120px,0.7fr)_auto_auto_auto] items-center gap-3 px-3.5 py-2.5",
                i < calendars.length - 1 && "border-b border-border"
              )}
            >
              <span className="text-sm font-medium text-foreground truncate">{cal.repName}</span>
              <span className="text-sm text-muted-foreground truncate">{cal.repEmail}</span>
              <span className="text-xs text-muted-foreground font-mono truncate">
                {cal.ghlCalendarId ?? "—"}
              </span>

              {/* Conflict calendar inline edit */}
              <input
                type="text"
                defaultValue={cal.conflictCalendarId ?? "primary"}
                onBlur={(e) => {
                  const newVal = e.target.value.trim() || "primary";
                  if (newVal !== (cal.conflictCalendarId ?? "primary")) {
                    updateFieldMutation.mutate({ id: cal.id, field: "conflictCalendarId", value: newVal });
                  }
                }}
                title="Google Calendar ID to check for scheduling conflicts"
                className="text-xs font-mono text-muted-foreground bg-transparent border border-transparent hover:border-border focus:border-primary focus:bg-background rounded px-1.5 py-1 transition-colors focus:outline-none focus:ring-1 focus:ring-primary/30 truncate"
              />

              {/* Color swatch */}
              <span
                className="w-5 h-5 rounded-full border border-border flex-shrink-0"
                style={{ backgroundColor: cal.color }}
              />

              {/* Active toggle */}
              <button
                type="button"
                onClick={() => toggleMutation.mutate({ id: cal.id, isActive: !cal.isActive })}
                disabled={toggleMutation.isPending}
                data-r10n-settings-toggle
                data-state={cal.isActive ? "on" : "off"}
                className={cn(
                  "relative w-9 h-5 rounded-full transition-colors flex-shrink-0",
                  cal.isActive ? "bg-primary" : "bg-border",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                aria-label={cal.isActive ? "Deactivate" : "Activate"}
              >
                <span
                  className={cn(
                    "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                    cal.isActive && "translate-x-4"
                  )}
                />
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={() => handleDelete(cal.id, cal.repName)}
                disabled={deleteMutation.isPending}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                aria-label="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-5 px-3.5 py-3 rounded-[8px] border border-dashed border-border text-xs text-muted-foreground">
          No calendars yet — add the first one below.
        </div>
      )}

      {/* Add form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Add Rep
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Rep Name</label>
            <input
              type="text"
              value={repName}
              onChange={(e) => setRepName(e.target.value)}
              placeholder="Sarah Jones"
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Email</label>
            <input
              type="email"
              value={repEmail}
              onChange={(e) => setRepEmail(e.target.value)}
              placeholder="sarah@company.com"
              autoCapitalize="none"
              autoCorrect="off"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">GHL Calendar ID</label>
            <input
              type="text"
              value={ghlCalendarId}
              onChange={(e) => setGhlCalendarId(e.target.value)}
              placeholder="calendar_abc123"
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Conflict Calendar
            </label>
            <input
              type="text"
              value={conflictCalId}
              onChange={(e) => setConflictCalId(e.target.value)}
              placeholder="primary"
              title="Google Calendar ID to check for scheduling conflicts"
              className={INPUT_CLASS}
            />
            <p className="text-[10px] text-muted-foreground">
              Google Calendar ID to check for conflicts. Defaults to &quot;primary&quot;.
            </p>
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Color</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border border-border bg-background p-0.5"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!canSubmit || createMutation.isPending}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
              "bg-primary text-white hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {createMutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Add Rep
          </button>

          {addSuccess && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Calendar added
            </span>
          )}
          {createMutation.isError && (
            <span className="text-xs text-destructive">
              {(createMutation.error as Error).message}
            </span>
          )}
          {deleteMutation.isError && (
            <span className="text-xs text-destructive">
              {(deleteMutation.error as Error).message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
