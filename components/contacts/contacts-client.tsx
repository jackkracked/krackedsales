"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import {
  Search, X, ChevronUp, ChevronDown, Download, Tag, RefreshCw,
  MessageCircle, ExternalLink, Users, SlidersHorizontal, Plus,
  ChevronLeft, ChevronRight, Check,
} from "lucide-react";
import { relativeTime, formatDate } from "@/lib/utils/date";
import { ContactModal } from "./contact-modal";
import { AdvancedFiltersPanel, type FilterRule } from "./advanced-filters-panel";
import type { UnifiedContact } from "@/lib/contacts/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SmartList {
  id: string;
  name: string;
  rules: FilterRule[];
}

type SortKey = "createdAt" | "lastActivityAt" | "name" | "daysSinceLastTouch" | "source" | "stage";

// ─── Design constants ─────────────────────────────────────────────────────────

const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  lead_form:  { label: "Meta",    className: "bg-[#0F3A5C]/10 text-[#0F3A5C]" },
  facebook:   { label: "FB",      className: "bg-blue-50 text-blue-700" },
  instagram:  { label: "IG",      className: "bg-pink-50 text-pink-700" },
  tiktok:     { label: "TikTok",  className: "bg-slate-100 text-slate-700" },
};

const CATEGORY_BADGE: Record<string, { label: string; dot: string }> = {
  ecommerce: { label: "DTC",     dot: "bg-emerald-500" },
  service:   { label: "Service", dot: "bg-amber-500" },
  local:     { label: "Local",   dot: "bg-sky-500" },
  b2b:       { label: "B2B",     dot: "bg-violet-500" },
  other:     { label: "Other",   dot: "bg-zinc-400" },
};

const OPP_STATUS: Record<string, { label: string; className: string }> = {
  open:      { label: "Open",      className: "text-[#0F3A5C]" },
  won:       { label: "Won",       className: "text-emerald-600" },
  lost:      { label: "Lost",      className: "text-rose-600" },
  abandoned: { label: "Abandoned", className: "text-muted-foreground" },
};

// ─── Rule chip label ──────────────────────────────────────────────────────────

