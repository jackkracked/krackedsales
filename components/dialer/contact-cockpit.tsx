"use client";

import { Mail, Phone, Play, MessageSquare, FileText, Activity, ListChecks, Sparkles, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils/cn";
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
  onStart,
  onSkip,
}: {
  contact: DialerContact | null;
  campaign: DialerCampaign | null;
  running: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  if (contact) return <LoadedContact key={contact.id} contact={contact} campaign={campaign} onSkip={onSkip} />;
  if (campaign && !running) return <CampaignOverview campaign={campaign} onStart={onStart} />;
  return <EmptyState hasCampaign={!!campaign} />;
}

/* ── Loaded contact: everything, no navigating away ───────────────────────── */
function LoadedContact({ contact, campaign, onSkip }: { contact: DialerContact; campaign: DialerCampaign | null; onSkip: () => void }) {
  return (
    <div className="flex h-full flex-col motion-safe:animate-[dialerFade_220ms_ease-out]">
      {/* Sticky identity header */}
      <div className="shrink-0 border-b border-border bg-card/80 px-6 py-4 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[15px] font-bold text-primary">
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
            <span className="rounded-full bg-info-subtle px-2.5 py-1 text-[11px] font-semibold text-info">{contact.stage}</span>
            <button
              type="button"
              onClick={onSkip}
              title="Skip — send to back of queue"
              className="flex items-center gap-1.5 rounded-[8px] border border-border/70 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-border"
            >
              <SkipForward className="h-3.5 w-3.5" /> Skip
            </button>
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
                    m.dir === "out" ? "bg-primary/8 text-foreground rounded-br-[4px]" : "bg-muted text-foreground rounded-bl-[4px]",
                  )}>
                    {m.body}
                    <span className="mt-1 block text-[9.5px] text-muted-foreground/70">{m.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={<FileText className="h-3.5 w-3.5" />} title="Notes">
            <div className="space-y-2.5">
              {contact.notes.map((n, i) => (
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
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary/40 ring-2 ring-background" />
                  <p className="text-[12.5px] leading-snug text-foreground">{e.label}</p>
                  <p className="text-[10px] text-muted-foreground">{e.time}</p>
                </li>
              ))}
            </ol>
          </Section>
        </div>
        {campaign && <div className="h-2" />}
      </div>
    </div>
  );
}

/* ── Campaign overview (selected, not started) ────────────────────────────── */
function CampaignOverview({ campaign, onStart }: { campaign: DialerCampaign; onStart: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="w-full max-w-md">
        <h1 className="text-[24px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{campaign.name}</h1>
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat n={campaign.contacts.length} label="In queue" tone="foreground" />
          <Stat n={campaign.reached} label="Reached" tone="success" />
          <Stat n={campaign.exhausted} label="Exhausted" tone="muted" />
        </div>
        <p className="mt-5 text-[13px] text-muted-foreground">
          {campaign.maxAttempts} attempts per contact · assigned to {campaign.reps.map((r) => r.name.split(" ")[0]).join(", ")}
        </p>
        <button
          type="button"
          onClick={onStart}
          className="mt-7 inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-success px-6 py-3.5 text-[15px] font-semibold text-success-foreground shadow-[0_8px_22px_-10px_var(--success)] transition-all duration-150 motion-safe:hover:-translate-y-px hover:brightness-[1.05] active:scale-[0.99]"
        >
          <Play className="h-5 w-5 fill-current" /> Start campaign
        </button>
        <p className="mt-3 text-[11px] text-muted-foreground/70">The first contact loads into the dialer, ready to call.</p>
      </div>
    </div>
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
function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground/80">
      <span className="text-primary/60">{icon}</span>
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

function Stat({ n, label, tone }: { n: number; label: string; tone: "foreground" | "success" | "muted" }) {
  const cls = tone === "success" ? "text-success" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="rounded-[10px] border border-border bg-card py-3">
      <p className={cn("text-[22px] font-bold tabular-nums", cls)} style={{ fontFamily: "var(--font-heading)" }}>{n}</p>
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
