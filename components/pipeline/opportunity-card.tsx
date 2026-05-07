"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { Check, Clock, ExternalLink, MessageCircle } from "lucide-react";
import { relativeTime } from "@/lib/utils/date";
import { cleanUrl, looksLikeUrl, parseQualificationNote, isQualificationNote } from "@/lib/utils/url";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { useBrandCategoryStore, normalizeDomain, type BrandCategory } from "@/store/brand-category-store";

// Global stagger counter — spaces out concurrent categorize-brand requests to avoid
// hammering the Gemini rate limit when many cards mount simultaneously.
let _staggerIndex = 0;
function nextStaggerDelay(): number {
  // Each request waits an extra 400ms over the previous one, reset after 30s of idle
  const delay = (_staggerIndex % 10) * 400;
  _staggerIndex++;
  setTimeout(() => { _staggerIndex = Math.max(0, _staggerIndex - 1); }, 30_000);
  return delay;
}

const CATEGORY_CONFIG: Record<BrandCategory, { label: string; className: string }> = {
  ecommerce: { label: "DTC", className: "bg-green-100 text-green-700" },
  service:   { label: "Service", className: "bg-amber-100 text-amber-700" },
  local:     { label: "Local", className: "bg-blue-100 text-blue-700" },
  b2b:       { label: "B2B", className: "bg-purple-100 text-purple-700" },
  other:     { label: "Other", className: "bg-muted text-muted-foreground" },
};

function getSourceBadge(source?: string | null): { label: string; className: string } {
  if (!source) return { label: "FB", className: "bg-blue-50 text-blue-700" };
  const s = source.toLowerCase();
  if (s.includes("tiktok") || s.includes("tik tok")) {
    return { label: "TikTok", className: "bg-slate-50 text-slate-700" };
  }
  if (/\binstagram\b/.test(s)) {
    return { label: "IG", className: "bg-pink-50 text-pink-700" };
  }
  return { label: "FB", className: "bg-blue-50 text-blue-700" };
}

