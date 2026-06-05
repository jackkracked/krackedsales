"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/avatar";
import { Check, Clock, ExternalLink, MessageCircle } from "lucide-react";
import { relativeTime } from "@/lib/utils/date";
import { cleanUrl, looksLikeUrl, isQualificationNote, parseQualificationNote } from "@/lib/utils/url";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { useBrandCategoryStore, normalizeDomain, type BrandCategory } from "@/store/brand-category-store";
import { quickHealthTier } from "@/lib/deal-health";

// Global stagger counter — spaces out concurrent categorize-brand requests to avoid
// hammering the Gemini rate limit when many cards mount simultaneously.
let _staggerIndex = 0;
function nextStaggerDelay(): number {
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

type CardStatus = "awaiting_reply" | "no_response" | "needs_attention" | "replied";

const STATUS_CONFIG: Record<CardStatus, { label: string; pillClass: string; glowClass: string }> = {
  awaiting_reply: {
    label: "Awaiting reply",
    pillClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    glowClass: "ring-1 ring-emerald-400/40 shadow-[0_0_8px_-2px_oklch(0.75_0.17_155/0.35)]",
  },
  no_response: {
    label: "No response",
    pillClass: "bg-red-50 text-red-600 border-red-200",
    glowClass: "ring-1 ring-red-400/40 shadow-[0_0_8px_-2px_oklch(0.63_0.2_25/0.35)]",
  },
  needs_attention: {
    label: "Needs attention",
    pillClass: "bg-amber-50 text-amber-700 border-amber-200",
    glowClass: "ring-1 ring-amber-400/40 shadow-[0_0_8px_-2px_oklch(0.8_0.16_80/0.35)]",
  },
  replied: {
    label: "Replied",
    pillClass: "bg-muted text-muted-foreground border-border",
    glowClass: "",
  },
};

function deriveStatus(hasUnread: boolean, healthTier: "healthy" | "at_risk" | "cold"): CardStatus {
  if (hasUnread) return "awaiting_reply";
  if (healthTier === "cold") return "no_response";
  if (healthTier === "at_risk") return "needs_attention";
  return "replied";
}

/** Lazy-fetch the contact's website URL — tries contact.website first, then custom fields */
function useContactWebsite(contactId: string | undefined, contactWebsite?: string | null) {
  return useQuery({
    queryKey: ["contact-website", contactId],
    queryFn: async () => {
      // If the contact already has a website field, use it
      if (contactWebsite && looksLikeUrl(contactWebsite)) {
        return cleanUrl(contactWebsite);
      }

      // Otherwise fetch the contact and look in custom fields for a URL
      const res = await fetch(`/api/ghl/contacts/${contactId}`);
      if (!res.ok) return null;
      const data = await res.json();
      const contact = data.contact;
      if (!contact) return null;

      // Check standard website field first
      if (contact.website && looksLikeUrl(contact.website)) {
        return cleanUrl(contact.website);
      }

      // Search custom fields for anything with "website" or "url" in the field value that looks like a URL
      const fields: Array<{ id: string; field_value?: string; value?: string }> =
        contact.customFields ?? contact.customField ?? [];

      for (const f of fields) {
        const val = f.field_value ?? f.value ?? "";
        if (val && looksLikeUrl(val)) return cleanUrl(val);
      }

      // Fall back to the qualification NOTE — older / Zapier-created leads store
      // the website there ("What is your eCommerce website URL? ..."), not in a
      // form field. Mirrors the form→notes fallback used in the qualification tab.
      try {
        const notesRes = await fetch(`/api/ghl/contacts/${contactId}/notes`);
        if (notesRes.ok) {
          const notesData = await notesRes.json();
          const qualNote = (notesData.notes ?? []).find(
            (n: { body: string }) => isQualificationNote(n.body),
          );
          if (qualNote) {
            const urlPair = parseQualificationNote(qualNote.body).find(
              (qa) => qa.isUrl && qa.cleanedUrl,
            );
            if (urlPair?.cleanedUrl) return urlPair.cleanedUrl;
          }
        }
      } catch {
        /* notes unavailable — fall through to no-website */
      }

      return null;
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
  repName?: string | null;
  onToggleSelect?: (e: React.MouseEvent) => void;
  onClick?: () => void;
  onMessageClick?: () => void;
}

export function OpportunityCard({
  opportunity,
  isDragging,
  hasUnread = false,
  isSelected,
  repName,
  onToggleSelect,
  onClick,
  onMessageClick,
}: OpportunityCardProps) {
  const name = opportunity.contact?.name ?? opportunity.name ?? "Unknown";
  const sourceBadge = getSourceBadge(opportunity.source);
  const { data: websiteRaw, isLoading: websiteLoading } = useContactWebsite(opportunity.contact?.id, opportunity.contact?.website);
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

  useEffect(() => {
    if (categoryEntry && opportunity.contact?.id) {
      setContactCategory(opportunity.contact.id, categoryEntry.category);
    }
  }, [categoryEntry?.category, opportunity.contact?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Status derivation
  const healthTier = opportunity.status === "open" ? quickHealthTier(opportunity.updatedAt) : "healthy";
  const status = deriveStatus(hasUnread, healthTier);
  const statusConfig = STATUS_CONFIG[status];


  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative bg-card border rounded-[10px] p-3 cursor-pointer transition-all duration-150",
        isDragging && "opacity-50 rotate-1 shadow-lg",
        isSelected
          ? "border-primary/30 bg-primary/[0.03] ring-1 ring-primary/15"
          : cn("border-border hover:border-primary/40 hover:shadow-sm", statusConfig.glowClass)
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

      {/* Top row: Name + Rep avatar */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className={cn(
          "text-sm font-semibold text-foreground leading-tight line-clamp-1 transition-[padding] duration-150 flex-1 min-w-0",
          onToggleSelect && (isSelected ? "pl-5" : "group-hover:pl-5")
        )}>
          {name}
        </p>

        {/* Rep avatar */}
        {repName && (
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <span className="text-[8px] uppercase tracking-wider text-muted-foreground/50 font-medium leading-none">Rep</span>
            <Avatar name={repName} size={24} variant="rep" />
          </div>
        )}
      </div>

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

      {/* Created date */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2.5">
        <Clock className="w-3 h-3" />
        {relativeTime(opportunity.createdAt)}
      </div>

      {/* Footer: Status pill + Chat icon */}
      <div className="flex items-center justify-between">
        <span className={cn(
          "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border",
          statusConfig.pillClass
        )}>
          {statusConfig.label}
        </span>

        <button
          onClick={(e) => { e.stopPropagation(); onMessageClick?.(); }}
          className={cn(
            "relative flex items-center justify-center w-7 h-7 rounded-full transition-colors",
            hasUnread
              ? "text-muted-foreground/60 hover:bg-emerald-50 hover:text-emerald-600"
              : "text-muted-foreground/30 hover:bg-muted/50 hover:text-muted-foreground"
          )}
          title="Open conversation"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          {hasUnread && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border-2 border-card" />
          )}
        </button>
      </div>
    </div>
  );
}
