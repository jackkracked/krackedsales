"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, AlertTriangle, ChevronRight, Inbox, X } from "lucide-react";
import { StageSelect, STAGE_LABEL } from "./stage-select";
import { LeadDetailsSidebar } from "@/components/inbox/lead-details-sidebar";
import { ContactModal } from "@/components/contacts/contact-modal";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";
import { META_LEAD_STAGES, type MetaLeadStage } from "@/lib/db/schema";
import type { UnifiedContact } from "@/lib/contacts/types";

/**
 * Leads Centre.
 *
 * Built on the SAME table system as Proposals, deliberately and to the class. The first cut
 * invented its own — `align-top` cells, un-tracked headers, a bare search input — and read as
 * a different, worse product. PRODUCT.md principle 3: "Confidence through consistency.
 * Inconsistency signals fragility." A second table vocabulary in one app is that fragility.
 *
 * Density is a feature here (PRODUCT.md: "Data is the UI"). This is a queue Gage works daily,
 * not a surface to browse.
 */

type Tab = "form" | "comments";

interface Answer {
  question: string;
  answer: string;
  /** form = verbatim from the Meta form this lead submitted. crm = a GHL field, shown apart. */
  source: "form" | "crm";
}

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string | null;
  stage: MetaLeadStage | null;
  capi: { status: string | null; sentAt: string | null; error: string | null };
  metaLeadId: string | null;
  source: string;
  campaign: string | null;
  adName: string | null;
  formName: string | null;
  answers: Answer[];
}

interface CommentLead {
  id: string;
  name: string;
  platform: string;
  commentText: string;
  keyword: string;
  email: string | null;
  promoted: boolean;
  createdAt: string | null;
}

