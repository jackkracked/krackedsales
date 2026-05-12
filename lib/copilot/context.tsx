"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";

export interface CopilotPageContext {
  page: string;
  pageTitle: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
}

interface CopilotContextValue {
  context: CopilotPageContext;
  setContext: (ctx: Partial<CopilotPageContext>) => void;
}

const CopilotCtx = createContext<CopilotContextValue>({
  context: { page: "dashboard", pageTitle: "Dashboard" },
  setContext: () => {},
});

const PATH_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  pipeline: "Pipeline",
  contacts: "Contacts",
  inbox: "Inbox",
  calls: "Calls",
  calendar: "Calendar",
  kpis: "KPIs",
  "demo-tracker": "Demo Tracker",
  analytics: "Analytics",
  "follow-ups": "Follow-ups",
  templates: "Templates",
  settings: "Settings",
};

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [context, setContextState] = useState<CopilotPageContext>({
    page: "dashboard",
    pageTitle: "Dashboard",
  });

  useEffect(() => {
    const slug = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
    setContextState((prev) => ({
      ...prev,
      page: slug,
      pageTitle: PATH_LABELS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1),
      entityType: undefined,
      entityId: undefined,
      entityName: undefined,
    }));
  }, [pathname]);

  const setContext = useCallback((partial: Partial<CopilotPageContext>) => {
    setContextState((prev) => ({ ...prev, ...partial }));
  }, []);

  return (
    <CopilotCtx.Provider value={{ context, setContext }}>
      {children}
    </CopilotCtx.Provider>
  );
}

export function useCopilotContext() {
  return useContext(CopilotCtx);
}
