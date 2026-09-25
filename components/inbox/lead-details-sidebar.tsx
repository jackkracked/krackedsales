"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, TrendingUp,
  Mail, Phone, Globe, Building2, MapPin, Tag,
  Copy, Check, Plus, Pencil, X, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { QuickActionsBar } from "@/components/shared/quick-actions-bar";
import { BookingLinkModal } from "@/components/shared/booking-link-modal";
import { QualificationPreview } from "@/components/shared/qualification-panel";
import { StageSelect } from "@/components/leads/stage-select";
import { CreateTaskModal } from "@/components/shared/create-task-modal";
import { CreateDemoModal } from "@/components/shared/create-demo-modal";
import { CreateAuditModal } from "@/components/shared/create-audit-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { DemoLinkField } from "@/components/shared/demo-link-field";
import { CreateOpportunityPanel } from "@/components/shared/create-opportunity-panel";

export interface LeadDetailsSidebarProps {
  contactId: string;
  contactName?: string;
  /** ── Leads Centre extras (2026-08-07) ────────────────────────────────────────────
   *  All optional. The Inbox passes none of them and is unaffected. Extending this
   *  component rather than forking it is deliberate: two drawers drift apart, which is
   *  the same two-sources-of-truth pattern behind the 90-day billing failure and the
   *  Cheeky $10,800 display bug. */
  /** Our local_contacts id — enables the Meta stage control (fires the Conversions API). */
  leadId?: string;
  metaStage?: string | null;
  capiStatus?: string | null;
  /** Lead-form answers, already resolved to real questions. */
  formAnswers?: { question: string; answer: string }[];
  /** Makes the name a link. Used to open the existing contact modal. */
  onNameClick?: () => void;
  /** Adds a Message quick action that opens the contact modal, where the reply is composed.
   *  Falls back to onNameClick, which already opens exactly that modal. */
  onMessage?: () => void;
  /** Fired after a Meta stage change saves, so the list behind the drawer can refetch. */
  onStageChanged?: () => void;
  /**
   * Whether this panel owns its own scrolling. Default true (the Inbox docks it as a column).
   *
   * The Leads drawer wraps it in its own scroll container, and NESTED scrollers broke the
   * sticky quick-action bar: the outer container did the scrolling and carried the whole
   * sidebar with it, so `sticky bottom-0` never engaged (the Message button drifted from
   * y=536 to y=261 instead of staying put). Passing false makes the sidebar
   * `overflow-visible`, so sticky resolves against the drawer's scroller and the bar pins.
   */
  ownScroll?: boolean;
}

const STAGE_COLORS: Record<string, string> = {
  "new lead": "bg-blue-50 text-blue-700 border-blue-200",
  "initial contact": "bg-sky-50 text-sky-700 border-sky-200",
  "qualified": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "demo in progress": "bg-amber-50 text-amber-700 border-amber-200",
  "demo sent": "bg-purple-50 text-purple-700 border-purple-200",
  "unresponsive": "bg-orange-50 text-orange-700 border-orange-200",
  "won": "bg-green-50 text-green-700 border-green-200",
  "lost": "bg-red-50 text-red-700 border-red-200",
};

function stageBadgeClass(name: string) {
  const key = name.toLowerCase();
  for (const [fragment, cls] of Object.entries(STAGE_COLORS)) {
    if (key.includes(fragment)) return cls;
  }
  return "bg-muted text-muted-foreground border-border";
}

// Maps a stage name to a calm semantic tier for the R10N status-pill treatment.
// Inert under the default theme (only the [data-theme="r10n"] [data-status] rules read it).
function stageStatusTier(name: string): string {
  const key = name.toLowerCase();
  if (key.includes("won")) return "won";
  if (key.includes("lost")) return "lost";
  if (key.includes("unresponsive")) return "no_response";
  if (key.includes("qualified")) return "awaiting_reply";
  return "open";
}

// ── Contact data shape returned by GET /api/ghl/contacts/[id] ────────────────
// GHL v2 stores the street on `address1`; the derived clean `website` comes back
// alongside the contact. Everything is optional — the panel never assumes a field.
interface ContactRecord {
  id?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  address1?: string;
  city?: string;
  state?: string;
  country?: string;
  source?: string;
  tags?: string[];
}
interface ContactResponse {
  contact: ContactRecord | null;
  website?: string | null;
  websiteRaw?: string | null;
}

