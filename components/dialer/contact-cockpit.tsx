"use client";

import { useState } from "react";
import { Mail, Phone, Play, MessageSquare, FileText, Activity, ListChecks, Sparkles, SkipForward, Users, Presentation, ListTodo, ClipboardCheck, Eye, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { QuickActionModal, type QuickActionKind } from "./quick-action-modal";
import type { DialerCampaign, DialerContact, Sentiment } from "./mock-data";

const SENTIMENT: Record<Sentiment, { label: string; cls: string }> = {
  positive: { label: "Positive", cls: "bg-success-subtle text-success" },
  neutral: { label: "Neutral", cls: "bg-muted text-muted-foreground" },
  negative: { label: "Negative", cls: "bg-destructive/10 text-destructive" },
};

export function ContactCockpit({
  contact,
  campaign,
  running,
  isPreview,
  onStart,
  onSkip,
  onBack,
  onSelectContact,
  onToast,
}: {
  contact: DialerContact | null;
  campaign: DialerCampaign | null;
  running: boolean;
  isPreview: boolean;
  onStart: () => void;
  onSkip: () => void;
  onBack: () => void;
  onSelectContact: (id: string) => void;
  onToast: (m: string) => void;
}) {
  if (contact) return <LoadedContact key={contact.id} contact={contact} isPreview={isPreview} onSkip={onSkip} onBack={onBack} onToast={onToast} />;
  if (campaign && !running) return <CampaignOverview campaign={campaign} onStart={onStart} onSelectContact={onSelectContact} />;
  return <EmptyState hasCampaign={!!campaign} />;
}

/* ── Loaded contact: everything, no navigating away ───────────────────────── */
function LoadedContact({ contact, isPreview, onSkip, onBack, onToast }: { contact: DialerContact; isPreview: boolean; onSkip: () => void; onBack: () => void; onToast: (m: string) => void }) {
  const [quickAction, setQuickAction] = useState<QuickActionKind | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [addedNotes, setAddedNotes] = useState<{ author: string; body: string; time: string }[]>([]);
  const notes = [...addedNotes, ...contact.notes];

  function saveNote() {
    if (!noteDraft.trim()) return;
    setAddedNotes((a) => [{ author: "You", body: noteDraft.trim(), time: "just now" }, ...a]);
    setNoteDraft("");
    onToast("Note saved");
  }

  return (
    <div className="flex h-full flex-col motion-safe:animate-[dialerFade_220ms_ease-out]">
      {/* Sticky identity header */}
      <div className="shrink-0 border-b border-border bg-card/80 px-6 py-4 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-info/10 text-[15px] font-bold text-info">
              {contact.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[19px] font-bold leading-tight text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                {contact.name}
              </h1>
              <p className="truncate text-[13px] text-muted-foreground">{contact.company}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isPreview && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Preview</span>
            )}
            <span className="rounded-full bg-info-subtle px-2.5 py-1 text-[11px] font-semibold text-info">{contact.stage}</span>
            {isPreview ? (
              <button
                type="button"
                onClick={onBack}
                title="Back to campaign"
                className="flex items-center gap-1.5 rounded-[8px] border border-border/70 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-border"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            ) : (
              <button
                type="button"
                onClick={onSkip}
                title="Skip — send to back of queue"
                className="flex items-center gap-1.5 rounded-[8px] border border-border/70 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-border"
              >
                <SkipForward className="h-3.5 w-3.5" /> Skip
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-foreground tabular-nums">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" /> {contact.phone}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[13px] text-foreground">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" /> {contact.email}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {contact.tags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">{t}</span>
            ))}
          </div>
        </div>

        {/* Quick actions — reachable before and during a call */}
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionBtn icon={<Presentation className="h-3.5 w-3.5" />} label="Create demo" onClick={() => setQuickAction("demo")} />
          <ActionBtn icon={<ListTodo className="h-3.5 w-3.5" />} label="Create task" onClick={() => setQuickAction("task")} />
          <ActionBtn icon={<ClipboardCheck className="h-3.5 w-3.5" />} label="Create audit" onClick={() => setQuickAction("audit")} />
        </div>
      </div>

      {/* Scrollable everything */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {contact.lastCall && (
          <section className="mb-5 rounded-[12px] border border-border bg-gradient-to-b from-muted/30 to-transparent p-4">
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />}>Last call · {contact.lastCall.when}</SectionLabel>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", SENTIMENT[contact.lastCall.sentiment].cls)}>
                {SENTIMENT[contact.lastCall.sentiment].label}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-foreground/90">{contact.lastCall.summary}</p>
            {contact.lastCall.objection && (
              <p className="mt-2 text-[12px] text-muted-foreground"><span className="font-semibold text-foreground/70">Objection:</span> {contact.lastCall.objection}</p>
            )}
          </section>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Section icon={<ListChecks className="h-3.5 w-3.5" />} title="Qualification">
            <dl className="space-y-2.5">
              {contact.qualification.map((qa, i) => (
                <div key={i}>
                  <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">{qa.q}</dt>
                  <dd className="text-[13px] leading-snug text-foreground">{qa.a}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section icon={<MessageSquare className="h-3.5 w-3.5" />} title="Conversation">
            <div className="space-y-2">
              {contact.messages.map((m, i) => (
                <div key={i} className={cn("flex", m.dir === "out" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[88%] rounded-[12px] px-3 py-2 text-[12.5px] leading-snug",
                    m.dir === "out" ? "bg-info/8 text-foreground rounded-br-[4px]" : "bg-muted text-foreground rounded-bl-[4px]",
                  )}>
                    {m.body}
                    <span className="mt-1 block text-[9.5px] text-muted-foreground/70">{m.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={<FileText className="h-3.5 w-3.5" />} title="Notes">
            <div className="mb-2.5 rounded-[10px] border border-border bg-card p-2">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(); }}
                rows={2}
                placeholder="Add a note while you talk… (⌘↵ to save)"
                className="w-full resize-none bg-transparent px-1 py-0.5 text-[12.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={saveNote}
                  disabled={!noteDraft.trim()}
                  className="rounded-[7px] bg-primary px-3 py-1 text-[11.5px] font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-35"
                >
                  Save note
                </button>
              </div>
            </div>
            <div className="space-y-2.5">
              {notes.map((n, i) => (
                <div key={i} className="rounded-[10px] border border-border/60 bg-muted/25 px-3 py-2.5">
                  <p className="text-[12.5px] leading-snug text-foreground">{n.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{n.author} · {n.time}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={<Activity className="h-3.5 w-3.5" />} title="Timeline">
            <ol className="relative ml-1 space-y-3 border-l border-border pl-4">
              {contact.timeline.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-info/50 ring-2 ring-background" />
                  <p className="text-[12.5px] leading-snug text-foreground">{e.label}</p>
                  <p className="text-[10px] text-muted-foreground">{e.time}</p>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      {quickAction && (
        <QuickActionModal
          kind={quickAction}
          contactName={contact.name}
          onClose={() => setQuickAction(null)}
          onCreated={(toast) => { setQuickAction(null); onToast(toast); }}
        />
      )}
    </div>
  );
}

/* ── Campaign overview (selected, not started) — fills the width ──────────── */
function CampaignOverview({ campaign, onStart, onSelectContact }: { campaign: DialerCampaign; onStart: () => void; onSelectContact: (id: string) => void }) {
  const empty = campaign.contacts.length === 0;
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-6 pt-6 pb-5">
        <h1 className="text-[22px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{campaign.name}</h1>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          {campaign.maxAttempts} attempts per contact · assigned to {campaign.reps.map((r) => r.name.split(" ")[0]).join(", ")}
        </p>

        {/* Stats — full width, three equal cards */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatCard n={campaign.contacts.length} label="In queue" sub="ready to dial" tone="foreground" />
          <StatCard n={campaign.reached} label="Reached" sub="connected so far" tone="info" />
          <StatCard n={campaign.exhausted} label="Exhausted" sub="hit attempt limit" tone="muted" />
        </div>

        <button
          type="button"
          onClick={onStart}
          disabled={empty}
          className="mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-primary px-6 text-[15px] font-semibold text-primary-foreground shadow-[0_8px_22px_-12px_var(--primary)] transition-all duration-150 motion-safe:hover:-translate-y-px hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
        >
          <Play className="h-5 w-5 fill-current" /> Start campaign
        </button>
        {empty && <p className="mt-2 text-[11.5px] text-muted-foreground/80">No contacts yet. Add them from Contacts or Pipeline with “Add to Power Dialer.”</p>}
      </div>

      {/* Roster — click a contact to preview them before dialing */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mb-2.5 flex items-center gap-2">
          <SectionLabel icon={<Users className="h-3.5 w-3.5" />}>In this campaign · {campaign.contacts.length}</SectionLabel>
          <span className="text-[10.5px] text-muted-foreground/70">click to preview</span>
          <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        </div>
        <div className="space-y-1.5">
          {campaign.contacts.map((c) => <RosterRow key={c.id} contact={c} max={campaign.maxAttempts} onClick={() => onSelectContact(c.id)} />)}
          {empty && <p className="py-6 text-center text-[12.5px] text-muted-foreground">This campaign is empty.</p>}
        </div>
      </div>
    </div>
  );
}

function RosterRow({ contact, max, onClick }: { contact: DialerContact; max: number; onClick: () => void }) {
  const lastAttempt = contact.attempts >= max - 1 && contact.attempts > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-[10px] border border-border/60 bg-card px-3 py-2.5 text-left transition-all duration-150 hover:border-border hover:bg-muted/30 hover:shadow-[0_2px_10px_-6px_rgba(28,35,51,0.25)] active:scale-[0.997]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
        {contact.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground">{contact.name}</p>
        <p className="truncate text-[11.5px] text-muted-foreground">{contact.company} · {contact.phone}</p>
      </div>
      <span className="hidden rounded-full bg-info-subtle px-2 py-0.5 text-[10px] font-medium text-info sm:inline">{contact.stage}</span>
      <span className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums",
        lastAttempt ? "bg-warning-subtle text-warning" : "bg-muted text-muted-foreground",
      )}>
        <Phone className="h-2.5 w-2.5" /> {contact.attempts}/{max}
      </span>
      <Eye className="h-4 w-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
    </button>
  );
}

function EmptyState({ hasCampaign }: { hasCampaign: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60">
        <Phone className="h-6 w-6" />
      </span>
      <p className="mt-4 text-[14px] font-semibold text-foreground">{hasCampaign ? "Select a campaign to begin" : "Nothing loaded"}</p>
      <p className="mt-1 max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">
        Pick a campaign on the left to work the queue, or dial any number on the keypad.
      </p>
    </div>
  );
}

/* ── small pieces ─────────────────────────────────────────────────────────── */
function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[8px] border border-border/70 bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-foreground/80 transition-all hover:border-border hover:text-foreground hover:bg-muted/30 active:scale-[0.98]"
    >
      <span className="text-info">{icon}</span>
      {label}
    </button>
  );
}

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground/80">
      <span className="text-info/70">{icon}</span>
      {children}
    </span>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <SectionLabel icon={icon}>{title}</SectionLabel>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>
      {children}
    </section>
  );
}

function StatCard({ n, label, sub, tone }: { n: number; label: string; sub: string; tone: "foreground" | "info" | "muted" }) {
  const numCls = tone === "info" ? "text-info" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="flex items-center gap-3.5 rounded-[12px] border border-border bg-card px-4 py-3.5">
      <span className={cn("text-[28px] font-bold leading-none tabular-nums", numCls)} style={{ fontFamily: "var(--font-heading)" }}>{n}</span>
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold leading-tight text-foreground">{label}</p>
        <p className="text-[11px] leading-tight text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}
