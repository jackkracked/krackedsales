"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PhoneOff, Phone, PhoneIncoming } from "lucide-react";
import type { Device as TDevice, Call as TCall } from "@twilio/voice-sdk";

export type DialerStatus = "uninitialized" | "not_configured" | "ready" | "error";
export type DialerCallState = "idle" | "connecting" | "open";
export interface CallMeta { contactId?: string; campaignContactId?: string; name?: string }

interface DialerCtx {
  status: DialerStatus;
  callState: DialerCallState;
  muted: boolean;
  durationSec: number;
  activeMeta: CallMeta | null;
  dial: (phoneNumber: string, meta?: CallMeta) => Promise<void>;
  hangup: () => void;
  toggleMute: () => void;
  sendDigits: (digits: string) => void;
}

const Ctx = createContext<DialerCtx | null>(null);
export function useDialer(): DialerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDialer must be used within DialerProvider");
  return c;
}

export function DialerProvider({ children, userEmail }: { children: React.ReactNode; userEmail?: string }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<DialerStatus>("uninitialized");
  const [callState, setCallState] = useState<DialerCallState>("idle");
  const [muted, setMuted] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [activeMeta, setActiveMeta] = useState<CallMeta | null>(null);
  const [incoming, setIncoming] = useState<{ from: string } | null>(null);

  const deviceRef = useRef<TDevice | null>(null);
  const callRef = useRef<TCall | null>(null);
  const incomingRef = useRef<TCall | null>(null);
  const emailRef = useRef(userEmail);
  emailRef.current = userEmail;

  // Wire a Call's lifecycle to local state.
  const wire = useCallback((call: TCall) => {
    callRef.current = call;
    call.on("accept", () => { setCallState("open"); setDurationSec(0); });
    const end = () => { setCallState("idle"); setActiveMeta(null); setMuted(false); callRef.current = null; };
    call.on("disconnect", end);
    call.on("cancel", end);
    call.on("reject", end);
    call.on("error", (e: unknown) => { console.error("[dialer] call error", e); end(); });
  }, []);

  // Initialise the Twilio Device once (browser-only; dynamically imported).
  useEffect(() => {
    let cancelled = false;
    let device: TDevice | null = null;
    (async () => {
      try {
        const res = await fetch("/api/dialer/token");
        const data = res.ok ? await res.json() : null;
        if (!data?.configured || !data?.token) { if (!cancelled) setStatus("not_configured"); return; }
        const { Device } = await import("@twilio/voice-sdk");
        if (cancelled) return;
        device = new Device(data.token, { logLevel: "error" });
        deviceRef.current = device;
        device.on("registered", () => { if (!cancelled) setStatus("ready"); });
        device.on("error", (e: unknown) => console.error("[dialer] device error", e));
        device.on("tokenWillExpire", async () => {
          try { const r = await fetch("/api/dialer/token"); const d = await r.json(); if (d?.token) device?.updateToken(d.token); } catch { /* ignore */ }
        });
        device.on("incoming", (call: TCall) => {
          incomingRef.current = call;
          setIncoming({ from: (call.parameters?.From as string) ?? "Unknown" });
          const clear = () => { setIncoming(null); incomingRef.current = null; };
          call.on("cancel", clear);
          call.on("disconnect", clear);
          call.on("reject", clear);
        });
        await device.register();
        if (!cancelled) setStatus("ready");
      } catch (e) {
        console.error("[dialer] init failed", e);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; try { device?.destroy(); } catch { /* ignore */ } deviceRef.current = null; };
  }, []);

  // Live duration tick while connected.
  useEffect(() => {
    if (callState !== "open") return;
    const i = setInterval(() => setDurationSec((d) => d + 1), 1000);
    return () => clearInterval(i);
  }, [callState]);

  const dial = useCallback(async (phoneNumber: string, meta?: CallMeta) => {
    const device = deviceRef.current;
    if (!device) return;
    setActiveMeta(meta ?? null);
    setMuted(false);
    setCallState("connecting");
    try {
      const call = await device.connect({ params: {
        To: phoneNumber,
        contactId: meta?.contactId ?? "",
        campaignContactId: meta?.campaignContactId ?? "",
        repEmail: emailRef.current ?? "",
      } });
      wire(call);
    } catch (e) {
      console.error("[dialer] dial failed", e);
      setCallState("idle");
      setActiveMeta(null);
    }
  }, [wire]);

  const hangup = useCallback(() => { try { callRef.current?.disconnect(); } catch { /* ignore */ } setCallState("idle"); }, []);
  const toggleMute = useCallback(() => {
    setMuted((m) => { const nm = !m; try { callRef.current?.mute(nm); } catch { /* ignore */ } return nm; });
  }, []);
  const sendDigits = useCallback((digits: string) => { try { callRef.current?.sendDigits(digits); } catch { /* ignore */ } }, []);

  function acceptIncoming() { try { incomingRef.current?.accept(); wire(incomingRef.current!); setActiveMeta({ name: incoming?.from }); } catch { /* ignore */ } setIncoming(null); }
  function rejectIncoming() { try { incomingRef.current?.reject(); } catch { /* ignore */ } setIncoming(null); }

  const onDialer = pathname === "/dialer";

  return (
    <Ctx.Provider value={{ status, callState, muted, durationSec, activeMeta, dial, hangup, toggleMute, sendDigits }}>
      {children}

      {/* Incoming-call toast (anywhere in the app) */}
      {incoming && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3 shadow-[0_16px_40px_-12px_rgba(28,35,51,0.4)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success-subtle text-success"><PhoneIncoming className="h-4 w-4" /></span>
          <div className="mr-2">
            <p className="text-[12px] font-semibold text-foreground">Incoming call</p>
            <p className="font-mono text-[11px] text-muted-foreground">{incoming.from}</p>
          </div>
          <button onClick={acceptIncoming} className="flex h-9 items-center gap-1.5 rounded-[10px] bg-success px-3 text-[12.5px] font-semibold text-success-foreground"><Phone className="h-4 w-4" /> Answer</button>
          <button onClick={rejectIncoming} aria-label="Decline" className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-destructive text-destructive-foreground"><PhoneOff className="h-4 w-4" /></button>
        </div>
      )}

      {/* Persistent mini call-bar — visible while a call is live and you're NOT on the dialer page. */}
      {callState !== "idle" && !onDialer && (
        <div className="fixed bottom-6 right-6 z-[70] flex items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3 shadow-[0_16px_40px_-12px_rgba(28,35,51,0.4)]">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/50" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
          </span>
          <div className="mr-1">
            <p className="text-[12px] font-semibold text-foreground">{callState === "open" ? "On a call" : "Calling…"}{activeMeta?.name ? ` · ${activeMeta.name}` : ""}</p>
            <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{mmss(durationSec)}</p>
          </div>
          <button onClick={hangup} aria-label="End call" className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-destructive text-destructive-foreground"><PhoneOff className="h-4 w-4" /></button>
        </div>
      )}
    </Ctx.Provider>
  );
}

function mmss(t: number) {
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}
