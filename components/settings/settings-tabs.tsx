"use client";

import { useState } from "react";
import { Users, DollarSign, Zap, BarChart2, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { TeamSettings } from "@/components/settings/team-settings";
import { SoftwareCosts } from "@/components/settings/software-costs";
import { CostSettings } from "@/components/settings/cost-settings";
import { DemoTargets } from "@/components/settings/demo-targets";
import { IntegrationsGrid } from "@/components/settings/integrations-grid";
import { UserCalendarsSettings } from "@/components/settings/user-calendars-settings";
import { BookingRulesSettings } from "@/components/settings/booking-rules-settings";

const TABS = [
  { id: "team",         label: "Team",         icon: Users,         description: "Manage users and access" },
  { id: "costs",        label: "Costs",        icon: DollarSign,    description: "Software subscriptions and demo costs" },
  { id: "demo",         label: "Demo Tracker", icon: BarChart2,     description: "Target turnaround times per stage" },
  { id: "calendars",    label: "Calendars",    icon: CalendarDays,  description: "Team calendars and booking automation rules" },
  { id: "integrations", label: "Integrations", icon: Zap,           description: "Manage your connected services and automations" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsTabs() {
  const [activeTab, setActiveTab] = useState<TabId>("team");

  const active = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="border-b border-border bg-card px-6 pt-6 flex-shrink-0">
        <h1
          className="text-2xl font-bold text-foreground mb-1"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Settings
        </h1>
        <p className="text-sm text-muted-foreground mb-5">{active.description}</p>

        <nav className="flex gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-[6px] transition-colors relative",
                  "focus:outline-none",
                  isActive
                    ? "text-primary bg-background border border-b-background border-border -mb-px z-10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto bg-background">
        {activeTab === "team" && (
          <div className="p-6">
            <div className="max-w-3xl">
              <TeamSettings />
            </div>
          </div>
        )}

        {activeTab === "costs" && (
          <div className="p-6">
            <div className="max-w-3xl space-y-6">
              <SoftwareCosts />
              <CostSettings />
            </div>
          </div>
        )}

        {activeTab === "demo" && (
          <div className="p-6">
            <div className="max-w-3xl">
              <DemoTargets />
            </div>
          </div>
        )}

        {activeTab === "calendars" && (
          <div className="p-6">
            <div className="max-w-3xl space-y-6">
              <UserCalendarsSettings />
              <BookingRulesSettings />
            </div>
          </div>
        )}

        {activeTab === "integrations" && <IntegrationsGrid />}
      </div>
    </div>
  );
}