export function LeadsClient() {
  const [tab, setTab] = useState<Tab>("form");
  const [stage, setStage] = useState("all");
  const [search, setSearch] = useState("");
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [page, setPage] = useState(0);
  const qc = useQueryClient();

  const params = new URLSearchParams({ tab, page: String(page) });
  if (stage !== "all") params.set("stage", stage);
  if (search) params.set("q", search);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["leads", tab, stage, search, page],
    placeholderData: (prev: unknown) => prev, // no flash back to skeleton when paging
    queryFn: async () => {
      const res = await fetch(`/api/leads?${params}`);
      if (!res.ok) throw new Error("Could not load leads");
      return res.json();
    },
  });

  const counts: Record<string, number> = useMemo(() => data?.counts ?? {}, [data]);
  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["leads"] });

  // Pager readout. Must match PAGE_SIZE in app/api/leads/route.ts.
  const PAGE_SIZE = 50;
  const rowsShown: number = data?.leads?.length ?? 0;
  const shownFrom = page * PAGE_SIZE + 1;
  const shownTo = page * PAGE_SIZE + rowsShown;
  // The denominator is the FILTERED population, not the grand total: on "Qualified" the
  // honest readout is "1-50 of 59", never "of 553". Comment leads have no count endpoint,
  // so they show a range with no total rather than a wrong one.
  const pageTotal: number | null =
    tab !== "form" ? null : stage === "all" ? total : counts[stage] ?? 0;

  return (
    <div className="flex flex-col h-full gap-5 overflow-hidden">
      {/* Tabs — Form Leads vs Comment Leads.
          These lead the page. The strip and rail below describe the Form Leads tab only, so
          rendering them ABOVE the tabs made the whole header vanish (and the tabs jump up the
          page) the moment you switched to Comment Leads. */}
      <div className="flex items-center gap-1 border-b border-border shrink-0">
        {([
          { key: "form" as Tab, label: "Form Leads", n: total },
          { key: "comments" as Tab, label: "Comment Leads", n: undefined },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setStage("all"); setPage(0); }}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "px-3 py-2 text-sm -mb-px border-b-2 transition-colors duration-150",
              "focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent-green)]",
              tab === t.key
                ? "border-[var(--accent-green)] text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.n != null ? <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{t.n}</span> : null}
          </button>
        ))}
      </div>

      {tab === "form" ? (
        <>
          <MetricStrip counts={counts} total={total} active={stage} onSelect={(k) => { setStage(k); setPage(0); }} />
          <StageRail counts={counts} total={total} active={stage} onSelect={(k) => { setStage(k); setPage(0); }} />
        </>
      ) : null}

      {/* Toolbar — the app's canonical search field. The stage list used to live here as a
          native <select>, which rendered the OS popup: the one control on the page that was
          not the product. It is the rail above now. */}
      <div className="flex items-center gap-2.5 flex-wrap shrink-0">
        <SearchField value={search} onChange={(v) => { setSearch(v); setPage(0); }} />
      </div>

      {/* Table — the Proposals card shell */}
      <div className="flex-1 min-h-0 bg-card border border-border rounded-[10px] overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <SkeletonRows />
          ) : isError ? (
            <ErrorState onRetry={() => refetch()} />
          ) : tab === "form" ? (
            <FormTable leads={data?.leads ?? []} onOpen={setOpenLead} onStageChanged={refresh} />
          ) : (
            <CommentTable leads={data?.leads ?? []} />
          )}
        </div>

        {/*
          Pager, INSIDE the card footer.
          It used to sit outside the card, full-width, with Next pinned to the far right by
          `justify-between` — directly underneath the floating assistant bubble, which covered
          it completely. With 553 leads over 12 pages the control existed and simply could not
          be clicked, which reads as "there is only one page".
          Now: the range readout on the left, both buttons grouped on the right, and `pr-14`
          keeps them clear of anything floating in the corner.
        */}
        {!isLoading && !isError && rowsShown > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 pr-14 shrink-0 bg-card">
            <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {shownFrom.toLocaleString()}–{shownTo.toLocaleString()}
              {pageTotal != null ? ` of ${pageTotal.toLocaleString()}` : ""}
            </span>
            <div className="flex items-center gap-1.5">
              <PageButton onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                Previous
              </PageButton>
              <span className="px-1 text-xs text-muted-foreground tabular-nums">Page {page + 1}</span>
              <PageButton onClick={() => setPage((p) => p + 1)} disabled={!data?.hasMore}>
                Next
              </PageButton>
            </div>
          </div>
        ) : null}
      </div>

      {openLead ? (
        <LeadDrawer
          /* Drive off live query data, not the snapshot captured at click time, so the
             drawer never shows a stage the database has moved past. */
          lead={(data?.leads ?? []).find((l: Lead) => l.id === openLead.id) ?? openLead}
          onClose={() => setOpenLead(null)}
          onChanged={refresh}
        />
      ) : null}
    </div>
  );
}

/**
 * The headline numbers, in the Proposals stats vocabulary.
 *
 * Clicking one filters the table to that stage — Jack's call: the strip replaces the old
 * stage rail, and the Status dropdown in the toolbar carries the stages not shown here.
 *
 * Conversion rate is deliberately NOT clickable: it is a ratio, not a population, and a filter
 * that silently means something different from its neighbours is worse than no filter.
 */
