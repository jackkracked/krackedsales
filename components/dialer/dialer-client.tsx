"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { CampaignRail } from "./campaign-rail";
import { ContactCockpit } from "./contact-cockpit";
import { DialDock, type CallState } from "./dial-dock";
import { DialerOutcomeModal, type DialerOutcome } from "./dialer-outcome-modal";
import { CampaignBuilder } from "./campaign-builder";
import { MOCK_CAMPAIGNS, type DialerCampaign, type DialerContact } from "./mock-data";

function digitsOf(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}
function mmss(total: number) {
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.map((p) => p[0]).slice(0, 2).join("") || "YO").toUpperCase();
}

export function DialerClient({ role, userName }: { role: "admin" | "rep"; userName: string }) {
  const isAdmin = role === "admin";
  const currentUser = { name: userName || "You", initials: initialsOf(userName || "You") };

  const [campaigns, setCampaigns] = useState<DialerCampaign[]>(MOCK_CAMPAIGNS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [working, setWorking] = useState<DialerContact[]>([]); // remaining, current at [0]
  const [number, setNumber] = useState("");
  const [callState, setCallState] = useState<CallState>("idle");
  const [muted, setMuted] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [outcomeFor, setOutcomeFor] = useState<{ name: string; duration: number } | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function fireToast(m: string) {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const selectedCampaign = campaigns.find((c) => c.id === selectedId) ?? null;
  const isPreview = !running && !!previewId;
  const current = running && !completed
    ? working[0] ?? null
    : previewId
      ? selectedCampaign?.contacts.find((c) => c.id === previewId) ?? null
      : null;
  const attempt = current ? { n: current.attempts + 1, max: selectedCampaign?.maxAttempts ?? 3 } : undefined;

  // Load the current contact's number whenever the contact changes.
  const currentId = current?.id;
  useEffect(() => {
    if (currentId) setNumber(digitsOf(current!.phone));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // Simulated ring → connect.
  useEffect(() => {
    if (callState !== "dialing") return;
    const t = setTimeout(() => { setDurationSec(0); setCallState("connected"); }, 1600);
    return () => clearTimeout(t);
  }, [callState]);

  // Live call timer.
  useEffect(() => {
    if (callState !== "connected") return;
    const i = setInterval(() => setDurationSec((d) => d + 1), 1000);
    return () => clearInterval(i);
  }, [callState]);

  // Physical-keyboard dialing (only when idle and no modal).
  useEffect(() => {
    if (callState !== "idle" || outcomeFor || builderOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (/^[0-9*#+]$/.test(e.key)) setNumber((n) => n + e.key);
      else if (e.key === "Backspace") setNumber((n) => n.slice(0, -1));
      else if (e.key === "Enter") setNumber((n) => { if (n) setCallState("dialing"); return n; });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [callState, outcomeFor, builderOpen]);

  function selectCampaign(id: string) {
    setSelectedId(id);
    setRunning(false);
    setCompleted(false);
    setPreviewId(null);
    setCallState("idle");
    setNumber("");
  }
  function startCampaign() {
    if (!selectedCampaign || selectedCampaign.contacts.length === 0) return;
    setCompleted(false);
    setPreviewId(null);
    setRunning(true);
    setWorking([...selectedCampaign.contacts]);
  }
  function previewContact(id: string) {
    setPreviewId(id);
    setCallState("idle");
  }
  function backToCampaign() {
    setPreviewId(null);
    setCallState("idle");
    setNumber("");
  }
  function createCampaign(c: DialerCampaign) {
    setCampaigns((prev) => [c, ...prev]);
    setSelectedId(c.id);
    setRunning(false);
    setCompleted(false);
    setBuilderOpen(false);
    fireToast(`Campaign “${c.name}” created`);
  }
  function hangup() {
    setCallState("idle");
    setOutcomeFor({ name: current?.name ?? "Manual call", duration: durationSec });
  }
  function saveOutcome(o: DialerOutcome) {
    setOutcomeFor(null);
    setMuted(false);
    setDurationSec(0);
    if (current && running) {
      setWorking((prev) => {
        const [done, ...rest] = prev;
        const nextAttempts = done.attempts + 1;
        let next = rest;
        if (o.requeue && nextAttempts < (selectedCampaign?.maxAttempts ?? 3)) {
          next = [...rest, { ...done, attempts: nextAttempts }];
        }
        if (next.length === 0) setCompleted(true);
        return next;
      });
      fireToast(o.requeue ? `${o.label} · requeued` : `${o.label} · saved`);
    } else {
      setNumber("");
      setPreviewId(null);
      fireToast(`${o.label} · saved`);
    }
    setCallState("idle");
  }
  function skip() {
    setWorking((prev) => {
      if (prev.length < 2) return prev;
      const [done, ...rest] = prev;
      return [...rest, done];
    });
  }

  const keyframes = "@keyframes dialerFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}";

  return (
    <div className="flex h-full">
      <style>{keyframes}</style>

      {/* Left — campaign rail */}
      <aside className="w-[284px] shrink-0 border-r border-border bg-card/50">
        <CampaignRail
          campaigns={campaigns}
          selectedId={selectedId}
          onSelect={selectCampaign}
          onNewCampaign={() => setBuilderOpen(true)}
          isAdmin={isAdmin}
        />
      </aside>

      {/* Center — cockpit */}
      <section className="relative flex-1 min-w-0 bg-background">
        {completed && running ? (
          <CompletedPanel name={selectedCampaign?.name ?? "Campaign"} onClose={() => { setRunning(false); setCompleted(false); }} />
        ) : (
          <ContactCockpit
            contact={current}
            campaign={selectedCampaign}
            running={running}
            isPreview={isPreview}
            onStart={startCampaign}
            onSkip={skip}
            onBack={backToCampaign}
            onSelectContact={previewContact}
            onToast={fireToast}
          />
        )}

        <span className="pointer-events-none absolute bottom-3 left-4 rounded-full bg-foreground/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Preview · simulated calls
        </span>
      </section>

      {/* Right — dial dock */}
      <aside className="w-[372px] shrink-0 border-l border-border bg-muted/15 p-4">
        <DialDock
          state={callState}
          number={number}
          contactName={current?.name}
          attempt={attempt}
          muted={muted}
          durationSec={durationSec}
          onPress={(k) => setNumber((n) => n + k)}
          onBackspace={() => setNumber((n) => n.slice(0, -1))}
          onClear={() => setNumber("")}
          onDial={() => number && setCallState("dialing")}
          onHangup={hangup}
          onToggleMute={() => setMuted((m) => !m)}
        />
      </aside>

      {outcomeFor && (
        <DialerOutcomeModal
          contactName={outcomeFor.name}
          durationLabel={outcomeFor.duration > 0 ? mmss(outcomeFor.duration) : "Did not connect"}
          onSave={saveOutcome}
        />
      )}

      {builderOpen && (
        <CampaignBuilder
          isAdmin={isAdmin}
          currentUser={currentUser}
          onClose={() => setBuilderOpen(false)}
          onCreate={createCampaign}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background shadow-[0_8px_24px_-8px_rgba(28,35,51,0.5)] motion-safe:animate-[dialerFade_180ms_ease-out]">
          {toast}
        </div>
      )}
    </div>
  );
}

function CompletedPanel({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center motion-safe:animate-[dialerFade_220ms_ease-out]">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-info-subtle text-info">
        <CheckCircle2 className="h-8 w-8" />
      </span>
      <h1 className="mt-4 text-[22px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Campaign cleared</h1>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
        You've worked every available contact in {name}. No-answers were requeued up to the attempt limit.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-6 rounded-[10px] border border-border bg-card px-5 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted/40"
      >
        Back to campaigns
      </button>
    </div>
  );
}
