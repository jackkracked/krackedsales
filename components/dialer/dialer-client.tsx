"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { CheckCircle2, SlidersHorizontal, ArrowRight } from "lucide-react";
import Link from "next/link";
import { CampaignRail } from "./campaign-rail";
import { ContactCockpit } from "./contact-cockpit";
import { DialDock, type CallState } from "./dial-dock";
import { DialerOutcomeModal, type DialerOutcome } from "./dialer-outcome-modal";
import { CampaignBuilder } from "./campaign-builder";
import { ChangeStageModal } from "@/components/contacts/change-stage-modal";
import { useDialer } from "@/providers/dialer-provider";
import type { CampaignSummary, CampaignDetail, ClaimedContact, DialerContact, DialerCampaign } from "./mock-data";

interface Pipeline { id: string; name: string; stages: Array<{ id: string; name: string }> }

const digits = (p: string | null | undefined) => (p ?? "").replace(/[^\d+]/g, "");
const mmss = (t: number) => `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;

export function DialerClient({ role, userName }: { role: "admin" | "rep"; userName: string }) {
  const isAdmin = role === "admin";
  const qc = useQueryClient();
  const dialer = useDialer();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [claimed, setClaimed] = useState<ClaimedContact | null>(null);
  const [previewContactId, setPreviewContactId] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [outcomeFor, setOutcomeFor] = useState<{ campaignContactId: string | null; name: string; duration: number } | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function fireToast(m: string) { setToast(m); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2400); }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ── Data ──────────────────────────────────────────────────────────────────
  const campaignsQuery = useQuery<{ campaigns: CampaignSummary[] }>({
    queryKey: ["dialer-campaigns"],
    queryFn: () => fetch("/api/dialer/campaigns").then((r) => (r.ok ? r.json() : { campaigns: [] })),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const campaigns = campaignsQuery.data?.campaigns ?? [];

  const detailQuery = useQuery<CampaignDetail>({
    queryKey: ["dialer-campaign", selectedId],
    queryFn: () => fetch(`/api/dialer/campaigns/${selectedId}`).then((r) => r.json()),
    enabled: !!selectedId,
    staleTime: 10_000,
  });
  const detail = selectedId ? detailQuery.data ?? null : null;

  const isPreview = !running && !!previewContactId;
  const cockpitContactId = running && claimed ? claimed.contactId : previewContactId;
  const cockpitQuery = useQuery<{ contact: DialerContact }>({
    queryKey: ["dialer-contact", cockpitContactId],
    queryFn: () => fetch(`/api/dialer/contact/${cockpitContactId}`).then((r) => r.json()),
    enabled: !!cockpitContactId,
    staleTime: 60_000,
  });
  const cockpitContact = cockpitContactId ? cockpitQuery.data?.contact ?? null : null;

  // Pipelines → the stages available for the loaded contact's pipeline (for the
  // in-call + outcome "Move pipeline stage" flow; scoped to their own pipeline).
  const pipelinesQuery = useQuery<{ pipelines: Pipeline[] }>({
    queryKey: ["pipelines"],
    queryFn: () => fetch("/api/ghl/pipelines").then((r) => (r.ok ? r.json() : { pipelines: [] })),
    staleTime: 5 * 60_000,
  });
  const pipelines = pipelinesQuery.data?.pipelines ?? [];
  const oppStages = cockpitContact?.pipelineId ? (pipelines.find((p) => p.id === cockpitContact.pipelineId)?.stages ?? []) : [];
  const currentStageId = cockpitContact?.pipelineStageId ?? null;
  const currentStageName = oppStages.find((s) => s.id === currentStageId)?.name ?? cockpitContact?.stage ?? null;
  const canChangeStage = !!cockpitContact?.opportunityId && oppStages.length > 0;
  const [stageModalOpen, setStageModalOpen] = useState(false);

  const dockState: CallState = dialer.callState === "connecting" ? "dialing" : dialer.callState === "open" ? "connected" : "idle";
  const attempt = running && claimed && detail ? { n: claimed.attempts + 1, max: detail.campaign.maxAttempts } : undefined;
  const dockName = running && claimed ? claimed.contactName ?? undefined : isPreview ? cockpitContact?.name : undefined;

  // Load the preview contact's number once its data arrives.
  useEffect(() => {
    if (isPreview && cockpitContact?.phone) setNumber(digits(cockpitContact.phone));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewContactId, cockpitContact?.phone]);

  // ── Detect call end → open the outcome modal ───────────────────────────────
  const prevCall = useRef(dialer.callState);
  const inCall = useRef(false);
  const dialedContact = useRef<{ campaignContactId: string | null; name: string }>({ campaignContactId: null, name: "" });
  useEffect(() => {
    const prev = prevCall.current;
    prevCall.current = dialer.callState;
    if ((prev === "open" || prev === "connecting") && dialer.callState === "idle" && inCall.current) {
      inCall.current = false;
      setOutcomeFor({ campaignContactId: dialedContact.current.campaignContactId, name: dialedContact.current.name, duration: dialer.durationSec });
    }
  }, [dialer.callState, dialer.durationSec]);

  // ── Keyboard control of the manual dial pad (digits · + # * · Backspace · Enter) ──
  const startDialRef = useRef(startDial);
  startDialRef.current = startDial;
  const dockStateRef = useRef(dockState);
  dockStateRef.current = dockState;
  const modalOpenRef = useRef(false);
  modalOpenRef.current = !!outcomeFor || builderOpen;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      // Never hijack typing in a field (notes, search, modals) or during a live call / open modal.
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (modalOpenRef.current || dockStateRef.current !== "idle") return;
      if (/^[0-9*#+]$/.test(e.key)) { e.preventDefault(); setNumber((n) => n + e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); setNumber((n) => n.slice(0, -1)); }
      else if (e.key === "Enter") { e.preventDefault(); startDialRef.current(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────
  function selectCampaign(id: string) {
    setSelectedId(id); setRunning(false); setCompleted(false); setClaimed(null); setPreviewContactId(null); setNumber("");
  }
  async function startCampaign() {
    if (!selectedId) return;
    try {
      const data = await fetch(`/api/dialer/campaigns/${selectedId}/next`, { method: "POST" }).then((r) => r.json());
      if (data.contact) { setRunning(true); setCompleted(false); setPreviewContactId(null); setClaimed(data.contact); setNumber(digits(data.contact.phone)); }
      else fireToast("No contacts available to dial");
    } catch { fireToast("Could not start the campaign"); }
  }
  function previewContact(contactId: string) { setPreviewContactId(contactId); }
  function backToCampaign() { setPreviewContactId(null); setNumber(""); }

  function startDial() {
    if (!number) return;
    if (dialer.status !== "ready") { fireToast("Connect Twilio in Settings → Telephony first"); return; }
    inCall.current = true;
    const campaignContactId = running && claimed ? claimed.id : null;
    const name = running && claimed ? claimed.contactName ?? "Contact" : isPreview ? cockpitContact?.name ?? "Contact" : "Manual call";
    dialedContact.current = { campaignContactId, name };
    void dialer.dial(number, { contactId: cockpitContactId ?? undefined, campaignContactId: campaignContactId ?? undefined, name });
  }

  function moveStage(oppId: string, stageId: string, toStage: string, fromStage: string | null, reason: string, name: string) {
    return fetch(`/api/ghl/opportunities/${oppId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineStageId: stageId, stageName: toStage, fromStageName: fromStage, reason, opportunityName: name }),
    }).then((r) => { if (!r.ok) throw new Error("move failed"); return qc.invalidateQueries({ queryKey: ["dialer-contact", cockpitContactId] }); });
  }

  async function saveOutcome(o: DialerOutcome, notes: string, stageId: string | null) {
    const oc = outcomeFor;
    const oppId = cockpitContact?.opportunityId ?? null;
    const toStage = stageId ? oppStages.find((s) => s.id === stageId)?.name ?? null : null;
    setOutcomeFor(null);

    // Apply the pipeline-stage move first, using the mandatory note as the reason.
    // Non-fatal: the outcome still saves, but the rep is told if the move didn't land.
    if (stageId && oppId && toStage && stageId !== currentStageId) {
      try { await moveStage(oppId, stageId, toStage, currentStageName, notes, oc?.name ?? "Contact"); }
      catch { fireToast("Outcome saved, but the stage move failed"); }
    }

    if (oc?.campaignContactId) {
      try {
        const data = await fetch(`/api/dialer/contacts/${oc.campaignContactId}/disposition`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome: o.key, requeue: o.requeue, notes }),
        }).then((r) => r.json());
        qc.invalidateQueries({ queryKey: ["dialer-campaign", selectedId] });
        qc.invalidateQueries({ queryKey: ["dialer-campaigns"] });
        if (data.next) { setClaimed(data.next); setNumber(digits(data.next.phone)); }
        else { setClaimed(null); setCompleted(true); }
        fireToast(o.requeue ? `${o.label} · requeued` : `${o.label} · saved`);
      } catch { fireToast("Could not save the outcome"); }
    } else {
      setNumber(""); setPreviewContactId(null);
      fireToast(`${o.label} · saved`);
    }
  }

  async function skip() {
    if (!claimed) return;
    try {
      const data = await fetch(`/api/dialer/contacts/${claimed.id}/skip`, { method: "POST" }).then((r) => r.json());
      qc.invalidateQueries({ queryKey: ["dialer-campaign", selectedId] });
      if (data.next) { setClaimed(data.next); setNumber(digits(data.next.phone)); }
      else { setClaimed(null); setCompleted(true); }
    } catch { fireToast("Could not skip"); }
  }

  async function createCampaign(c: DialerCampaign) {
    try {
      const data = await fetch("/api/dialer/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: c.name, maxAttempts: c.maxAttempts }),
      }).then((r) => r.json());
      setBuilderOpen(false);
      await qc.invalidateQueries({ queryKey: ["dialer-campaigns"] });
      if (data.campaign?.id) selectCampaign(data.campaign.id);
      fireToast(`Campaign “${c.name}” created`);
    } catch { fireToast("Could not create the campaign"); }
  }

  const keyframes = "@keyframes dialerFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}";
  const notConfigured = dialer.status === "not_configured";

  return (
    <div className="flex h-full">
      <style>{keyframes}</style>

      <aside className="w-[284px] shrink-0 border-r border-border bg-card/50">
        <CampaignRail campaigns={campaigns} selectedId={selectedId} onSelect={selectCampaign} onNewCampaign={() => setBuilderOpen(true)} loading={campaignsQuery.isLoading} />
      </aside>

      <section className="relative flex flex-1 min-w-0 flex-col bg-background">
        {notConfigured && isAdmin && (
          <Link href="/settings/telephony" className="flex items-center gap-2 border-b border-warning/30 bg-warning-subtle px-6 py-2.5 text-[12.5px] font-medium text-warning transition-colors hover:bg-warning-subtle/70">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Connect Twilio to start making calls
            <ArrowRight className="ml-auto h-3.5 w-3.5" />
          </Link>
        )}
        <div className="relative min-h-0 flex-1">
          {completed && running ? (
            <CompletedPanel name={detail?.campaign.name ?? "Campaign"} onClose={() => { setRunning(false); setCompleted(false); setClaimed(null); }} />
          ) : (
            <ContactCockpit
              contact={cockpitContact}
              detail={detail}
              running={running}
              isPreview={isPreview}
              contactLoading={!!cockpitContactId && cockpitQuery.isLoading}
              onStart={startCampaign}
              onSkip={skip}
              onBack={backToCampaign}
              onSelectContact={previewContact}
              onToast={fireToast}
              stageLabel={currentStageName}
              canChangeStage={canChangeStage}
              onChangeStage={() => setStageModalOpen(true)}
            />
          )}
        </div>
      </section>

      <aside className="w-[372px] shrink-0 border-l border-border bg-muted/15 p-4">
        <DialDock
          state={dockState}
          number={number}
          contactName={dockName}
          identity={cockpitContact ? { name: cockpitContact.name, company: cockpitContact.company || undefined, email: cockpitContact.email || undefined, stage: cockpitContact.stage || undefined } : undefined}
          attempt={attempt}
          muted={dialer.muted}
          durationSec={dialer.durationSec}
          onPress={(k) => { if (dialer.callState === "open") dialer.sendDigits(k); else setNumber((n) => n + k); }}
          onBackspace={() => setNumber((n) => n.slice(0, -1))}
          onClear={() => setNumber("")}
          onDial={startDial}
          onHangup={dialer.hangup}
          onToggleMute={dialer.toggleMute}
        />
      </aside>

      {outcomeFor && (
        <DialerOutcomeModal
          contactName={outcomeFor.name}
          durationLabel={outcomeFor.duration > 0 ? mmss(outcomeFor.duration) : "Did not connect"}
          onSave={saveOutcome}
          stages={oppStages}
          currentStageId={currentStageId}
          canMoveStage={canChangeStage}
        />
      )}
      {stageModalOpen && cockpitContact?.opportunityId && (
        <ChangeStageModal
          contact={{ name: cockpitContact.name, stage: currentStageName, stageId: currentStageId, pipelineId: cockpitContact.pipelineId ?? null, opportunityId: cockpitContact.opportunityId }}
          pipelines={pipelines}
          onClose={() => setStageModalOpen(false)}
          onMoved={() => { qc.invalidateQueries({ queryKey: ["dialer-contact", cockpitContactId] }); fireToast("Stage updated"); }}
        />
      )}
      {builderOpen && (
        <CampaignBuilder isAdmin={isAdmin} currentUser={{ name: userName || "You", initials: (userName || "You").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() }} onClose={() => setBuilderOpen(false)} onCreate={createCampaign} />
      )}
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background shadow-[0_8px_24px_-8px_rgba(28,35,51,0.5)] motion-safe:animate-[dialerFade_180ms_ease-out]">{toast}</div>
      )}
    </div>
  );
}

function CompletedPanel({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center motion-safe:animate-[dialerFade_220ms_ease-out]">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-info-subtle text-info"><CheckCircle2 className="h-8 w-8" /></span>
      <h1 className="mt-4 text-[22px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Campaign cleared</h1>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">You've worked every available contact in {name}. No-answers were requeued up to the attempt limit.</p>
      <button type="button" onClick={onClose} className="mt-6 rounded-[10px] border border-border bg-card px-5 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted/40">Back to campaigns</button>
    </div>
  );
}