function MetricStrip({
  counts, total, active, onSelect,
}: {
  counts: Record<string, number>;
  total: number;
  active: string;
  onSelect: (key: string) => void;
}) {
  const converted = counts.converted ?? 0;
  // Denominator is every triaged lead, not every lead: with 553 untriaged, dividing by total
  // would read 0.2% and look broken when it actually means "nobody has triaged yet".
  const triaged = total - (counts.untriaged ?? 0);
  const rate = triaged > 0 ? `${((converted / triaged) * 100).toFixed(1)}%` : "—";

  const metrics: { key: string | null; label: string; value: string | number }[] = [
    { key: "all", label: "Total leads", value: total },
    { key: "intake", label: "Intake", value: counts.intake ?? 0 },
    { key: "converted", label: "Converted", value: converted },
    { key: null, label: "Conversion rate", value: rate },
  ];

  return (
    /* No bottom rule here: the stage rail directly below carries one, and two horizontal
       rules 20px apart reads as a boxed-in header rather than a header. */
    <div className="flex items-center gap-0 text-sm shrink-0 flex-wrap -mb-1">
      {metrics.map((m, i) => {
        const isActive = m.key != null && active === m.key;
        const body = (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {m.label}
            </span>
            <span
              className="text-xl font-bold text-foreground tabular-nums"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {m.value}
            </span>
          </>
        );
        return (
          <div key={m.label} className={cn("flex items-center", i > 0 && "pl-4 border-l border-border ml-4")}>
            {m.key ? (
              <button
                onClick={() => onSelect(m.key!)}
                aria-pressed={isActive}
                title={`Show ${m.label.toLowerCase()}`}
                className={cn(
                  "flex items-center gap-3 rounded-[8px] px-2 py-1 -mx-2 -my-1 transition-colors duration-150",
                  "hover:bg-muted focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-green)]",
                  isActive && "bg-muted",
                )}
              >
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-2 py-1 -mx-2 -my-1">{body}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The stage rail — Meta's Leads Centre funnel, in Kracked's vocabulary.
 *
 * This is the structure Gage already reads every day:
 *   All | Untriaged  ·  Intake › Need More Info › Qualified › Disqualified › Converted › …
 * The chevrons are the point: they say this is one funnel in order, not seven unrelated
 * filters. Section 6 of the shape brief specified it; the first cut shipped a native <select>
 * instead, which both hid the counts and rendered the OS popup inside the product.
 *
 * `All` and `Untriaged` sit before a divider because they are not funnel positions — they are
 * "everything" and "nobody has touched this yet". Meta separates its All/Unread the same way.
 *
 * Driven off META_LEAD_STAGES so the rail cannot drift from the stages the API accepts.
 */
function StageRail({
  counts, total, active, onSelect,
}: {
  counts: Record<string, number>;
  total: number;
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by stage"
      // Seven stages plus two leaders overflow a narrow window. Scrolling the rail keeps the
      // funnel on one line; wrapping it would break the left-to-right reading of the order.
      className="shrink-0 overflow-x-auto border-b border-border pb-3 -mb-1"
    >
      <div className="flex items-center gap-0.5 min-w-max">
        <RailChip label="All" n={total} active={active === "all"} onClick={() => onSelect("all")} />
        <RailChip
          label="Untriaged"
          n={counts.untriaged ?? 0}
          active={active === "untriaged"}
          onClick={() => onSelect("untriaged")}
        />
        <span className="mx-2 h-4 w-px bg-border shrink-0" aria-hidden />
        {META_LEAD_STAGES.map((s, i) => (
          <Fragment key={s}>
            {i > 0 ? (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/35 shrink-0" aria-hidden />
            ) : null}
            <RailChip
              label={STAGE_LABEL[s]}
              n={counts[s] ?? 0}
              active={active === s}
              onClick={() => onSelect(s)}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function RailChip({
  label, n, active, onClick,
}: { label: string; n: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-sm whitespace-nowrap shrink-0",
        "transition-colors duration-150",
        "focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-green)]",
        active
          ? "bg-muted text-foreground font-medium"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span>{label}</span>
      {/* Zero stays visible rather than being hidden: "Disqualified 0" is information, and a
          disappearing count would make the rail change width as leads are triaged. */}
      <span className={cn("text-xs tabular-nums", active ? "text-foreground" : "text-muted-foreground/70")}>
        {n}
      </span>
    </button>
  );
}

/** The app's canonical search field (contacts-client), not a bare input. */
function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className={cn("relative flex items-center transition-all duration-200", value ? "w-72" : "w-60 focus-within:w-72")}>
      <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, email or phone…"
        aria-label="Search leads"
        className="w-full pl-8 pr-7 py-1.5 text-sm border border-border rounded-[8px] bg-card
                   placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/15
                   focus:border-primary/40 transition-all"
      />
      {value ? (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 p-0.5 rounded text-muted-foreground hover:text-foreground"
        >
          <X className="w-3 h-3" />
        </button>
      ) : null}
    </div>
  );
}

function FormTable({
  leads, onOpen, onStageChanged,
}: { leads: Lead[]; onOpen: (l: Lead) => void; onStageChanged: () => void }) {
  if (!leads.length) {
    return <EmptyState title="No leads in this stage" hint="Change the stage filter above, or clear your search." />;
  }
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-card">
        <tr className="border-b border-border">
          <Th>Date</Th><Th>Name</Th><Th>Stage</Th><Th>Source</Th><Th>Campaign</Th><Th>Signal</Th>
        </tr>
      </thead>
      <tbody>
        {leads.map((l) => (
          <tr
            key={l.id}
            onClick={() => onOpen(l)}
            className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors duration-100 cursor-pointer"
          >
            <Td className="text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(l.createdAt)}</Td>
            <Td>
              <div className="flex items-center gap-2.5">
                <Avatar name={l.name} size={28} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate leading-tight max-w-[15rem]" title={l.name}>
                    {l.name}
                  </p>
                  {l.email ? (
                    <p className="text-xs text-muted-foreground truncate leading-tight max-w-[15rem]">{l.email}</p>
                  ) : null}
                </div>
              </div>
            </Td>
            {/* The stage control owns its own clicks: opening the drawer underneath a dropdown
                would fight the user on the single most important action on the page. */}
            <Td onClick={(e) => e.stopPropagation()}>
              <StageSelect leadId={l.id} value={l.stage} capiStatus={l.capi?.status} onChanged={onStageChanged} compact />
            </Td>
            <Td className="text-muted-foreground">{l.source}</Td>
            <Td className="text-muted-foreground" title={l.campaign ?? ""}>
              <span className="block truncate max-w-[16rem]">{l.campaign ?? "—"}</span>
            </Td>
            <Td><SignalBadge capi={l.capi} hasLeadId={Boolean(l.metaLeadId)} /></Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CommentTable({ leads }: { leads: CommentLead[] }) {
  if (!leads.length) {
    return <EmptyState title="No comment leads" hint="Comment leads arrive when someone comments a trigger keyword on an ad or post." />;
  }
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-card">
        <tr className="border-b border-border">
          <Th>Date</Th><Th>Name</Th><Th>Platform</Th><Th>Keyword</Th><Th>Comment</Th><Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {leads.map((l) => (
          <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors duration-100">
            <Td className="text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(l.createdAt)}</Td>
            <Td>
              <div className="flex items-center gap-2.5">
                <Avatar name={l.name} size={28} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate leading-tight max-w-[14rem]">{l.name}</p>
                  {l.email ? (
                    <p className="text-xs text-muted-foreground truncate leading-tight max-w-[14rem]">{l.email}</p>
                  ) : null}
                </div>
              </div>
            </Td>
            <Td className="text-muted-foreground capitalize">{l.platform}</Td>
            <Td className="text-muted-foreground">{l.keyword}</Td>
            <Td className="text-muted-foreground" title={l.commentText}>
              <span className="block truncate max-w-[22rem]">{l.commentText}</span>
            </Td>
            <Td>
              {l.promoted
                ? <span className="text-xs font-medium text-[var(--accent-green)]">In pipeline</span>
                : <span className="text-xs text-muted-foreground">Not in pipeline</span>}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Whether Meta was actually told. The whole point of the feature. */
function SignalBadge({ capi, hasLeadId }: { capi: Lead["capi"]; hasLeadId: boolean }) {
  if (!capi?.status) return <span className="text-xs text-muted-foreground/40">—</span>;
  // Came from Meta's own Leads Centre at cutover, so Meta is the source of this stage and no
  // event was sent. Shown plainly: a blank here would read as "we forgot to tell Facebook".
  if (capi.status === "imported") {
    return (
      <span className="text-xs text-muted-foreground" title={capi.error ?? "Imported from Meta Leads Centre"}>
        From Meta
      </span>
    );
  }
  if (capi.status === "sent") {
    return (
      <span
        className="text-xs font-medium text-[var(--accent-green)]"
        title={hasLeadId ? "Sent with Meta's exact lead ID" : "Sent, matched on email and phone"}
      >
        Sent{hasLeadId ? "" : " (approx)"}
      </span>
    );
  }
  if (capi.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600" title={capi.error ?? ""}>
        <AlertTriangle className="h-3 w-3" aria-hidden /> Not sent
      </span>
    );
  }
  // A misconfiguration must NOT look like a deliberate no-op. The first means every signal
  // is silently dead; the second is by design for internal triage stages.
  const misconfigured = /not configured|no Meta access token/i.test(capi.error ?? "");
  if (misconfigured) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-600" title={capi.error ?? ""}>
        <AlertTriangle className="h-3 w-3" aria-hidden /> Not configured
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground" title={capi.error ?? ""}>No event</span>;
}

/**
 * The lead drawer.
 *
 * This is the app's EXISTING right-hand drawer (`LeadDetailsSidebar`), not a new one — it
 * already carries Create Demo / Create Task / Create Audit, the editable contact fields and
 * the GHL pipeline stage, all of which a bespoke drawer would have duplicated and then drifted
 * from. Only the slide-over shell is local: in the Inbox the sidebar is a docked column.
 *
 * `local_contacts.id` IS the GHL contact id, so it is the right value for `contactId`.
 */
function LeadDrawer({ lead, onClose, onChanged }: { lead: Lead; onClose: () => void; onChanged: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const [contact, setContact] = useState<UnifiedContact | null>(null);
  const [loadingContact, setLoadingContact] = useState(false);

  // Escape closes, and focus moves into the panel — a drawer you can open by keyboard but not
  // close by keyboard is a trap. Skipped while the contact modal is up, which owns Escape.
  useEffect(() => {
    if (contact) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, contact]);

  /**
   * Clicking the name (or Message) opens the full contact modal (Jack, 2026-08-07).
   *
   * The modal needs a UnifiedContact, which /api/contacts assembles rather than stores, so we
   * still fetch through that endpoint — hand-building one here would mean inventing a dozen
   * fields (opportunity, demo, proposal, audit state) and every one would be a guess.
   *
   * RESOLVED BY ID, EXACTLY. `?uid=ghl_<contactId>` returns this contact or nothing.
   *
   * It used to search by `lead.email ?? lead.name` and then fall back to
   * `?? body.contacts?.[0]` when the uid was not on the page. That is the 2026-08-13 incident
   * pattern: a lead with no email is searched BY NAME, the 50-result page comes back full of
   * other people, the lead's own row is not among them, and the first stranger is opened
   * instead. This modal renders a live message composer bound to whichever contact it is given,
   * so the rep would have been typing into someone else's conversation. 483 contacts in this
   * CRM share an exact full name with somebody else.
   *
   * If the id does not resolve, we surface nothing and log. Opening the wrong client is never
   * better than opening none.
   */
  async function openContact() {
    if (loadingContact) return;
    setLoadingContact(true);
    try {
      const res = await fetch(`/api/contacts?uid=${encodeURIComponent(`ghl_${lead.id}`)}&pageSize=1`);
      if (!res.ok) throw new Error(`contacts lookup failed (${res.status})`);
      const body = (await res.json()) as { contacts?: UnifiedContact[] };
      const match = body.contacts?.find((c) => c.uid === `ghl_${lead.id}`) ?? null;
      if (!match) {
        console.warn(`[leads] no contact found for ghl_${lead.id} — not opening a substitute.`);
      }
      setContact(match);
    } catch (err) {
      console.error("[leads] could not open contact modal:", err);
    } finally {
      setLoadingContact(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-foreground/20 z-40 animate-fade-in" onClick={onClose} aria-hidden />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Lead: ${lead.name}`}
        tabIndex={-1}
        /* The project's own utilities, not `animate-in slide-in-from-right`: this is Tailwind
           v4 with no tailwindcss-animate plugin, so those classes are silent no-ops. These
           are real, and already opt out under prefers-reduced-motion. */
        className="fixed right-0 top-0 h-full z-50 flex bg-card shadow-2xl outline-none animate-slide-in-right"
      >
        <div className="flex flex-col h-full w-80 xl:w-[360px]">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <button
              onClick={openContact}
              disabled={loadingContact}
              title="Open the full contact record"
              className="text-sm font-medium text-foreground truncate max-w-[15rem] text-left rounded
                         hover:underline disabled:opacity-60
                         focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-green)]"
            >
              {lead.name}
            </button>
            <button
              onClick={onClose}
              aria-label="Close lead details"
              className="p-1.5 rounded-[8px] text-muted-foreground transition-colors duration-150 shrink-0
                         hover:bg-muted hover:text-foreground
                         focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-green)]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            <div className="flex-1 flex">
              <LeadDetailsSidebar
                contactId={lead.id}
                contactName={lead.name}
                leadId={lead.id}
                metaStage={lead.stage}
                capiStatus={lead.capi?.status}
                /* The form Q&A IS the qualification — one section, not two.
                   Previously this prop was withheld and the answers rendered in a separate
                   "Form answers" block below, which showed every answer TWICE: once under
                   GHL's paraphrased field labels ("Open text field", "Revenue range") and
                   once under the real question the lead actually read. Passing them here
                   makes the exact Meta questions replace GHL's paraphrases in the single
                   Qualification section, and the duplicate block is gone.
                   When a lead has no resolvable form questions the sidebar still falls back
                   to the GHL-derived list on its own, so nothing is lost. */
                formAnswers={lead.answers.filter((a) => a.source === "form")}
                onNameClick={openContact}
                onMessage={openContact}
                /* The drawer owns the scrolling here; a second scroller inside would stop
                   the sticky quick-action bar from ever pinning. */
                ownScroll={false}
                onStageChanged={onChanged}
              />
            </div>

            {/* Where the lead came from. Meta-only, so it has no place in the shared sidebar. */}
            <div className="shrink-0 border-t border-border px-4 py-4">
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em] mb-2.5">
                Source
              </h3>
              <Row label="Channel" value={lead.source} />
              <Row label="Campaign" value={lead.campaign} />
              <Row label="Ad" value={lead.adName} />
              <Row label="Form" value={lead.formName} />
              <p className="text-xs text-muted-foreground mt-2.5 leading-relaxed">
                {lead.metaLeadId
                  ? "Meta lead ID on file — qualification matches exactly."
                  : "No Meta lead ID — qualification matches on email and phone."}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {contact ? <ContactModal contact={contact} onClose={() => setContact(null)} /> : null}
    </>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </th>
);

const Td = ({
  children, className = "", title, onClick,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void;
}) => (
  <td className={cn("px-4 py-3", className)} title={title} onClick={onClick}>
    {children}
  </td>
);

const Row = ({ label, value }: { label: string; value: string | null }) => (
  <div className="flex justify-between gap-3 text-sm py-0.5">
    <span className="text-muted-foreground shrink-0">{label}</span>
    <span className="text-right truncate" title={value ?? ""}>{value ?? "—"}</span>
  </div>
);

const PageButton = ({
  children, onClick, disabled,
}: { children: React.ReactNode; onClick: () => void; disabled: boolean }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="px-2.5 py-1 rounded-[8px] border border-border transition-colors duration-150
               hover:bg-muted disabled:opacity-40 disabled:pointer-events-none
               focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-green)]"
  >
    {children}
  </button>
);

/** Skeletons, not spinners — the product reference is explicit about this. */
const SkeletonRows = () => (
  <div className="p-4 flex flex-col gap-3" aria-busy="true" aria-label="Loading leads">
    {Array.from({ length: 10 }).map((_, i) => (
      <div key={i} className="h-9 rounded-[8px] bg-muted/60 animate-pulse" />
    ))}
  </div>
);

/** Teaches the interface rather than saying "nothing here" — PRODUCT.md principle 5. */
const EmptyState = ({ title, hint }: { title: string; hint: string }) => (
  <div className="px-4 py-16 text-center">
    <Inbox className="w-8 h-8 mx-auto text-muted-foreground/30 mb-3" aria-hidden />
    <p className="text-sm font-medium text-foreground">{title}</p>
    <p className="text-sm text-muted-foreground mt-1">{hint}</p>
  </div>
);

const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <div className="px-4 py-16 text-center" role="alert">
    <AlertTriangle className="w-8 h-8 mx-auto text-amber-600/60 mb-3" aria-hidden />
    <p className="text-sm font-medium text-foreground">Could not load leads</p>
    <button
      onClick={onRetry}
      className="mt-3 text-sm font-medium text-primary hover:text-primary/80 transition-colors
                 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-green)]"
    >
      Try again
    </button>
  </div>
);

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
