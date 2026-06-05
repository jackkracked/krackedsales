"use client";

import { cn } from "@/lib/utils/cn";
import {
  FileText,
  ListOrdered,
  Globe,
  Target,
  Shield,
  MessageSquare,
  Layout,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import type { CallPrepSections } from "@/lib/call-prep/types";

interface PrepDocumentProps {
  sections: CallPrepSections;
  failedSections: string[];
}

export function PrepDocument({ sections, failedSections }: PrepDocumentProps) {
  return (
    <div className="space-y-8 pb-6">
      {/* Executive Summary */}
      <Section icon={FileText} title="Executive Summary">
        <p className="text-[15px] leading-relaxed text-foreground">
          {sections.executiveSummary}
        </p>
      </Section>

      {/* Call Agenda */}
      <Section icon={ListOrdered} title="Call Agenda">
        <ol className="space-y-2.5">
          {sections.callAgenda.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-xs font-bold text-primary/60 mt-0.5 shrink-0 w-5 text-right tabular-nums">
                {i + 1}.
              </span>
              <span className="text-sm text-foreground leading-relaxed">{item}</span>
            </li>
          ))}
        </ol>
      </Section>

      {/* Brand Research */}
      {failedSections.includes("brandResearch") ? (
        <FailedSection title="Brand Research" reason="Website could not be reached" />
      ) : sections.brandResearch ? (
        <Section icon={Globe} title="Brand Research">
          <div className="space-y-4">
            <Field label="What they do" value={sections.brandResearch.summary} />
            <Field label="Their audience" value={sections.brandResearch.audience} />
            <Field
              label="Current marketing"
              value={sections.brandResearch.currentMarketing}
            />
          </div>
        </Section>
      ) : null}

      {/* Qualification */}
      <Section icon={Target} title="Qualification">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Budget" value={sections.qualification.budget} />
          <Field label="Timeline" value={sections.qualification.timeline} />
          <Field label="Decision Maker" value={sections.qualification.decisionMaker} />
          <Field label="Fit" value={sections.qualification.fit} highlight />
        </div>
      </Section>

      {/* Objection Playbook */}
      <Section icon={Shield} title="Objection Playbook">
        <div className="space-y-4">
          {sections.objectionPlaybook.map((item, i) => (
            <div key={i} className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">
                &ldquo;{item.objection}&rdquo;
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed pl-3">
                {item.response}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Previous Interactions (follow-up only) */}
      {sections.previousInteractions && (
        <Section icon={MessageSquare} title="Previous Interactions">
          <div className="space-y-5">
            {sections.previousInteractions.lastCallSummary && (
              <Field
                label="Last call"
                value={sections.previousInteractions.lastCallSummary}
              />
            )}

            {sections.previousInteractions.promisesMade.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  Commitments made
                </p>
                <ul className="space-y-1.5">
                  {sections.previousInteractions.promisesMade.map((p, i) => (
                    <li
                      key={i}
                      className="text-sm text-foreground flex items-start gap-2"
                    >
                      <span className="text-primary mt-1 shrink-0">&#8226;</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sections.previousInteractions.recentMessages.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  Recent messages
                </p>
                <div className="space-y-2">
                  {sections.previousInteractions.recentMessages.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-sm"
                    >
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                        {m.channel}
                      </span>
                      <span className="text-foreground/80 leading-relaxed">
                        {m.body}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Demo Status */}
      {sections.demoStatus && (
        <Section icon={Layout} title="Demo Status">
          <div className="flex items-center justify-between">
            <p className="text-sm text-foreground">{sections.demoStatus.status}</p>
            {sections.demoStatus.clickupLink && (
              <a
                href={sections.demoStatus.clickupLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                View in ClickUp
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-4">
        <Icon className="w-4 h-4 text-muted-foreground/60" />
        <h3
          className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
        >
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1">
        {label}
      </p>
      <p
        className={cn(
          "text-sm leading-relaxed",
          highlight ? "text-foreground font-medium" : "text-foreground/80"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function FailedSection({
  title,
  reason,
}: {
  title: string;
  reason: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <AlertCircle className="w-4 h-4 text-muted-foreground/40" />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/50">
          {title}
        </h3>
      </div>
      <p className="text-sm text-muted-foreground/50 italic">{reason}</p>
    </div>
  );
}