/** Lazy-fetch the contact's website URL from their qualification note */
function useContactWebsite(contactId: string | undefined) {
  return useQuery({
    queryKey: ["contact-website", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/contacts/${contactId}/notes`);
      if (!res.ok) return null;
      const data = await res.json();
      const notes: Array<{ id: string; body: string }> = data.notes ?? [];
      const qualNote = notes.find((n) => isQualificationNote(n.body));
      if (!qualNote) return null;
      const qaPairs = parseQualificationNote(qualNote.body);
      const urlPair = qaPairs.find((qa) => qa.isUrl);
      return urlPair?.cleanedUrl ?? null;
    },
    enabled: !!contactId,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

interface OpportunityCardProps {
  opportunity: GHLOpportunity;
  isDragging?: boolean;
  hasUnread?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
  onClick?: () => void;
  onMessageClick?: () => void;
}

export function OpportunityCard({
  opportunity,
  isDragging,
  hasUnread,
  isSelected,
  onToggleSelect,
  onClick,
  onMessageClick,
}: OpportunityCardProps) {
  const name = opportunity.contact?.name ?? opportunity.name ?? "Unknown";
  const sourceBadge = getSourceBadge(opportunity.source);
  const { data: websiteRaw, isLoading: websiteLoading } = useContactWebsite(opportunity.contact?.id);
  const { getCategory, setCategory, setContactCategory, setContactWebsite, markAnalyzing, clearAnalyzing, isAnalyzing } = useBrandCategoryStore();

  // Lazy-categorize when website is known and not yet categorized
  useEffect(() => {
    if (!websiteRaw || !looksLikeUrl(websiteRaw)) return;
    const domain = normalizeDomain(websiteRaw);
    if (getCategory(domain) || isAnalyzing(domain)) return;

    markAnalyzing(domain);
    const delay = nextStaggerDelay();
    setTimeout(() => fetch("/api/ai/categorize-brand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ website: websiteRaw }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.category) {
          setCategory(domain, {
            category: d.category,
            reason: d.reason ?? "",
            analyzedAt: new Date().toISOString(),
          });
          // Also index by contact ID so the KPI page can count DTC leads by period
          if (opportunity.contact?.id) {
            setContactCategory(opportunity.contact.id, d.category);
          }
        } else {
          clearAnalyzing(domain);
        }
      })
      .catch(() => clearAnalyzing(domain))
    , delay);
  }, [websiteRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const categoryEntry = websiteRaw ? getCategory(normalizeDomain(websiteRaw)) : null;

  // If category was already cached (prior session), populate contactCategories now
  useEffect(() => {
    if (categoryEntry && opportunity.contact?.id) {
      setContactCategory(opportunity.contact.id, categoryEntry.category);
    }
  }, [categoryEntry?.category, opportunity.contact?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cache website URL by contactId so pipeline search can match on it
  useEffect(() => {
    if (websiteRaw && opportunity.contact?.id) {
      setContactWebsite(opportunity.contact.id, websiteRaw);
    }
  }, [websiteRaw, opportunity.contact?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const websiteUrl = websiteRaw && looksLikeUrl(websiteRaw)
    ? cleanUrl(websiteRaw).toLowerCase()
    : null;

  const websiteDisplay = websiteUrl
    ? websiteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
    : null;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative bg-card border rounded-[10px] p-3 cursor-pointer",
        "hover:border-primary/40 hover:shadow-sm transition-all duration-150",
        isDragging && "opacity-50 rotate-1 shadow-lg",
        isSelected
          ? "border-primary/30 bg-primary/[0.03] ring-1 ring-primary/15"
          : "border-border"
      )}
    >
      {/* Checkbox — appears on hover, always shown when selected */}
      {onToggleSelect && (
        <div
          onClick={(e) => { e.stopPropagation(); onToggleSelect(e); }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "absolute top-2.5 left-2.5 z-10 transition-opacity duration-100",
            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <div className={cn(
            "w-[15px] h-[15px] rounded-[3px] flex items-center justify-center border transition-colors",
            isSelected
              ? "bg-primary border-primary"
              : "bg-card border-border hover:border-primary/50"
          )}>
            {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
          </div>
        </div>
      )}

      {/* Name — shifts right on hover/selection to make room for the checkbox */}
      <p className={cn(
        "text-sm font-semibold text-foreground leading-tight mb-1.5 line-clamp-1 transition-[padding] duration-150",
        onToggleSelect && (isSelected ? "pl-5" : "group-hover:pl-5")
      )}>
        {name}
      </p>

      {/* Source badge + brand category badge */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium", sourceBadge.className)}>
          {sourceBadge.label}
        </span>
        {categoryEntry && (
          <span
            className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium", CATEGORY_CONFIG[categoryEntry.category as BrandCategory]?.className)}
            title={categoryEntry.reason}
          >
            {CATEGORY_CONFIG[categoryEntry.category as BrandCategory]?.label ?? categoryEntry.category}
          </span>
        )}
      </div>

      {/* Website URL row */}
      {websiteDisplay ? (
        <div className="flex items-center gap-1 text-xs mb-2">
          <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground" />
          <a
            href={websiteUrl!}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline truncate"
            title={websiteUrl!}
          >
            {websiteDisplay}
          </a>
        </div>
      ) : !websiteLoading ? (
        <p className="text-xs text-muted-foreground/60 italic mb-2">
          Website not given
        </p>
      ) : (
        <div className="h-4 mb-2" />
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          {relativeTime(opportunity.createdAt)}
        </span>

        {hasUnread && (
          <button
            onClick={(e) => { e.stopPropagation(); onMessageClick?.(); }}
            className="relative flex items-center justify-center w-6 h-6 rounded-full hover:bg-red-50 transition-colors group/reply"
            title="Awaiting reply — click to message"
          >
            <MessageCircle className="w-3.5 h-3.5 text-muted-foreground/50 group-hover/reply:text-red-500 transition-colors" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 border-2 border-card animate-pulse" />
          </button>
        )}
      </div>
    </div>
  );
}
