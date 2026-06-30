"use client";

import { useState } from "react";
import { Phone, PhoneOff, Delete, Mic, MicOff, Grid3x3, X, Circle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Keypad } from "./keypad";

export type CallState = "idle" | "dialing" | "connected";

/** Light grouping so a typed string reads like a phone number, not a blob. */
function formatPhone(raw: string): string {
  if (!raw) return "";
  const plus = raw.startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  // US shape: (NXX) NXX-XXXX, optionally +1.
  const core = digits.startsWith("1") && digits.length === 11 ? digits.slice(1) : digits;
  if (core.length === 10 && !raw.includes("*") && !raw.includes("#")) {
    const us = `(${core.slice(0, 3)}) ${core.slice(3, 6)}-${core.slice(6)}`;
    return (plus || digits.length === 11) ? `+1 ${us}` : us;
  }
  return raw;
}

function mmss(total: number): string {
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

interface DialDockProps {
  state: CallState;
  number: string;
  contactName?: string;
  attempt?: { n: number; max: number };
  muted: boolean;
  durationSec: number;
  onPress: (k: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onDial: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
}

export function DialDock(props: DialDockProps) {
  const { state, number, contactName, attempt, muted, durationSec } = props;
  const [showKeypadInCall, setShowKeypadInCall] = useState(false);
  const display = formatPhone(number);

  return (
    <div
      data-r10n-card
      className="flex h-full flex-col rounded-[14px] border border-border bg-gradient-to-b from-white to-[#F7F5F1] shadow-[0_1px_2px_rgba(28,35,51,0.04),0_18px_40px_-28px_rgba(28,35,51,0.28)] overflow-hidden"
    >
      {/* ── Header: who / what we're calling ─────────────────────────────── */}
      <div className="px-5 pt-5 pb-4 text-center">
        {contactName ? (
          <div className="flex items-center justify-center gap-2">
            <p className="text-[13px] font-semibold text-foreground truncate max-w-[200px]">{contactName}</p>
            {attempt && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground tabular-nums">
                {attempt.n} of {attempt.max}
              </span>
            )}
          </div>
        ) : (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
            {state === "idle" ? "Manual dial" : "Calling"}
          </p>
        )}

        {/* The number — big, tabular, instrument-grade */}
        <div className="mt-2.5 flex items-center justify-center gap-2 min-h-[40px]">
          <span
            className={cn(
              "font-mono text-[28px] leading-none tracking-tight text-foreground tabular-nums",
              !display && "text-muted-foreground/30",
            )}
          >
            {display || "Enter a number"}
          </span>
          {state === "idle" && number && (
            <button
              type="button"
              onClick={props.onBackspace}
              aria-label="Delete"
              className="rounded-full p-1.5 text-muted-foreground/60 transition-colors hover:text-foreground hover:bg-muted/60 active:scale-90"
            >
              <Delete className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 px-5 pb-5 flex flex-col justify-end">
        {/* ── IDLE: keypad + green Dial ──────────────────────────────────── */}
        {state === "idle" && (
          <>
            <Keypad onPress={props.onPress} />
            <button
              type="button"
              onClick={props.onDial}
              disabled={!number}
              className={cn(
                "mt-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-[14px]",
                "bg-success text-success-foreground font-semibold text-[15px]",
                "shadow-[0_8px_22px_-10px_var(--success)] transition-all duration-150",
                "motion-safe:hover:-translate-y-px hover:brightness-[1.05] active:translate-y-0 active:scale-[0.99]",
                "disabled:opacity-35 disabled:shadow-none disabled:pointer-events-none",
              )}
            >
              <Phone className="h-5 w-5" />
              Call
            </button>
          </>
        )}

        {/* ── DIALING (ringing) ──────────────────────────────────────────── */}
        {state === "dialing" && (
          <div className="flex flex-col items-center justify-center gap-6 py-8">
            <span className="relative flex h-20 w-20 items-center justify-center">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success/20 motion-safe:animate-ping" />
              <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-success/12 text-success">
                <Phone className="h-7 w-7" />
              </span>
            </span>
            <p className="text-[12px] font-medium text-muted-foreground tracking-wide motion-safe:animate-pulse">Ringing…</p>
            <button
              type="button"
              onClick={props.onHangup}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-destructive/10 text-destructive font-semibold text-[14px] transition-colors hover:bg-destructive/15 active:scale-[0.99]"
            >
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        )}

        {/* ── CONNECTED: live in-call panel ─────────────────────────────── */}
        {state === "connected" && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-2 pt-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/8 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-destructive">
                <Circle className="h-2 w-2 fill-current motion-safe:animate-pulse" /> Rec
              </span>
              <span className="font-mono text-[34px] leading-none tabular-nums text-foreground">{mmss(durationSec)}</span>
            </div>

            {showKeypadInCall ? (
              <Keypad onPress={props.onPress} />
            ) : (
              <div className="grid grid-cols-3 gap-2.5">
                <CallControl label={muted ? "Unmute" : "Mute"} active={muted} onClick={props.onToggleMute} icon={muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />} />
                <CallControl label="Keypad" active={showKeypadInCall} onClick={() => setShowKeypadInCall(true)} icon={<Grid3x3 className="h-5 w-5" />} />
                <CallControl label="Notes" onClick={() => {}} icon={<span className="text-[16px] font-bold">＋</span>} />
              </div>
            )}

            {showKeypadInCall && (
              <button
                type="button"
                onClick={() => setShowKeypadInCall(false)}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Hide keypad
              </button>
            )}

            <button
              type="button"
              onClick={props.onHangup}
              className={cn(
                "flex h-14 w-full items-center justify-center gap-2.5 rounded-[14px]",
                "bg-destructive text-destructive-foreground font-semibold text-[15px]",
                "shadow-[0_8px_22px_-10px_var(--destructive)] transition-all duration-150",
                "motion-safe:hover:-translate-y-px hover:brightness-[1.05] active:translate-y-0 active:scale-[0.99]",
              )}
            >
              <PhoneOff className="h-5 w-5" /> End call
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CallControl({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[14px] border transition-all duration-150 active:scale-[0.97]",
        active
          ? "border-foreground/15 bg-foreground/[0.06] text-foreground"
          : "border-border/70 bg-white text-muted-foreground hover:text-foreground hover:border-border",
      )}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
