"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import {
  Search, X, ChevronUp, ChevronDown, Download, Tag, RefreshCw,
  MessageCircle, ExternalLink, Users, SlidersHorizontal,
  BookmarkPlus, Trash2, ChevronLeft, ChevronRight, Check,
} from "lucide-react";
import { relativeTime, formatDate } from "@/lib/utils/date";
import { ContactModal } from "./contact-modal";
import type { UnifiedContact } from "@/lib/contacts/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FilterState {
  source: string;
  category: string;
  hasDemo: string;
}

interface SavedPreset {
  id: string;
  name: string;
  filters: FilterState;
  search: string;
}

type SortKey = "createdAt" | "lastActivityAt" | "name" | "daysSinceLastTouch";

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
  const [search, setSearch]         = useState("");
  const [debounced, setDebounced]   = useState("");
  const [filters, setFilters]       = useState<FilterState>({ source: "", category: "", hasDemo: "" });
  const [sortBy, setSortBy]         = useState<SortKey>("createdAt");
  const [sortOrder, setSortOrder]   = useState<"asc" | "desc">("desc");
  const [page, setPage]             = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [openContact, setOpenContact] = useState<UnifiedContact | null>(null);
  const [presets, setPresets]       = useState<SavedPreset[]>([]);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const PAGE_SIZE = 50;

  useEffect(() => {
    try { const r = localStorage.getItem("contacts_presets"); if (r) setPresets(JSON.parse(r)); } catch {}
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [filters, sortBy, sortOrder]);

  const params = new URLSearchParams({
    page: String(page), pageSize: String(PAGE_SIZE), sortBy, sortOrder,
    ...(debounced    && { search:   debounced }),
    ...(filters.source   && { source:   filters.source }),
    ...(filters.category && { category: filters.category }),
    ...(filters.hasDemo  && { hasDemo:  filters.hasDemo }),
  });

  const { data, isLoading, isFetching } = useQuery<{ contacts: UnifiedContact[]; total: number }>({
    queryKey: ["contacts", params.toString()],
    queryFn:  () => fetch(`/api/contacts?${params}`).then((r) => r.json()),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const contacts    = data?.contacts ?? [];
  const total       = data?.total    ?? 0;
  const totalPages  = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeChips = Object.values(filters).filter(Boolean).length;

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

  function savePreset() {
    if (!presetName.trim()) return;
    const next = [...presets, { id: crypto.randomUUID(), name: presetName.trim(), filters, search }];
    setPresets(next);
    localStorage.setItem("contacts_presets", JSON.stringify(next));
    setPresetName(""); setSavingPreset(false);
  }

  function deletePreset(id: string) {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    localStorage.setItem("contacts_presets", JSON.stringify(next));
  }

  const clearAll = useCallback(() => { setFilters({ source: "", category: "", hasDemo: "" }); setSearch(""); }, []);

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

        {/* Filters */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-[8px] border transition-colors",
            showFilters || activeChips > 0
              ? "border-primary/30 bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {activeChips > 0 && <span className="ml-0.5 px-1.5 py-px text-[9px] font-bold bg-primary text-white rounded-full leading-tight">{activeChips}</span>}
        </button>

        {/* Active filter chips */}
        {activeChips > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {filters.source && (
              <Chip label={{ ghl: "GHL", comment_lead: "Comment" }[filters.source] ?? filters.source} onRemove={() => setFilters((f) => ({ ...f, source: "" }))} />
            )}
            {filters.category && (
              <Chip label={CATEGORY_BADGE[filters.category]?.label ?? filters.category} onRemove={() => setFilters((f) => ({ ...f, category: "" }))} />
            )}
            {filters.hasDemo === "true"  && <Chip label="Has demo"  onRemove={() => setFilters((f) => ({ ...f, hasDemo: "" }))} />}
            {filters.hasDemo === "false" && <Chip label="No demo"   onRemove={() => setFilters((f) => ({ ...f, hasDemo: "" }))} />}
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

      {/* ── Filter panel ── */}
      {showFilters && (
        <div className="shrink-0 border border-border rounded-[10px] bg-card p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <FilterSelect label="Source" value={filters.source} onChange={(v) => setFilters((f) => ({ ...f, source: v }))} options={[["", "All sources"], ["ghl", "GHL (Meta lead form)"], ["comment_lead", "Comment lead"]]} />
            <FilterSelect label="Category" value={filters.category} onChange={(v) => setFilters((f) => ({ ...f, category: v }))} options={[["", "All categories"], ...Object.entries(CATEGORY_BADGE).map(([k, v]) => [k, v.label] as [string, string])]} />
            <FilterSelect label="Demo" value={filters.hasDemo} onChange={(v) => setFilters((f) => ({ ...f, hasDemo: v }))} options={[["", "All"], ["true", "Has demo"], ["false", "No demo"]]} />
          </div>

          {/* Saved presets */}
          <div className="pt-3 border-t border-border/60 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mr-1">Presets</span>
            {presets.map((p) => (
              <div key={p.id} className="flex items-center">
                <button onClick={() => { setFilters(p.filters); setSearch(p.search); }} className="px-2.5 py-1 text-xs border border-border rounded-l-[6px] bg-card hover:bg-muted transition-colors">{p.name}</button>
                <button onClick={() => deletePreset(p.id)} className="px-1.5 py-1 border border-l-0 border-border rounded-r-[6px] bg-card text-muted-foreground hover:text-rose-500 hover:bg-rose-50 transition-colors"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
            {savingPreset ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") savePreset(); if (e.key === "Escape") setSavingPreset(false); }} placeholder="Name…" className="text-xs px-2 py-1 border border-primary/40 rounded-[6px] bg-card focus:outline-none w-28" />
                <button onClick={savePreset} disabled={!presetName.trim()} className="p-1 text-primary disabled:opacity-30"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={() => setSavingPreset(false)} className="p-1 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button onClick={() => setSavingPreset(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <BookmarkPlus className="w-3.5 h-3.5" /> Save preset
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 min-h-0 overflow-auto rounded-[10px] border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card border-b border-border">
            <tr>
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={contacts.length > 0 && selected.size === contacts.length} onChange={toggleAll} className="rounded border-border" />
              </th>
              <th className="px-4 py-3 text-left min-w-[180px]">
                <SortHeader label="Name" sortKey="name" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-left w-24">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Source</span>
              </th>
              <th className="px-4 py-3 text-left min-w-[140px]">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Stage</span>
              </th>
              <th className="px-4 py-3 text-left w-24">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Demo</span>
              </th>
              <th className="px-4 py-3 text-left w-24">
                <SortHeader label="Touch" sortKey="daysSinceLastTouch" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-left w-32">
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
                  <td colSpan={7} className="py-20 text-center">
                    <Users className="w-9 h-9 text-border mx-auto mb-3" />
                    <p className="text-sm font-medium text-foreground mb-0.5">No contacts found</p>
                    {(search || activeChips > 0) && <p className="text-xs text-muted-foreground">Try adjusting your search or filters</p>}
                  </td>
                </tr>
              )
              : contacts.map((c) => (
                <ContactRow
                  key={c.uid}
                  contact={c}
                  selected={selected.has(c.uid)}
                  onSelect={() => setSelected((prev) => { const n = new Set(prev); n.has(c.uid) ? n.delete(c.uid) : n.add(c.uid); return n; })}
                  onClick={() => setOpenContact(c)}
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

      {openContact && <ContactModal contact={openContact} onClose={() => setOpenContact(null)} />}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ContactRow({ contact: c, selected, onSelect, onClick }: {
  contact: UnifiedContact; selected: boolean; onSelect: () => void; onClick: () => void;
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
          {/* Hover actions */}
          {hovered && (
            <div className="flex items-center gap-0.5 ml-1 shrink-0">
              {c.ghlContactId && (
                <button onClick={(e) => e.stopPropagation()} title="Open conversation" className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <MessageCircle className="w-3.5 h-3.5" />
                </button>
              )}
              {c.website && (
                <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={c.website} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )}
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

      {/* Demo */}
      <td className="px-4 py-3">
        {c.hasDemo ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
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

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs bg-muted text-foreground border border-border/60">
      {label}
      <button onClick={onRemove} className="p-0.5 rounded-full hover:bg-border transition-colors"><X className="w-2.5 h-2.5" /></button>
    </span>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">{label}</p>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full text-sm border border-border rounded-[7px] bg-background px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
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
