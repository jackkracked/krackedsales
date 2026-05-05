"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIStore {
  // Sidebar
  sidebarCollapsed: boolean;
  sidebarOpen: boolean; // mobile sheet open
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebarCollapsed: () => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarOpen: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: "kracked-ui",
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    }
  )
);