function ruleLabel(
  rule: FilterRule,
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>
): string {
  const fieldLabels: Record<string, string> = {
    name: "Name", email: "Email", source: "Source", pipelineId: "Pipeline",
    stageId: "Stage", brandCategory: "Category", hasDemo: "Has Demo",
    daysSinceLastTouch: "Days Since Touch",
  };
  const opLabels: Record<string, string> = {
    is_any_of: "is", is_none_of: "is not",
    is: "is", contains: "contains", not_contains: "doesn't contain",
    gt: ">", lt: "<",
  };
  const staticValueLabels: Record<string, Record<string, string>> = {
    source:        { ghl: "GHL", comment_lead: "Comment" },
    brandCategory: { ecommerce: "DTC", service: "Service", local: "Local", b2b: "B2B", other: "Other" },
    hasDemo:       { true: "Yes", false: "No" },
  };

  const fLabel = fieldLabels[rule.field] ?? rule.field;
  const oLabel = opLabels[rule.operator] ?? rule.operator;

  let vLabel: string;
  if (rule.field === "pipelineId") {
    vLabel = rule.values.map((v) => pipelines.find((p) => p.id === v)?.name ?? v).join(", ") || "…";
  } else if (rule.field === "stageId") {
    const allStages = pipelines.flatMap((p) => p.stages);
    vLabel = rule.values.map((v) => allStages.find((s) => s.id === v)?.name ?? v).join(", ") || "…";
  } else {
    vLabel = rule.values.map((v) => staticValueLabels[rule.field]?.[v] ?? v).join(", ") || "…";
  }

  return `${fLabel} ${oLabel} ${vLabel}`;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function avatarColor(name: string) {
  const palette = ["bg-violet-100 text-violet-700","bg-sky-100 text-sky-700","bg-amber-100 text-amber-700","bg-rose-100 text-rose-700","bg-emerald-100 text-emerald-700","bg-orange-100 text-orange-700","bg-indigo-100 text-indigo-700","bg-teal-100 text-teal-700"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-full font-semibold shrink-0 text-[11px]", avatarColor(name))}
      style={{ width: size, height: size }}
    >
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

// ─── Sort header ──────────────────────────────────────────────────────────────

function SortHeader({ label, sortKey, currentSort, currentOrder, onSort }: {
  label: string; sortKey: SortKey; currentSort: SortKey; currentOrder: "asc" | "desc"; onSort: (k: SortKey) => void;
}) {
  const active = currentSort === sortKey;
  return (
    <button onClick={() => onSort(sortKey)} className={cn("flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
      {label}
      <span className="flex flex-col -space-y-0.5">
        <ChevronUp  className={cn("w-2.5 h-2.5 -mb-0.5", active && currentOrder === "asc"  ? "text-primary" : "text-border/70")} />
        <ChevronDown className={cn("w-2.5 h-2.5",          active && currentOrder === "desc" ? "text-primary" : "text-border/70")} />
      </span>
    </button>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow({ i }: { i: number }) {
  return (
    <tr className="border-b border-border/30" style={{ animationDelay: `${i * 40}ms` }}>
      <td className="w-10 px-4 py-3"><div className="w-3.5 h-3.5 rounded bg-muted animate-pulse" /></td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-muted animate-pulse shrink-0" />
          <div className="space-y-1.5">
            <div className="h-2.5 w-28 rounded-full bg-muted animate-pulse" />
            <div className="h-2 w-36 rounded-full bg-muted/60 animate-pulse" />
          </div>
        </div>
      </td>
      {[40, 80, 50, 30, 60].map((w, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-2.5 rounded-full bg-muted animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ContactsClient() {
  const [search, setSearch]                   = useState("");
  const [debounced, setDebounced]             = useState("");
  const [advancedRules, setAdvancedRules]     = useState<FilterRule[]>([]);
  const [sortBy, setSortBy]                   = useState<SortKey>("createdAt");
  const [sortOrder, setSortOrder]             = useState<"asc" | "desc">("desc");
  const [page, setPage]                       = useState(1);
  const [showAdvancedPanel, setShowAdvancedPanel] = useState(false);
  const [selected, setSelected]               = useState<Set<string>>(new Set());
  const [openContact, setOpenContact]         = useState<UnifiedContact | null>(null);
  const [openContactTab, setOpenContactTab]   = useState<"messages" | undefined>(undefined);
  const [smartLists, setSmartLists]           = useState<SmartList[]>([]);
  const [activeListId, setActiveListId]       = useState<string | null>(null);
  const [savingList, setSavingList]           = useState(false);
  const [listName, setListName]               = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const PAGE_SIZE = 50;

  useEffect(() => {
    try { const r = localStorage.getItem("contacts_smart_lists"); if (r) setSmartLists(JSON.parse(r)); } catch {}
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [advancedRules, sortBy, sortOrder]);

  const { data: pipelinesData } = useQuery<{ pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }> }>({
    queryKey: ["pipelines"],
    queryFn: () => fetch("/api/ghl/pipelines").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });
  const pipelines = pipelinesData?.pipelines ?? [];

  const params = new URLSearchParams({
    page: String(page), pageSize: String(PAGE_SIZE), sortBy, sortOrder,
    ...(debounced            && { search: debounced }),
    ...(advancedRules.length && { rules: JSON.stringify(advancedRules) }),
  });

  const { data, isLoading, isFetching } = useQuery<{ contacts: UnifiedContact[]; total: number }>({
    queryKey: ["contacts", params.toString()],
    queryFn:  () => fetch(`/api/contacts?${params}`).then((r) => r.json()),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const contacts   = data?.contacts ?? [];
  const total      = data?.total    ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeRuleCount = advancedRules.length;

  // Cmd+K
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  function handleSort(key: SortKey) {
    if (sortBy === key) setSortOrder((o) => o === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortOrder("desc"); }
  }

  function toggleAll() {
    setSelected(selected.size === contacts.length ? new Set() : new Set(contacts.map((c) => c.uid)));
  }

  function exportCSV() {
    const rows = contacts.filter((c) => !selected.size || selected.has(c.uid));
    const blob = new Blob([
      ["Name","Email","Phone","Website","Source","Stage","Category","Has Demo","Days Since Touch","Added"].join(",") + "\n" +
      rows.map((c) => [`"${c.name}"`,c.email??"",c.phone??"",c.website??"",c.source,c.stage??"",c.brandCategory??"",c.hasDemo?"Yes":"No",c.daysSinceLastTouch,formatDate(c.createdAt)].join(",")).join("\n")
    ], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `contacts-${new Date().toISOString().slice(0,10)}.csv` });
    a.click();
  }

  function saveList() {
    if (!listName.trim()) return;
    const newList: SmartList = { id: crypto.randomUUID(), name: listName.trim(), rules: advancedRules };
    const next = [...smartLists, newList];
    setSmartLists(next);
    setActiveListId(newList.id);
    localStorage.setItem("contacts_smart_lists", JSON.stringify(next));
    setListName("");
    setSavingList(false);
  }

  function deleteList(id: string) {
    const next = smartLists.filter((l) => l.id !== id);
    setSmartLists(next);
    if (activeListId === id) setActiveListId(null);
    localStorage.setItem("contacts_smart_lists", JSON.stringify(next));
  }

  const clearAll = useCallback(() => {
    setAdvancedRules([]);
    setSearch("");
    setActiveListId(null);
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2.5 flex-wrap shrink-0">

        {/* Search */}
        <div className={cn("relative flex items-center transition-all duration-200", search ? "w-60" : "w-48 focus-within:w-60")}>
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full pl-8 pr-7 py-2 text-sm border border-border rounded-[8px] bg-card placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/40 transition-all"
          />
          {search
            ? <button onClick={() => setSearch("")} className="absolute right-2 p-0.5 rounded text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
            : <kbd className="absolute right-2.5 hidden sm:block text-[9px] text-muted-foreground/40 pointer-events-none font-medium">⌘K</kbd>
          }
        </div>

        {/* Advanced Filters */}
        <button
          onClick={() => setShowAdvancedPanel(true)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-[8px] border transition-colors",
            showAdvancedPanel || activeRuleCount > 0
              ? "border-primary/30 bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Advanced Filters
          {activeRuleCount > 0 && (
            <span className="ml-0.5 px-1.5 py-px text-[9px] font-bold bg-primary text-white rounded-full leading-tight">
              {activeRuleCount}
            </span>
          )}
        </button>

        {/* Active rule chips */}
        {activeRuleCount > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {advancedRules.map((rule) => (
              <Chip
                key={rule.id}
                label={ruleLabel(rule, pipelines)}
                onRemove={() => {
                  const next = advancedRules.filter((r) => r.id !== rule.id);
                  setAdvancedRules(next);
                  setActiveListId(null);
                }}
              />
            ))}
            <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1">Clear</button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2.5">
          {isFetching && !isLoading && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" /> Syncing
            </span>
          )}
          {selected.size > 0 && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-border">
              <span className="text-xs text-muted-foreground tabular-nums">{selected.size} selected</span>
              <button onClick={exportCSV} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-border rounded-[7px] hover:bg-muted transition-colors">
                <Download className="w-3 h-3" /> Export
              </button>
              <button className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-border rounded-[7px] hover:bg-muted transition-colors">
                <Tag className="w-3 h-3" /> Tag
              </button>
              <button onClick={() => setSelected(new Set())} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-border rounded-[7px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Download className="w-3 h-3" /> CSV
          </button>
          <span className="text-sm font-medium text-foreground tabular-nums">
            {isLoading ? "—" : total.toLocaleString()}
            <span className="text-muted-foreground font-normal"> contacts</span>
          </span>
        </div>
      </div>

      {/* ── Smart lists ── */}
      <div className="flex items-center gap-1 shrink-0 overflow-x-auto">
        {/* All */}
        <button
          onClick={() => { setAdvancedRules([]); setActiveListId(null); }}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-[7px] transition-colors whitespace-nowrap",
            advancedRules.length === 0
              ? "bg-foreground/8 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          All
        </button>

        {/* Saved lists */}
        {smartLists.map((list) => (
          <div key={list.id} className="flex items-center group">
            <button
              onClick={() => { setAdvancedRules(list.rules); setActiveListId(list.id); }}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                smartLists.length > 0 ? "rounded-l-[7px]" : "rounded-[7px]",
                activeListId === list.id
                  ? "bg-primary/10 text-primary border border-r-0 border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
              )}
            >
              {list.name}
            </button>
            <button
              onClick={() => deleteList(list.id)}
              title="Delete list"
              className={cn(
                "px-1.5 py-1.5 rounded-r-[7px] text-muted-foreground hover:text-rose-500 transition-all opacity-0 group-hover:opacity-100 border border-l-0",
                activeListId === list.id
                  ? "border-primary/20 bg-primary/10"
                  : "border-transparent hover:border-border/60"
              )}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Add smart list */}
        {savingList ? (
          <div className="flex items-center gap-1.5 ml-1">
            <input
              autoFocus
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveList(); if (e.key === "Escape") setSavingList(false); }}
              placeholder="List name…"
              className="text-xs px-2 py-1.5 border border-primary/40 rounded-[6px] bg-card focus:outline-none w-28"
            />
            <button onClick={saveList} disabled={!listName.trim()} className="p-1 text-primary disabled:opacity-30">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setSavingList(false)} className="p-1 text-muted-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSavingList(true)}
            disabled={activeRuleCount === 0}
            title={activeRuleCount === 0 ? "Apply filters first to save a list" : "Save current filters as a smart list"}
            className="flex items-center gap-1 ml-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-[7px] transition-colors whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <Plus className="w-3 h-3" />
            Add smart list
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 min-h-0 overflow-auto rounded-[10px] border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card border-b border-border">
            <tr>
              <th className="w-10 px-4 py-3 align-middle">
                <input type="checkbox" checked={contacts.length > 0 && selected.size === contacts.length} onChange={toggleAll} className="rounded border-border" />
              </th>
              <th className="px-4 py-3 text-left min-w-[180px] align-middle">
                <SortHeader label="Name" sortKey="name" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-left w-24 align-middle">
                <SortHeader label="Source" sortKey="source" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-left min-w-[140px] align-middle">
                <SortHeader label="Stage" sortKey="stage" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-left w-28 align-middle">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Channel</span>
              </th>
              <th className="px-4 py-3 text-left w-32 align-middle">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Demo</span>
              </th>
              <th className="px-4 py-3 text-left w-24 align-middle">
                <SortHeader label="Touch" sortKey="daysSinceLastTouch" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-left w-32 align-middle">
                <SortHeader label="Added" sortKey="createdAt" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 12 }, (_, i) => <SkeletonRow key={i} i={i} />)
              : contacts.length === 0
              ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <Users className="w-9 h-9 text-border mx-auto mb-3" />
                    <p className="text-sm font-medium text-foreground mb-0.5">No contacts found</p>
                    {(search || activeRuleCount > 0) && <p className="text-xs text-muted-foreground">Try adjusting your search or filters</p>}
                  </td>
                </tr>
              )
              : contacts.map((c) => (
                <ContactRow
                  key={c.uid}
                  contact={c}
                  selected={selected.has(c.uid)}
                  onSelect={() => setSelected((prev) => { const n = new Set(prev); n.has(c.uid) ? n.delete(c.uid) : n.add(c.uid); return n; })}
                  onClick={() => { setOpenContactTab(undefined); setOpenContact(c); }}
                  onOpenMessages={() => { setOpenContactTab("messages"); setOpenContact(c); }}
                />
              ))
            }
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between shrink-0 pt-1">
          <span className="text-xs text-muted-foreground tabular-nums">
            {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, total).toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <PageBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="w-3.5 h-3.5" /></PageBtn>
            {pageNumbers(page, totalPages).map((p, i) =>
              p === "…"
                ? <span key={`ellipsis-${i}`} className="w-7 text-center text-xs text-muted-foreground">…</span>
                : <PageBtn key={p} onClick={() => setPage(p as number)} active={p === page}>{p}</PageBtn>
            )}
            <PageBtn onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}><ChevronRight className="w-3.5 h-3.5" /></PageBtn>
          </div>
        </div>
      )}

      {openContact && (() => {
        const queueContacts = selected.size >= 2
          ? contacts.filter((c) => selected.has(c.uid))
          : undefined;
        const queueIndex = queueContacts
          ? queueContacts.findIndex((c) => c.uid === openContact.uid)
          : undefined;
        return (
          <ContactModal
            contact={openContact}
            onClose={() => { setOpenContact(null); setOpenContactTab(undefined); }}
            initialTab={openContactTab}
            queue={queueContacts}
            queueIndex={queueIndex}
            onNavigate={(i) => {
              if (queueContacts) setOpenContact(queueContacts[i]);
            }}
          />
        );
      })()}

      {showAdvancedPanel && (
        <AdvancedFiltersPanel
          rules={advancedRules}
          onApply={(rules) => { setAdvancedRules(rules); setShowAdvancedPanel(false); setActiveListId(null); }}
          onClose={() => setShowAdvancedPanel(false)}
          pipelines={pipelines}
        />
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ContactRow({ contact: c, selected, onSelect, onClick, onOpenMessages }: {
  contact: UnifiedContact; selected: boolean; onSelect: () => void; onClick: () => void; onOpenMessages: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const platform = c.platform ?? "lead_form";
  const badge = PLATFORM_BADGE[platform] ?? PLATFORM_BADGE.lead_form;
  const catBadge = c.brandCategory ? CATEGORY_BADGE[c.brandCategory] : null;
  const status = c.opportunityStatus && c.opportunityStatus !== "open" ? OPP_STATUS[c.opportunityStatus] : null;
  const isStale = c.daysSinceLastTouch > 14;
  const isMedium = c.daysSinceLastTouch > 6;

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      className={cn("border-b border-border/30 cursor-pointer transition-colors duration-100", selected ? "bg-primary/[0.04]" : hovered ? "bg-muted/40" : "")}
    >
      {/* Checkbox */}
      <td className="w-10 px-4 py-3" onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <input type="checkbox" checked={selected} onChange={onSelect} onClick={(e) => e.stopPropagation()} className="rounded border-border" />
      </td>

      {/* Name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={c.name} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-foreground leading-tight truncate max-w-[200px]">{c.name}</p>
              {c.awaitingReply && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0 animate-pulse" title="Awaiting reply" />}
            </div>
            {c.email && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{c.email}</p>}
          </div>
          {/* Hover actions — always in DOM to prevent layout shift */}
          <div className={cn("flex items-center gap-0.5 ml-1 shrink-0 transition-opacity duration-100", hovered ? "opacity-100" : "opacity-0 pointer-events-none")}>
            {c.ghlContactId ? (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenMessages(); }}
                title="Open conversation"
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" />
              </button>
            ) : (
              <span className="w-[22px]" />
            )}
            {c.website ? (
              <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={c.website} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <span className="w-[22px]" />
            )}
          </div>
        </div>
      </td>

      {/* Source */}
      <td className="px-4 py-3">
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", badge.className)}>
          {badge.label}
        </span>
      </td>

      {/* Stage */}
      <td className="px-4 py-3">
        {c.stage ? (
          <div className="min-w-0">
            <p className="text-xs text-foreground/80 truncate max-w-[140px]">{c.stage}</p>
            {status && <p className={cn("text-[11px]", status.className)}>{status.label}</p>}
          </div>
        ) : (
          <span className="text-muted-foreground/30 text-sm">—</span>
        )}
      </td>

      {/* Channel */}
      <td className="px-4 py-3">
        {c.lastChannel ? (
          <ChannelBadge channel={c.lastChannel} />
        ) : (
          <span className="text-muted-foreground/30 text-sm">—</span>
        )}
      </td>

      {/* Demo */}
      <td className="px-4 py-3">
        {c.hasDemo ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            Demo sent
          </span>
        ) : (
          <span className="text-muted-foreground/30 text-sm">—</span>
        )}
      </td>

      {/* Touch */}
      <td className="px-4 py-3">
        <span className={cn(
          "text-xs font-medium tabular-nums",
          isStale   ? "text-rose-500" :
          isMedium  ? "text-amber-600" :
          "text-muted-foreground"
        )}>
          {c.daysSinceLastTouch === 0 ? "Today" : `${c.daysSinceLastTouch}d`}
        </span>
      </td>

      {/* Added */}
      <td className="px-4 py-3">
        <span className="text-xs text-muted-foreground" title={formatDate(c.createdAt)}>
          {relativeTime(c.createdAt)}
        </span>
      </td>
    </tr>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const CHANNEL_STYLE: Record<string, string> = {
  SMS:       "bg-emerald-50 text-emerald-700",
  Email:     "bg-sky-50 text-sky-700",
  Instagram: "bg-pink-50 text-pink-700",
  Facebook:  "bg-blue-50 text-blue-700",
  WhatsApp:  "bg-green-50 text-green-700",
  Call:      "bg-violet-50 text-violet-700",
  TikTok:    "bg-slate-100 text-slate-700",
};

function ChannelBadge({ channel }: { channel: string }) {
  const cls = CHANNEL_STYLE[channel] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cls}`}>
      {channel}
    </span>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs bg-muted text-foreground border border-border/60">
      {label}
      <button onClick={onRemove} className="p-0.5 rounded-full hover:bg-border transition-colors"><X className="w-2.5 h-2.5" /></button>
    </span>
  );
}

function PageBtn({ children, onClick, disabled, active }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cn("min-w-[28px] h-7 px-1 text-xs rounded-md transition-colors", active ? "bg-primary text-white font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed")}>
      {children}
    </button>
  );
}

function pageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "…", total];
  if (current >= total - 3) return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "…", current - 1, current, current + 1, "…", total];
}
