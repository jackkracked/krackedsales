"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BrandCategory = "ecommerce" | "service" | "local" | "b2b" | "other";

export interface CategoryEntry {
  category: BrandCategory;
  reason: string;
  analyzedAt: string;
}

interface BrandCategoryStore {
  categories: Record<string, CategoryEntry>; // keyed by normalized domain
  contactCategories: Record<string, BrandCategory>; // contactId → category (for fast KPI lookups)
  websiteByContactId: Record<string, string>; // contactId → raw website URL (for pipeline search)
  analyzing: string[];                        // domains currently in-flight
  setCategory: (domain: string, entry: CategoryEntry) => void;
  getCategory: (domain: string) => CategoryEntry | null;
  setContactCategory: (contactId: string, category: BrandCategory) => void;
  setContactWebsite: (contactId: string, url: string) => void;
  markAnalyzing: (domain: string) => void;
  clearAnalyzing: (domain: string) => void;
  isAnalyzing: (domain: string) => boolean;
}

export function normalizeDomain(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

export const useBrandCategoryStore = create<BrandCategoryStore>()(
  persist(
    (set, get) => ({
      categories: {},
      contactCategories: {},
      websiteByContactId: {},
      analyzing: [],

      setCategory: (domain, entry) =>
        set((s) => ({
          categories: { ...s.categories, [normalizeDomain(domain)]: entry },
          analyzing: s.analyzing.filter((d) => d !== normalizeDomain(domain)),
        })),

      getCategory: (domain) =>
        get().categories[normalizeDomain(domain)] ?? null,

      setContactCategory: (contactId, category) =>
        set((s) => ({
          contactCategories: { ...s.contactCategories, [contactId]: category },
        })),

      setContactWebsite: (contactId, url) =>
        set((s) => ({
          websiteByContactId: { ...s.websiteByContactId, [contactId]: url },
        })),

      markAnalyzing: (domain) =>
        set((s) => ({
          analyzing: s.analyzing.includes(normalizeDomain(domain))
            ? s.analyzing
            : [...s.analyzing, normalizeDomain(domain)],
        })),

      clearAnalyzing: (domain) =>
        set((s) => ({
          analyzing: s.analyzing.filter((d) => d !== normalizeDomain(domain)),
        })),

      isAnalyzing: (domain) =>
        get().analyzing.includes(normalizeDomain(domain)),
    }),
    {
      name: "kracked-brand-categories",
      // Only persist categories maps, never the in-flight analyzing list.
      partialize: (s) => ({ categories: s.categories, contactCategories: s.contactCategories, websiteByContactId: s.websiteByContactId }),
      // Ignore any stale `analyzing` entries from old localStorage entries.
      merge: (persisted, current) => ({
        ...current,
        categories: (persisted as Partial<BrandCategoryStore>).categories ?? {},
        contactCategories: (persisted as Partial<BrandCategoryStore>).contactCategories ?? {},
        websiteByContactId: (persisted as Partial<BrandCategoryStore>).websiteByContactId ?? {},
      }),
    }
  )
);
