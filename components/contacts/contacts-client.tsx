"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import {
  Search, X, ChevronUp, ChevronDown, Download, Tag, RefreshCw,
  MessageCircle, ExternalLink, Users, SlidersHorizontal, Plus,
  ChevronLeft, ChevronRight, Check, Mail, Phone, Ban,
  FileText, ClipboardCheck, Layers,
} from "lucide-react";
import { relativeTime, formatDate } from "@/lib/utils/date";
import { Avatar } from "@/components/ui/avatar";
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

// ─── Preset smart tabs ───────────────────────────────────────────────────────

interface PresetTab {
  id: string;
  label: string;
  rules: FilterRule[];
}

const PRESET_TABS: PresetTab[] = [
  { id: "all", label: "All", rules: [] },
  { id: "unread", label: "Unread", rules: [{ id: "p-unread", field: "daysSinceLastTouch", operator: "lt", values: ["1"], connector: "and" }] },
  { id: "no-response-7d", label: "No response 7d+", rules: [{ id: "p-nr7", field: "daysSinceLastTouch", operator: "gt", values: ["7"], connector: "and" }] },
  { id: "demo-sent", label: "Demo sent", rules: [{ id: "p-demo", field: "hasDemo", operator: "is_any_of", values: ["true"], connector: "and" }] },
  { id: "proposal-sent", label: "Proposal sent", rules: [{ id: "p-prop", field: "hasDemo", operator: "is_any_of", values: ["true"], connector: "and" }] },
];

// ─── Design constants ─────────────────────────────────────────────────────────

const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  lead_form:  { label: "Meta",    className: "bg-[#0F3A5C]/10 text-[#0F3A5C]" },
  facebook:   { label: "FB",      className: "bg-blue-50 text-blue-700" },
  instagram:  { label: "IG",      className: "bg-pink-50 text-pink-700" },
  tiktok:     { label: "TikTok",  className: "bg-slate-100 text-slate-700" },
};

const STAGE_COLORS: Record<string, string> = {
  "New Lead":           "bg-blue-50 text-blue-700 border-blue-200",
  "Initial Contact Made": "bg-amber-50 text-amber-700 border-amber-200",
  "Intro Call (Booked)": "bg-violet-50 text-violet-700 border-violet-200",
  "Demo In Progress":   "bg-indigo-50 text-indigo-700 border-indigo-200",
  "Demo Sent":          "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Proposal Sent":      "bg-teal-50 text-teal-700 border-teal-200",
  "Closed (Won)":       "bg-green-50 text-green-700 border-green-200",
  "Not Qualified":      "bg-muted text-muted-foreground border-border",
};