// The editable contact fields, in the order they render. `key` is what we PATCH.
type FieldKey = "email" | "phone" | "website" | "companyName" | "address" | "city" | "state" | "country";
type SaveState = "idle" | "saving" | "saved" | "error";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function externalHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function LeadDetailsSidebar({
  contactId,
  contactName = "",
  leadId,
  metaStage,
  capiStatus,
  formAnswers,
  onNameClick,
  onMessage,
  onStageChanged,
  ownScroll = true,
}: LeadDetailsSidebarProps) {
  const queryClient = useQueryClient();
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [showCreateDemo, setShowCreateDemo] = useState(false);
  const [showCreateAudit, setShowCreateAudit] = useState(false);
  const [localStageId, setLocalStageId] = useState<string | null>(null);
  const [localStageName, setLocalStageName] = useState<string | null>(null);
  const [savingStage, setSavingStage] = useState(false);

  const {
    data: oppData,
    isLoading: oppLoading,
    isPlaceholderData: oppIsPlaceholder,
    isError: oppError,
  } = useQuery<{
    opportunity: (GHLOpportunity & { pipelineStageId_name: string }) | null;
    stageName?: string;
    /** True when the GHL lookup failed. A null opportunity then means "unknown", not "none". */
    lookupFailed?: boolean;
  }>({
    queryKey: ["contact-opportunity", contactId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (contactName) params.set("name", contactName);
      try {
        const res = await fetch(`/api/ghl/contacts/${encodeURIComponent(contactId)}/opportunity?${params}`);
        if (!res.ok) return { opportunity: null, lookupFailed: true };
        return await res.json();
      } catch {
        // A thrown fetch (offline, dropped tunnel, non-JSON body) is "we do not know", exactly
        // like a non-ok response. Without this it lands in the query's error state instead,
        // where `lookupFailed` is undefined and the UI would read it as "no opportunity".
        return { opportunity: null, lookupFailed: true };
      }
    },
    enabled: !!contactId,
    staleTime: 2 * 60 * 1000,
    // The provider sets `keepPreviousData` globally. Here that means the PREVIOUS contact's
    // opportunity is served while the new one loads, with isLoading false, so the drawer would
    // answer a question about this client using another client's data.
    placeholderData: undefined,
  });

  // Fetch pipeline stages for the stage change dropdown
  const { data: pipelinesData } = useQuery<{
    pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string; position?: number }> }>;
  }>({
    queryKey: ["pipelines"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/pipelines");
      if (!res.ok) throw new Error("Failed to fetch pipelines");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!oppData?.opportunity,
  });

  // ── Contact record (the editable card) ─────────────────────────────────────
  const {
    data: contactData,
    isLoading: contactLoading,
    isError: contactError,
    refetch: refetchContact,
  } = useQuery<ContactResponse>({
    queryKey: ["ghl-contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/contacts/${contactId}`);
      if (!res.ok) return { contact: null };
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 60 * 1000,
  });

  /**
   * ONE GUARD, AT THE SOURCE. `opp` is the opportunity ONLY when it provably belongs to the
   * contact this drawer is showing. Everything downstream — the stage control, the deal value,
   * the pipeline name, and every quick action — therefore cannot reference another client's
   * deal, because it never sees one.
   *
   * Guarding at each use site was the alternative and it is the weaker design: on 2026-08-13 a
   * single unguarded read was enough to PATCH the wrong client's opportunity, which fired GHL's
   * automation and messaged them. Anything failing this check is discarded and the drawer behaves
   * as though the contact has no opportunity, which is the truthful answer.
   */
  const rawOpp = oppData?.opportunity ?? null;
  const opp = rawOpp && rawOpp.contact?.id === contactId ? rawOpp : null;
  const serverStageName = oppData?.stageName ?? opp?.pipelineStageId_name ?? null;
  const displayStageName = localStageName ?? serverStageName;
  const displayStageId = localStageId ?? opp?.pipelineStageId ?? "";

  const pipelineStages = opp
    ? (pipelinesData?.pipelines?.find((p) => p.id === opp.pipelineId)?.stages ?? [])
        .slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : [];

  const pipelineName = opp
    ? pipelinesData?.pipelines?.find((p) => p.id === opp.pipelineId)?.name
    : null;

  const isLoading = oppLoading;

  async function handleStageChange(stageId: string) {
    // `opp` is guarded at the source above. Moving a pipeline stage fires GHL automations that MESSAGE
    // THE CLIENT, so writing to the wrong opportunity messages the wrong person. On 2026-08-13
    // this line ran against `opp.id` while the opportunity lookup had returned a different
    // client's deal: Gage moved Alex (oobi.com.au) to "Demo In Progress" and Schleepi received
    // "your email demo is officially in the works". Refusing to act is always correct here —
    // there is no safe way to guess which deal the user meant.
    if (!opp || stageId === displayStageId) return;
    const stage = pipelineStages.find((s) => s.id === stageId);
    if (!stage) return;
    setSavingStage(true);
    setLocalStageId(stage.id);
    setLocalStageName(stage.name);
    try {
      await fetch(`/api/ghl/opportunities/${opp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineStageId: stage.id }),
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["opportunities"] });
        queryClient.invalidateQueries({ queryKey: ["contact-opportunity", contactId] });
      }, 2000);
    } catch {
      setLocalStageId(opp?.pipelineStageId ?? null);
      setLocalStageName(serverStageName);
    } finally {
      setSavingStage(false);
    }
  }

  // Resolved header name — the freshly fetched record wins over the prop.
  const contact = contactData?.contact ?? null;
  const resolvedName =
    contact?.fullName ||
    [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") ||
    contactName ||
    "";

  return (
    <>
    <div data-r10n-leadsidebar className={cn("w-80 xl:w-[360px] shrink-0 border-l border-border bg-card flex flex-col", ownScroll ? "overflow-y-auto" : "overflow-visible")}>
      {/* Header — contact + stage at a glance */}
      <div className="px-4 py-4 border-b border-border shrink-0">
        <p data-r10n-sidebar-label className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.14em] mb-2.5">Lead details</p>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="w-10 h-10 shrink-0 rounded-full bg-muted/70 border border-border flex items-center justify-center text-[13px] font-semibold text-muted-foreground tracking-tight select-none"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {initials(resolvedName || contactName)}
          </span>
          <div className="min-w-0 flex-1">
            <NameEditor
              contactId={contactId}
              contact={contact}
              fallbackName={contactName}
              onSaved={() => {
                queryClient.invalidateQueries({ queryKey: ["ghl-contact", contactId] });
                queryClient.invalidateQueries({ queryKey: ["ghl-contact-basic", contactId] });
                queryClient.invalidateQueries({ queryKey: ["contact-opportunity", contactId] });
              }}
            />
          </div>
        </div>
        {opp && displayStageName && (
          <div className="mt-3">
            {savingStage ? (
              <span data-r10n-status-pill data-status="open" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-primary/30 bg-primary/5 text-primary">
                <RefreshCw className="w-3 h-3 animate-spin" /> Saving…
              </span>
            ) : (
              <span data-r10n-status-pill data-status={stageStatusTier(displayStageName)} className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border", stageBadgeClass(displayStageName))}>
                {displayStageName}
              </span>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : (
        <div className="flex flex-col">

          {/* ── Pipeline / value ───────────────────────────────── */}
          {opp && (
            <div className="px-4 py-4 space-y-3 border-b border-border/60">
              {/* Deal value — prominent */}
              {opp.monetaryValue != null && opp.monetaryValue > 0 && (
                <div data-r10n-sidebar-card className="flex items-center justify-between rounded-[10px] border border-border/60 bg-muted/20 px-3.5 py-3">
                  <span data-r10n-sidebar-cardlabel className="text-xs text-muted-foreground">Deal value</span>
                  <span data-r10n-sidebar-dealvalue className="text-lg font-bold text-foreground tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
                    ${opp.monetaryValue.toLocaleString()}
                  </span>
                </div>
              )}

              {/* Change stage */}
              <div data-r10n-sidebar-card className="rounded-[10px] border border-border/60 bg-muted/20 px-3 py-2.5">
                <p data-r10n-sidebar-cardlabel className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1.5"><TrendingUp data-r10n-sidebar-cardicon className="w-3 h-3" /> Change stage</p>
                <select
                  value={displayStageId}
                  onChange={(e) => handleStageChange(e.target.value)}
                  disabled={pipelineStages.length === 0 || savingStage}
                  data-r10n-sidebar-select
                  className="w-full text-sm font-medium text-foreground bg-transparent border-none outline-none cursor-pointer appearance-none disabled:opacity-50"
                >
                  {pipelineStages.length === 0 && (
                    <option value={displayStageId}>{displayStageName ?? "Unknown"}</option>
                  )}
                  {pipelineStages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {pipelineName && <p data-r10n-sidebar-meta className="text-[11px] text-muted-foreground px-0.5">{pipelineName}{opp.contact?.companyName ? ` · ${opp.contact.companyName}` : ""}</p>}
            </div>
          )}

          {/* ── No opportunity: offer to create one ─────────────────────────
              Only when we KNOW there is none. `lookupFailed` means the GHL search errored, and
              claiming "not on a pipeline" then would be a confident guess about a client's
              deal. It also stays hidden while loading, so the panel never flashes in front of
              an opportunity that is about to arrive. */}
          {!oppLoading && !oppIsPlaceholder && !oppError && !opp && !oppData?.lookupFailed && contactId && (
            <div className="px-4 py-4 border-b border-border/60">
              <CreateOpportunityPanel
                contactId={contactId}
                contactName={
                  contactName
                  || contactData?.contact?.fullName
                  || [contactData?.contact?.firstName, contactData?.contact?.lastName].filter(Boolean).join(" ")
                  || ""
                }
                defaultSource={contactData?.contact?.source ?? null}
              />
            </div>
          )}

          {/* ── Contact (editable, GHL-style) ──────────────────── */}
          <ContactSection
            contactId={contactId}
            contact={contact}
            website={contactData?.website ?? null}
            loading={contactLoading}
            error={contactError}
            onRetry={() => refetchContact()}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["ghl-contact", contactId] });
              queryClient.invalidateQueries({ queryKey: ["ghl-contact-basic", contactId] });
              queryClient.invalidateQueries({ queryKey: ["contact-opportunity", contactId] });
            }}
          />

          {/* ── Meta lead stage (Leads Centre only) ─────────────── */}
          {/* First decision in the drawer: this is what tells Facebook the lead was good. */}
          {leadId && (
            <div className="px-4 py-4 border-b border-border/60">
              <h4 data-r10n-sidebar-section className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em] mb-2.5">
                Lead management
              </h4>
              <StageSelect
                leadId={leadId}
                value={(metaStage ?? null) as never}
                capiStatus={capiStatus}
                onChanged={onStageChanged}
              />
            </div>
          )}

          {/* Form answers are NOT rendered here. They feed the Qualification section below,
              which is the one Jack picked ("far more beautiful"). Rendering both printed
              every answer twice under two headings. */}

          {/* ── Quick Actions ──────────────────────────────────── */}
          {/* Shown whenever we have a contact (e.g. GHL-synced Instagram DMs that have
              no opportunity yet) — not only when an opportunity exists. */}
          {(contactId || opp) && (
            /* STICKY (Jack, 2026-08-07): these are the actions Gage actually came here to
               perform, and they used to scroll out of view behind the qualification answers.
               `sticky bottom-0` keeps them on screen while the rest of the panel scrolls.
               Needs an opaque background and a TOP border — a transparent sticky bar lets
               the content underneath read straight through it. */
            <div className="sticky bottom-0 z-10 bg-card px-4 py-3 border-t border-border">
              <h4 data-r10n-sidebar-section className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em] mb-2.5">
                Quick actions
              </h4>
              {/* One shared component across every surface. This markup used to be duplicated
                  here and in meta-conversations, which is exactly why "Book" existed on the
                  contact modal and nowhere else. */}
              <QuickActionsBar
                compact
                actions={[
                  { key: "task", label: "Task", onClick: () => setShowCreateTask(true) },
                  { key: "demo", label: "Demo", onClick: () => setShowCreateDemo(true) },
                  { key: "audit", label: "Audit", onClick: () => setShowCreateAudit(true) },
                  { key: "book", label: "Book a call", onClick: () => setShowBooking(true) },
                  // Message opens the full contact modal, which owns the composer — a second
                  // composer in the drawer would be a third place messages can be sent from.
                  ...((onMessage ?? onNameClick)
                    ? [{ key: "message" as const, label: "Message", onClick: (onMessage ?? onNameClick)! }]
                    : []),
                ]}
              />
            </div>
          )}

          {/* ── Qualification Q&A ──────────────────────────────── */}
          {/* Shared resolver: lead-form custom fields first (new + old forms),
              qualification-note fallback for the oldest leads. */}
          <div className="px-4 py-4">
            {/* When the Leads Centre supplies resolved answers, they REPLACE the GHL-derived
                list: those carry the exact question the lead read, GHL's are paraphrases. */}
            {/* Heading stays "Qualification" either way. The form Q&A does not sit BESIDE
                the qualification, it IS the qualification — a second heading is what made
                the same six answers look like twelve. */}
            <QualificationPreview
              contactId={contactId}
              limit={formAnswers?.length ? formAnswers.length : 6}
              items={formAnswers?.length ? formAnswers.map((a) => ({ label: a.question, value: a.answer })) : undefined}
            />
          </div>

        </div>
      )}
    </div>

    {/* Modals — fall back to the contactId prop when there's no opportunity yet
        (GHL-synced Instagram DMs), so Quick Actions work for any contact. */}
    {/* IDENTITY COMES FROM THE CONTACT WE ARE ON, NEVER FROM THE OPPORTUNITY.
        `contactId` is this drawer's own prop — the client whose conversation is open — so it is
        the one thing that cannot be wrong. Every quick action is bound to it directly.

        It used to read `opp?.contact?.id ?? contactId`, which trusted the opportunity lookup
        first. On 2026-08-13 that lookup returned a DIFFERENT client's opportunity (see
        app/api/ghl/contacts/[contactId]/opportunity/route.ts), so Create Demo opened bound to
        Schleepi while Gage was on Alex at oobi.com.au. He corrected the visible brand fields,
        but the contact and opportunity ids underneath were still Schleepi's, and the
        "demo is in the works" message was delivered to Schleepi.

        Email, phone and website now come from the CONTACT record this drawer already loaded and
        displays, not from `opp.contact` — so what the modal prefills is exactly what you can see
        on screen. `opp` is guarded at the source: even if the endpoint ever regresses,
        an opportunity belonging to someone else is discarded rather than used. */}
    {showBooking && contactId && (
      <BookingLinkModal
        contactId={contactId}
        contactName={resolvedName || contactName}
        contactPhone={contact?.phone ?? null}
        contactEmail={contact?.email ?? null}
        onClose={() => setShowBooking(false)}
      />
    )}
    {showCreateTask && (
      <CreateTaskModal
        contactId={contactId}
        contactName={resolvedName || contactName}
        opportunityId={opp?.id}
        onClose={() => setShowCreateTask(false)}
      />
    )}
    {showCreateDemo && (
      <CreateDemoModal
        contactId={contactId}
        contactName={resolvedName || contactName}
        contactEmail={contact?.email ?? undefined}
        contactPhone={contact?.phone ?? undefined}
        defaultWebsite={contactData?.website ?? undefined}
        opportunityId={opp?.id}
        opportunitySource={opp?.source}
        onClose={() => setShowCreateDemo(false)}
      />
    )}
    {showCreateAudit && (
      <CreateAuditModal
        contactId={contactId}
        contactName={resolvedName || contactName}
        onClose={() => setShowCreateAudit(false)}
      />
    )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared PATCH helper — writes a single-field (or tags) change to GHL + mirror.
// Throws on failure so callers can revert their optimistic state.
// ─────────────────────────────────────────────────────────────────────────────
async function patchContact(contactId: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/ghl/contacts/${contactId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Save failed");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Name editor — the header name, click-to-edit, splits into first/last on save.
// ─────────────────────────────────────────────────────────────────────────────
function NameEditor({
  contactId,
  contact,
  fallbackName,
  onSaved,
  onNameClick,
}: {
  contactId: string;
  contact: ContactRecord | null;
  fallbackName: string;
  onSaved: () => void;
  /**
   * When set, clicking the NAME opens the full contact record instead of starting an inline
   * rename; the pencil becomes the rename affordance. The Leads Centre wants the name to be
   * a way into the contact modal, while the Inbox keeps click-to-rename. Both, not either.
   */
  onNameClick?: () => void;
}) {
  const serverName =
    contact?.fullName ||
    [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") ||
    fallbackName ||
    "";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(serverName);
  const [state, setState] = useState<SaveState>("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the input synced with fresh server data while not actively editing.
  useEffect(() => {
    if (!editing) setValue(serverName);
  }, [serverName, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    const next = value.trim();
    setEditing(false);
    if (next === serverName || !next) {
      setValue(serverName);
      return;
    }
    const parts = next.split(/\s+/);
    const firstName = parts.shift() ?? "";
    const lastName = parts.join(" ");
    setState("saving");
    try {
      await patchContact(contactId, { firstName, lastName });
      setState("saved");
      onSaved();
      setTimeout(() => setState("idle"), 1400);
    } catch {
      setState("error");
      setValue(serverName);
      setTimeout(() => setState("idle"), 2200);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setValue(serverName); setEditing(false); }
        }}
        className="w-full text-[15px] font-bold text-foreground tracking-[-0.01em] bg-transparent border-b border-primary/60 outline-none pb-0.5"
        style={{ fontFamily: "var(--font-heading)" }}
        placeholder="Contact name"
      />
    );
  }

  return (
    <div className="group/name flex items-center gap-1.5 min-w-0">
      <button
        type="button"
        onClick={() => (onNameClick ? onNameClick() : setEditing(true))}
        title={onNameClick ? "Open contact record" : "Edit name"}
        className="min-w-0 text-left rounded focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-green)]"
      >
        <span data-r10n-sidebar-name className="block text-[15px] font-bold text-foreground tracking-[-0.01em] truncate group-hover/name:text-primary transition-colors" style={{ fontFamily: "var(--font-heading)" }}>
          {serverName || "Unnamed contact"}
        </span>
      </button>
      {state === "saving" ? (
        <RefreshCw className="w-3 h-3 shrink-0 text-muted-foreground animate-spin" />
      ) : state === "saved" ? (
        <Check className="w-3 h-3 shrink-0 text-emerald-500" />
      ) : state === "error" ? (
        <AlertCircle className="w-3 h-3 shrink-0 text-red-500" />
      ) : onNameClick ? (
        // The name is taken by the contact modal, so renaming needs its own control.
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Rename contact"
          title="Rename"
          className="shrink-0 p-0.5 rounded text-muted-foreground/0 group-hover/name:text-muted-foreground/70 hover:!text-foreground transition-colors
                     focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-green)] focus-visible:text-muted-foreground"
        >
          <Pencil className="w-3 h-3" />
        </button>
      ) : (
        <Pencil className="w-3 h-3 shrink-0 text-muted-foreground/0 group-hover/name:text-muted-foreground/70 transition-colors" />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact section — the light, airy, GHL-style editable card.
// ─────────────────────────────────────────────────────────────────────────────
interface FieldConfig {
  key: FieldKey;
  label: string;
  icon: typeof Mail;
  value: string;
  type: "email" | "tel" | "url" | "text";
  placeholder: string;
}

function ContactSection({
  contactId,
  contact,
  website,
  loading,
  error,
  onRetry,
  onSaved,
}: {
  contactId: string;
  contact: ContactRecord | null;
  website: string | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSaved: () => void;
}) {
  // Reveal-blanks toggle: shows empty fields as editable inputs.
  const [showAll, setShowAll] = useState(false);
  // Tracks fields the rep filled this session so they stay visible after save.
  const [revealed, setRevealed] = useState<Set<FieldKey>>(new Set());

  // Website prefers the derived clean URL; falls back to nothing.
  const websiteValue = (website || "").trim();

  const allFields: FieldConfig[] = useMemo(() => [
    { key: "email", label: "Email", icon: Mail, value: (contact?.email || "").trim(), type: "email", placeholder: "name@company.com" },
    { key: "phone", label: "Phone", icon: Phone, value: (contact?.phone || "").trim(), type: "tel", placeholder: "+1 555 000 0000" },
    { key: "website", label: "Website", icon: Globe, value: websiteValue, type: "url", placeholder: "company.com" },
    { key: "companyName", label: "Company", icon: Building2, value: (contact?.companyName || "").trim(), type: "text", placeholder: "Company name" },
    { key: "address", label: "Street", icon: MapPin, value: (contact?.address1 || "").trim(), type: "text", placeholder: "Street address" },
    { key: "city", label: "City", icon: MapPin, value: (contact?.city || "").trim(), type: "text", placeholder: "City" },
    { key: "state", label: "State", icon: MapPin, value: (contact?.state || "").trim(), type: "text", placeholder: "State / region" },
    { key: "country", label: "Country", icon: MapPin, value: (contact?.country || "").trim(), type: "text", placeholder: "Country" },
  ], [contact, websiteValue]);

  const populated = allFields.filter((f) => f.value);
  const blanks = allFields.filter((f) => !f.value);
  const source = (contact?.source || "").trim();

  // Which fields to actually render: populated always; blanks only when revealed.
  const visible = allFields.filter((f) => f.value || showAll || revealed.has(f.key));

  if (loading) {
    return (
      <div className="px-4 py-4 border-b border-border/60 space-y-3">
        <h4 data-r10n-sidebar-section className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">Contact</h4>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5 animate-pulse">
            <span className="w-4 h-4 rounded bg-muted" />
            <span className="h-3.5 rounded bg-muted flex-1" style={{ maxWidth: `${70 - i * 12}%` }} />
          </div>
        ))}
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="px-4 py-4 border-b border-border/60">
        <h4 data-r10n-sidebar-section className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em] mb-2.5">Contact</h4>
        <div className="flex items-center justify-between gap-2 rounded-[9px] border border-border/60 bg-muted/20 px-3 py-2.5">
          <span className="text-xs text-muted-foreground">Couldn’t load contact details</span>
          <button onClick={onRetry} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 border-b border-border/60">
      <div className="flex items-center justify-between mb-2.5">
        <h4 data-r10n-sidebar-section className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">Contact</h4>
        {blanks.length > 0 && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" /> Add details
          </button>
        )}
      </div>

      {visible.length === 0 && populated.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No contact details yet.</p>
      ) : (
        <div className="space-y-0.5">
          {visible.map((f) => (
            <FieldRow
              key={f.key}
              contactId={contactId}
              config={f}
              onSaved={() => { setRevealed((prev) => new Set(prev).add(f.key)); onSaved(); }}
            />
          ))}
        </div>
      )}

      {/* Demo Link — writes GHL's "Insert Miro Link", which fires their workflow */}
      <DemoLinkField contactId={contactId} className="mt-3" />

      {/* Tags — chips with add + remove */}
      <TagsEditor
        contactId={contactId}
        tags={contact.tags ?? []}
        onSaved={onSaved}
      />

      {/* Source — read-only display when present */}
      {source && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span data-r10n-sidebar-cardlabel className="uppercase tracking-[0.08em] text-[10px]">Source</span>
          <span className="font-medium text-foreground/80 truncate">{source}</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single inline-editable field row. Click → input; Enter/blur → PATCH.
// Optimistic local value with per-field saving/saved/failed + revert on failure.
// ─────────────────────────────────────────────────────────────────────────────
function FieldRow({
  contactId,
  config,
  onSaved,
}: {
  contactId: string;
  config: FieldConfig;
  onSaved: () => void;
}) {
  const { key, label, icon: Icon, type, placeholder } = config;
  const serverValue = config.value;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(serverValue);
  const [display, setDisplay] = useState(serverValue); // optimistic shown value
  const [state, setState] = useState<SaveState>("idle");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync from server when not editing (fresh data after invalidation).
  useEffect(() => {
    if (!editing && state !== "saving") {
      setValue(serverValue);
      setDisplay(serverValue);
    }
  }, [serverValue, editing, state]);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  async function commit() {
    const next = value.trim();
    setEditing(false);
    if (next === display) return;
    setDisplay(next); // optimistic
    setState("saving");
    try {
      await patchContact(contactId, { [key]: next });
      setState("saved");
      onSaved();
      setTimeout(() => setState("idle"), 1400);
    } catch {
      setState("error");
      setDisplay(serverValue); // revert
      setValue(serverValue);
      setTimeout(() => setState("idle"), 2400);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  }

  const StatusIcon =
    state === "saving" ? <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />
    : state === "saved" ? <Check className="w-3 h-3 text-emerald-500" />
    : state === "error" ? <AlertCircle className="w-3 h-3 text-red-500" />
    : null;

  return (
    <div className="group/field flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 -mx-1.5 hover:bg-muted/40 transition-colors">
      <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />

      <div className="min-w-0 flex-1">
        <p data-r10n-sidebar-cardlabel className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70 leading-none mb-1">{label}</p>

        {editing ? (
          <input
            ref={inputRef}
            value={value}
            type={type === "url" ? "text" : type}
            inputMode={type === "tel" ? "tel" : type === "email" ? "email" : undefined}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { setValue(display); setEditing(false); }
            }}
            placeholder={placeholder}
            className="w-full text-[13px] font-medium text-foreground bg-transparent border-b border-primary/60 outline-none pb-0.5 leading-tight"
          />
        ) : display ? (
          <div className="flex items-center gap-1.5 min-w-0">
            {type === "url" ? (
              <a
                href={externalHref(display)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-medium text-primary hover:underline truncate leading-tight"
                onClick={(e) => e.stopPropagation()}
              >
                {display.replace(/^https?:\/\//i, "")}
              </a>
            ) : type === "tel" ? (
              <a
                href={telHref(display)}
                className="text-[13px] font-medium text-foreground hover:text-primary truncate leading-tight"
                onClick={(e) => e.stopPropagation()}
              >
                {display}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[13px] font-medium text-foreground hover:text-primary truncate leading-tight text-left"
              >
                {display}
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[13px] text-muted-foreground/60 hover:text-primary italic leading-tight"
          >
            Add {label.toLowerCase()}
          </button>
        )}
      </div>

      {/* Trailing controls: status → copy (email/phone) → edit pencil (hover) */}
      <div className="flex items-center gap-1 shrink-0">
        {StatusIcon}
        {!editing && display && (type === "email" || type === "tel") && (
          <button
            type="button"
            onClick={copy}
            title={`Copy ${label.toLowerCase()}`}
            className="p-1 rounded text-muted-foreground/0 group-hover/field:text-muted-foreground/70 hover:!text-primary transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
        {!editing && display && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title={`Edit ${label.toLowerCase()}`}
            className="p-1 rounded text-muted-foreground/0 group-hover/field:text-muted-foreground/70 hover:!text-primary transition-colors"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tags editor — chips with remove (x) + type-and-enter add. Saves the full array.
// ─────────────────────────────────────────────────────────────────────────────
function TagsEditor({
  contactId,
  tags,
  onSaved,
}: {
  contactId: string;
  tags: string[];
  onSaved: () => void;
}) {
  const [local, setLocal] = useState<string[]>(tags);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  // Resync when server tags change (after invalidation), unless mid-save.
  useEffect(() => {
    if (state !== "saving") setLocal(tags);
  }, [tags, state]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  async function save(next: string[]) {
    const prev = local;
    setLocal(next); // optimistic
    setState("saving");
    try {
      await patchContact(contactId, { tags: next });
      setState("saved");
      onSaved();
      setTimeout(() => setState("idle"), 1400);
    } catch {
      setState("error");
      setLocal(prev); // revert
      setTimeout(() => setState("idle"), 2400);
    }
  }

  function addTag() {
    const t = draft.trim();
    setDraft("");
    setAdding(false);
    if (!t) return;
    if (local.some((x) => x.toLowerCase() === t.toLowerCase())) return; // no dupes
    save([...local, t]);
  }

  function removeTag(tag: string) {
    save(local.filter((x) => x !== tag));
  }

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <div className="flex items-center justify-between mb-1.5">
        <p data-r10n-sidebar-cardlabel className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 flex items-center gap-1.5">
          <Tag className="w-3 h-3" /> Tags
        </p>
        {state === "saving" ? <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />
          : state === "saved" ? <Check className="w-3 h-3 text-emerald-500" />
          : state === "error" ? <AlertCircle className="w-3 h-3 text-red-500" />
          : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {local.map((tag) => (
          <span
            key={tag}
            data-r10n-sidebar-tag
            className="group/tag inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs rounded-full bg-primary/10 text-primary font-medium"
          >
            <span className="truncate max-w-[10rem]">{tag}</span>
            <button
              type="button"
              onClick={() => removeTag(tag)}
              title="Remove tag"
              className="rounded-full p-0.5 hover:bg-primary/20 transition-colors"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}

        {adding ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={addTag}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addTag(); }
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
            placeholder="New tag"
            className="text-xs bg-transparent border-b border-primary/60 outline-none py-0.5 w-24 text-foreground"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
          >
            <Plus className="w-2.5 h-2.5" /> Add
          </button>
        )}
      </div>
    </div>
  );
}
