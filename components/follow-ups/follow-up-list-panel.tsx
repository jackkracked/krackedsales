"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { FollowUpContactCard } from "./follow-up-contact-card";
import type { FollowUpItem } from "./follow-up-contact-card";
import { FollowUpEmpty } from "./follow-up-empty";

interface Props {
  needsAction: FollowUpItem[];
  waiting: FollowUpItem[];
  selectedOppId: string | null;
  onSelect: (item: FollowUpItem) => void;
}

export function FollowUpListPanel({
  needsAction,
  waiting,
  selectedOppId,
  onSelect,
}: Props) {
  const [search, setSearch] = useState("");

  function filter(items: FollowUpItem[]) {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((i) => i.contactName.toLowerCase().includes(q));
  }

  const filteredAction = filter(needsAction);
  const filteredWaiting = filter(waiting);
  const isEmpty = filteredAction.length === 0 && filteredWaiting.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            data-r10n-search
            type="text"
            placeholder="Search contacts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-8 pr-3 py-1.5 rounded-[7px] bg-muted/40 border border-transparent focus:border-primary/30 focus:outline-none text-foreground placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {isEmpty ? (
          <FollowUpEmpty />
        ) : (
          <>
            {filteredAction.length > 0 && (
              <section>
                <SectionHeader
                  label="Needs Action"
                  count={filteredAction.length}
                  dotColor="bg-red-500"
                  kind="negative"
                />
                <div className="space-y-1.5 mt-1.5">
                  {filteredAction.map((item) => (
                    <FollowUpContactCard
                      key={item.oppId}
                      item={item}
                      isSelected={selectedOppId === item.oppId}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </section>
            )}

            {filteredWaiting.length > 0 && (
              <section>
                <SectionHeader
                  label="Waiting"
                  count={filteredWaiting.length}
                  dotColor="bg-green-400"
                  kind="positive"
                />
                <div className="space-y-1.5 mt-1.5">
                  {filteredWaiting.map((item) => (
                    <FollowUpContactCard
                      key={item.oppId}
                      item={item}
                      isSelected={selectedOppId === item.oppId}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  dotColor,
  kind,
}: {
  label: string;
  count: number;
  dotColor: string;
  kind: "positive" | "negative";
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span
        data-r10n-followup-sectiondot
        data-kind={kind}
        className={cn("w-1.5 h-1.5 rounded-full", dotColor)}
      />
      <span data-r10n-th className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span data-r10n-followup-sectioncount className="text-xs text-muted-foreground/60">({count})</span>
    </div>
  );
}