const RESPONSE_CONFIG: Record<string, { label: string; className: string }> = {
  awaiting_reply: { label: "Awaiting reply", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  no_response:    { label: "No response",    className: "bg-red-50 text-red-600 border-red-200" },
  replied:        { label: "Replied",         className: "bg-muted text-muted-foreground border-border" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    is_any_of: "is", is_none_of: "is not", is: "is", contains: "contains",
    not_contains: "doesn't contain", gt: ">", lt: "<",
  };
  const staticValueLabels: Record<string, Record<string, string>> = {
    source: { ghl: "GHL", comment_lead: "Comment" },
    brandCategory: { ecommerce: "DTC", service: "Service", local: "Local", b2b: "B2B", other: "Other" },
    hasDemo: { true: "Yes", false: "No" },
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


function SortHeader({ label, sortKey, currentSort, currentOrder, onSort }: {
  label: string; sortKey: SortKey; currentSort: SortKey; currentOrder: "asc" | "desc"; onSort: (k: SortKey) => void;
}) {
  const active = currentSort === sortKey;
  return (
    <button onClick={() => onSort(sortKey)} className={cn("flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
      {label}
      <span className="flex flex-col -space-y-0.5">
        <ChevronUp  className={cn("w-2.5 h-2.5 -mb-0.5", active && currentOrder === "asc"  ? "text-primary" : "text-border/70")} />
        <ChevronDown className={cn("w-2.5 h-2.5",          active && currentOrder === "desc" ? "text-primary" : "text-border/70")} />
      </span>
    </button>
  );
}

function SkeletonRow({ i }: { i: number }) {
  return (
    <tr className="border-b border-border/30" style={{ animationDelay: `${i * 40}ms` }}>
      <td className="w-8 px-3 py-2"><div className="w-3.5 h-3.5 rounded bg-muted animate-pulse" /></td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-muted animate-pulse shrink-0" />
          <div className="space-y-1">
            <div className="h-2.5 w-24 rounded-full bg-muted animate-pulse" />
            <div className="h-2 w-32 rounded-full bg-muted/60 animate-pulse" />
          </div>
        </div>
      </td>
      {Array.from({ length: 8 }).map((_, j) => (
        <td key={j} className="px-3 py-2"><div className="h-2.5 w-12 rounded-full bg-muted animate-pulse" /></td>
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
  const [openContactTab, setOpenContactTab]   = useState<"timeline" | undefined>(undefined);
  const [smartLists, setSmartLists]           = useState<SmartList[]>([]);
  const [activeListId, setActiveListId]       = useState<string | null>(null);
  const [activePreset, setActivePreset]       = useState("all");
  const [savingList, setSavingList]           = useState(false);
  const [listName, setListName]               = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

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

  // Fetch team for rep map
  const { data: teamData } = useQuery<{ users: Array<{ name: string; ghlUserId: string | null }> }>({
    queryKey: ["team-settings"],
    queryFn: () => fetch("/api/settings/team").then((r) => r.json()),
    staleTime: 10 * 60_000,
  });
  const repMap = new Map<string, string>(
    (teamData?.users ?? []).filter((u) => u.ghlUserId).map((u) => [u.ghlUserId!, u.name])
  );

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

  function applyPreset(preset: PresetTab) {
    setActivePreset(preset.id);
    setAdvancedRules(preset.rules);
    setActiveListId(null);
  }

  const clearAll = useCallback(() => {
    setAdvancedRules([]);
    setSearch("");
    setActiveListId(null);
    setActivePreset("all");
  }, []);

  // Quick actions
  async function handleQuickAction(action: string, contact: UnifiedContact) {
    if (action === "audit" && contact.ghlContactId) {
      try {
        await fetch("/api/clickup/create-audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId: contact.ghlContactId, contactName: contact.name }),
        });
      } catch {}
    }
    if (action === "demo" && contact.ghlContactId) {
      // Open the contact modal to the demo tab
      setOpenContact(contact);
    }
  }

  // Stage summary counts
  const stageCounts = new Map<string, number>();
  for (const c of contacts) {
    const s = c.stage ?? "Unknown";
    stageCounts.set(s, (stageCounts.get(s) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2.5">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2.5 flex-wrap shrink-0">
        <div className={cn("relative flex items-center transition-all duration-200", search ? "w-60" : "w-48 focus-within:w-60")}>
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full pl-8 pr-7 py-1.5 text-sm border border-border rounded-[8px] bg-card placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/40 transition-all"
          />
          {search
            ? <button onClick={() => setSearch("")} className="absolute right-2 p-0.5 rounded text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
            : <kbd className="absolute right-2.5 hidden sm:block text-[9px] text-muted-foreground/40 pointer-events-none font-medium">⌘K</kbd>
          }
        </div>

        <button
          onClick={() => setShowAdvancedPanel(true)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-[8px] border transition-colors",
            showAdvancedPanel || activeRuleCount > 0
              ? "border-primary/30 bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {activeRuleCount > 0 && (
            <span className="ml-0.5 px-1.5 py-px text-[9px] font-bold bg-primary text-white rounded-full leading-tight">{activeRuleCount}</span>
          )}
        </button>

        {activeRuleCount > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {advancedRules.map((rule) => (
              <Chip key={rule.id} label={ruleLabel(rule, pipelines)} onRemove={() => { setAdvancedRules(advancedRules.filter((r) => r.id !== rule.id)); setActiveListId(null); }} />
            ))}
            <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1">Clear</button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isFetching && !isLoading && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" /> Syncing
            </span>
          )}
          {selected.size > 0 && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-border">
              <span className="text-xs text-muted-foreground tabular-nums font-medium">{selected.size} selected</span>
              <button onClick={exportCSV} className="flex items-center gap-1 px-2 py-1 text-xs font-medium border border-border rounded-[6px] hover:bg-muted transition-colors">
                <Download className="w-3 h-3" /> Export
              </button>
              <button className="flex items-center gap-1 px-2 py-1 text-xs font-medium border border-border rounded-[6px] hover:bg-muted transition-colors">
                <Tag className="w-3 h-3" /> Tag
              </button>
              <button className="flex items-center gap-1 px-2 py-1 text-xs font-medium border border-border rounded-[6px] hover:bg-muted transition-colors">
                <Users className="w-3 h-3" /> Assign Rep
              </button>
              <button onClick={() => setSelected(new Set())} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <button onClick={exportCSV} className="flex items-center gap-1 px-2 py-1 text-xs font-medium border border-border rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Download className="w-3 h-3" /> CSV
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1 bg-primary text-primary-foreground rounded-[8px] px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Contact
          </button>
          <span className="text-sm font-medium text-foreground tabular-nums">
            {isLoading ? "—" : total.toLocaleString()}
            <span className="text-muted-foreground font-normal"> contacts</span>
          </span>
        </div>
      </div>

      {/* ── Preset tabs + Smart lists ── */}
      <div className="flex items-center gap-1 shrink-0 overflow-x-auto">
        {PRESET_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => applyPreset(tab)}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-[6px] transition-colors whitespace-nowrap",
              activePreset === tab.id && activeListId === null
                ? "bg-foreground/8 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {tab.label}
          </button>
        ))}

        <div className="w-px h-4 bg-border mx-1" />

        {smartLists.map((list) => (
          <div key={list.id} className="flex items-center group">
            <button
              onClick={() => { setAdvancedRules(list.rules); setActiveListId(list.id); setActivePreset(""); }}
              className={cn(
                "px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap rounded-l-[6px]",
                activeListId === list.id
                  ? "bg-primary/10 text-primary border border-r-0 border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
              )}
            >
              {list.name}
            </button>
            <button
              onClick={() => deleteList(list.id)}
              className={cn(
                "px-1 py-1 rounded-r-[6px] text-muted-foreground hover:text-rose-500 transition-all opacity-0 group-hover:opacity-100 border border-l-0",
                activeListId === list.id ? "border-primary/20 bg-primary/10" : "border-transparent"
              )}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {savingList ? (
          <div className="flex items-center gap-1 ml-1">
            <input autoFocus value={listName} onChange={(e) => setListName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveList(); if (e.key === "Escape") setSavingList(false); }} placeholder="List name…" className="text-xs px-2 py-1 border border-primary/40 rounded-[5px] bg-card focus:outline-none w-24" />
            <button onClick={saveList} disabled={!listName.trim()} className="p-0.5 text-primary disabled:opacity-30"><Check className="w-3.5 h-3.5" /></button>
            <button onClick={() => setSavingList(false)} className="p-0.5 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
          </div>
        ) : (
          <button onClick={() => setSavingList(true)} disabled={activeRuleCount === 0} className="flex items-center gap-1 ml-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-[6px] transition-colors whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed">
            <Plus className="w-3 h-3" /> Save list
          </button>
        )}
      </div>

      {/* ── Stage summary bar ── */}
      {!isLoading && stageCounts.size > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto shrink-0">
          {[...stageCounts.entries()].map(([stage, count]) => {
            const stageClass = Object.entries(STAGE_COLORS).find(([k]) => stage.toLowerCase().includes(k.toLowerCase()))?.[1] ?? "bg-muted text-muted-foreground border-border";
            return (
              <span key={stage} className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap", stageClass)}>
                {stage}
                <span className="tabular-nums font-bold">{count}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 min-h-0 overflow-auto rounded-[10px] border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card border-b border-border">
            <tr>
              <th className="w-8 px-3 py-2 align-middle">
                <input type="checkbox" checked={contacts.length > 0 && selected.size === contacts.length} onChange={toggleAll} className="rounded border-border" />
              </th>
              <th className="px-3 py-2 text-left min-w-[160px] align-middle">
                <SortHeader label="Name" sortKey="name" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
              <th className="px-3 py-2 text-left w-16 align-middle">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Rep</span>
              </th>
              <th className="px-3 py-2 text-left w-16 align-middle">
                <SortHeader label="Source" sortKey="source" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
              <th className="px-3 py-2 text-left min-w-[110px] align-middle">
                <SortHeader label="Stage" sortKey="stage" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
              <th className="px-3 py-2 text-left w-20 align-middle">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Status</span>
              </th>
              <th className="px-3 py-2 text-center w-12 align-middle" title="Reachable channels">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Ch</span>
              </th>
              <th className="px-3 py-2 text-center w-10 align-middle" title="Demo">
                <Layers className="w-3 h-3 text-muted-foreground mx-auto" />
              </th>
              <th className="px-3 py-2 text-center w-10 align-middle" title="Proposal">
                <FileText className="w-3 h-3 text-muted-foreground mx-auto" />
              </th>
              <th className="px-3 py-2 text-left w-16 align-middle">
                <SortHeader label="Touch" sortKey="daysSinceLastTouch" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
              <th className="px-3 py-2 text-left w-14 align-middle">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">In stage</span>
              </th>
              <th className="px-3 py-2 text-left w-24 align-middle">
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
                  <td colSpan={12} className="py-16 text-center">
                    <Users className="w-8 h-8 text-border mx-auto mb-2" />
                    <p className="text-sm font-medium text-foreground mb-0.5">No contacts found</p>
                    {(search || activeRuleCount > 0) && <p className="text-xs text-muted-foreground">Try adjusting your search or filters</p>}
                  </td>
                </tr>
              )
              : contacts.map((c) => (
                <ContactRow
                  key={c.uid}
                  contact={c}
                  repName={c.assignedTo ? repMap.get(c.assignedTo) ?? null : null}
                  selected={selected.has(c.uid)}
                  onSelect={() => setSelected((prev) => { const n = new Set(prev); n.has(c.uid) ? n.delete(c.uid) : n.add(c.uid); return n; })}
                  onClick={() => { setOpenContactTab(undefined); setOpenContact(c); }}
                  onOpenMessages={() => { setOpenContactTab(undefined); setOpenContact(c); }}
                  handleQuickAction={handleQuickAction}
                />
              ))
            }
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between shrink-0 pt-0.5">
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
        const queueContacts = selected.size >= 2 ? contacts.filter((c) => selected.has(c.uid)) : undefined;
        const queueIndex = queueContacts ? queueContacts.findIndex((c) => c.uid === openContact.uid) : undefined;
        return (
          <ContactModal
            contact={openContact}
            onClose={() => { setOpenContact(null); setOpenContactTab(undefined); }}
            initialTab={openContactTab}
            queue={queueContacts}
            queueIndex={queueIndex}
            onNavigate={(i) => { if (queueContacts) setOpenContact(queueContacts[i]); }}
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

      {showCreateModal && (
        <CreateContactModal
          pipelines={pipelines}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ["contacts"] });
          }}
        />
      )}
    </div>
  );
}

// ─── Create Contact Modal ────────────────────────────────────────────────────

const SOURCES = ["Facebook", "Instagram", "TikTok", "Referral", "Website", "Other"] as const;

function CreateContactModal({
  pipelines,
  onClose,
  onCreated,
}: {
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [source, setSource] = useState("");
  const [monetaryValue, setMonetaryValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);
  const stages = selectedPipeline?.stages ?? [];

  // Reset stage when pipeline changes
  useEffect(() => {
    setStageId("");
  }, [pipelineId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/ghl/contacts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          website: website.trim() || undefined,
          pipelineId: pipelineId || undefined,
          stageId: stageId || undefined,
          source: source || undefined,
          monetaryValue: monetaryValue ? Number(monetaryValue) : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to create contact" }));
        throw new Error(data.error ?? "Failed to create contact");
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "w-full px-3 py-2 text-sm border border-border rounded-[8px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors";
  const labelClass = "text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-[12px] w-[480px] max-h-[85vh] overflow-y-auto p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-foreground">Create Contact</h2>
          <button onClick={onClose} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* First / Last name — two columns */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>First Name *</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Last Name</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" className={inputClass} />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className={labelClass}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@example.com" className={inputClass} />
          </div>

          {/* Phone */}
          <div>
            <label className={labelClass}>Phone</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" className={inputClass} />
          </div>

          {/* Website */}
          <div>
            <label className={labelClass}>Website</label>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" className={inputClass} />
          </div>

          {/* Pipeline / Stage — two columns */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Pipeline</label>
              <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className={inputClass}>
                <option value="">None</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Stage</label>
              <select value={stageId} onChange={(e) => setStageId(e.target.value)} disabled={!pipelineId} className={cn(inputClass, !pipelineId && "opacity-50 cursor-not-allowed")}>
                <option value="">Select stage</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Source */}
          <div>
            <label className={labelClass}>Source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)} className={inputClass}>
              <option value="">Select source</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Deal Value */}
          <div>
            <label className={labelClass}>Deal Value</label>
            <input
              type="number"
              min="0"
              step="1"
              value={monetaryValue}
              onChange={(e) => setMonetaryValue(e.target.value)}
              placeholder="0"
              className={inputClass}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-500 font-medium">{error}</p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground rounded-[8px] hover:bg-muted transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !firstName.trim()}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-[8px] px-4 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Contact"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ContactRow({ contact: c, repName, selected, onSelect, onClick, onOpenMessages, handleQuickAction }: {
  contact: UnifiedContact; repName: string | null; selected: boolean; onSelect: () => void; onClick: () => void; onOpenMessages: () => void; handleQuickAction: (action: string, contact: UnifiedContact) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const platform = c.platform ?? "lead_form";
  const badge = PLATFORM_BADGE[platform] ?? PLATFORM_BADGE.lead_form;
  const isStale = c.daysSinceLastTouch > 14;
  const isMedium = c.daysSinceLastTouch > 6;

  const stageClass = c.stage
    ? Object.entries(STAGE_COLORS).find(([k]) => c.stage!.toLowerCase().includes(k.toLowerCase()))?.[1] ?? "bg-muted text-muted-foreground border-border"
    : null;

  const responseConfig = c.responseStatus ? RESPONSE_CONFIG[c.responseStatus] : null;


  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      className={cn(
        "border-b border-border/30 cursor-pointer transition-colors duration-75",
        selected ? "bg-primary/[0.04]" : hovered ? "bg-muted/40" : "",
        c.dnd && "opacity-50"
      )}
    >
      {/* Checkbox */}
      <td className="w-8 px-3 py-1.5" onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <input type="checkbox" checked={selected} onChange={onSelect} onClick={(e) => e.stopPropagation()} className="rounded border-border" />
      </td>

      {/* Name + DNC flag */}
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar name={c.name} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-foreground leading-tight truncate max-w-[180px]">{c.name}</p>
              {c.dnd && <span title="Do not contact"><Ban className="w-3 h-3 text-red-500 shrink-0" /></span>}
            </div>
            {c.email && <p className="text-[11px] text-muted-foreground truncate max-w-[180px] leading-tight">{c.email}</p>}
          </div>
          {/* Hover actions */}
          <div className={cn("flex items-center gap-0.5 shrink-0 transition-opacity duration-75", hovered ? "opacity-100" : "opacity-0 pointer-events-none")}>
            {c.ghlContactId && (
              <button onClick={(e) => { e.stopPropagation(); onOpenMessages(); }} title="Message" className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <MessageCircle className="w-3 h-3" />
              </button>
            )}
            {c.ghlContactId && !c.hasDemo && (
              <button onClick={(e) => { e.stopPropagation(); handleQuickAction("demo", c); }} title="Submit demo" className="p-1 rounded-md text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                <Layers className="w-3 h-3" />
              </button>
            )}
            {c.ghlContactId && (
              <button onClick={(e) => { e.stopPropagation(); handleQuickAction("audit", c); }} title="Create audit" className="p-1 rounded-md text-muted-foreground hover:text-violet-600 hover:bg-violet-50 transition-colors">
                <ClipboardCheck className="w-3 h-3" />
              </button>
            )}
            {c.website && (
              <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={c.website} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </td>

      {/* Rep */}
      <td className="px-3 py-1.5">
        {repName ? (
          <Avatar name={repName} size={24} variant="rep" />
        ) : (
          <span className="text-muted-foreground/20 text-xs">—</span>
        )}
      </td>

      {/* Source */}
      <td className="px-3 py-1.5">
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium", badge.className)}>
          {badge.label}
        </span>
      </td>

      {/* Stage — color-coded pill */}
      <td className="px-3 py-1.5">
        {c.stage ? (
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border truncate max-w-[120px]", stageClass)}>
            {c.stage}
          </span>
        ) : (
          <span className="text-muted-foreground/20 text-xs">—</span>
        )}
      </td>

      {/* Response status */}
      <td className="px-3 py-1.5">
        {responseConfig ? (
          <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap", responseConfig.className)}>
            {responseConfig.label}
          </span>
        ) : (
          <span className="text-muted-foreground/20 text-xs">—</span>
        )}
      </td>

      {/* Reachable channels */}
      <td className="px-3 py-1.5">
        <div className="flex items-center justify-center gap-1">
          {c.reachableChannels?.includes("email") && <span title="Email"><Mail className="w-3 h-3 text-sky-500" /></span>}
          {c.reachableChannels?.includes("sms") && <span title="SMS"><Phone className="w-3 h-3 text-emerald-500" /></span>}
          {!c.reachableChannels?.length && <span className="text-muted-foreground/20 text-xs">—</span>}
        </div>
      </td>

      {/* Demo */}
      <td className="px-3 py-1.5 text-center">
        {c.hasDemo ? (
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" title="Demo sent" />
        ) : (
          <span className="text-muted-foreground/20 text-xs">—</span>
        )}
      </td>

      {/* Proposal */}
      <td className="px-3 py-1.5 text-center">
        {c.hasProposal ? (
          <span className={cn(
            "w-2 h-2 rounded-full inline-block",
            c.proposalStatus === "paid" ? "bg-emerald-500" :
            c.proposalStatus === "signed" ? "bg-blue-500" :
            c.proposalStatus === "sent" ? "bg-amber-500" :
            "bg-muted-foreground"
          )} title={`Proposal: ${c.proposalStatus}`} />
        ) : (
          <span className="text-muted-foreground/20 text-xs">—</span>
        )}
      </td>

      {/* Last touch */}
      <td className="px-3 py-1.5">
        <span className={cn(
          "text-xs font-medium tabular-nums",
          isStale   ? "text-rose-500" :
          isMedium  ? "text-amber-600" :
          "text-emerald-600"
        )}>
          {c.daysSinceLastTouch === 0 ? "Today" : `${c.daysSinceLastTouch}d`}
        </span>
      </td>

      {/* Days in stage */}
      <td className="px-3 py-1.5">
        {c.daysInCurrentStage != null ? (
          <span className={cn(
            "text-xs tabular-nums",
            c.daysInCurrentStage > 30 ? "text-rose-500 font-medium" :
            c.daysInCurrentStage > 14 ? "text-amber-600" :
            "text-muted-foreground"
          )}>
            {c.daysInCurrentStage}d
          </span>
        ) : (
          <span className="text-muted-foreground/20 text-xs">—</span>
        )}
      </td>

      {/* Added */}
      <td className="px-3 py-1.5">
        <span className="text-xs text-muted-foreground" title={formatDate(c.createdAt)}>
          {relativeTime(c.createdAt)}
        </span>
      </td>
    </tr>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

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
