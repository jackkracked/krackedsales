"use client";

import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, ChevronDown, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { CallTile, type CallEvent } from "./call-tile";

interface RepOption {
  email: string;
  name: string;
}

interface CallsData {
  events: CallEvent[];
  repOptions: RepOption[];
}

interface CallsStripProps {
  isAdmin: boolean;
}

const TILE_WIDTH = 260; // px — approximate width of each tile + gap

export function CallsStrip({ isAdmin }: CallsStripProps) {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<string>("own");
  const scrollRef = useRef<HTMLDivElement>(null);

  function buildUrl(mode: string) {
    if (mode === "own") return "/api/dashboard/calls";
    if (mode === "allReps") return "/api/dashboard/calls?allReps=true";
    return `/api/dashboard/calls?rep=${encodeURIComponent(mode)}`;
  }

  const { data, isLoading } = useQuery<CallsData>({
    queryKey: ["dashboard-calls", viewMode],
    queryFn: () => fetch(buildUrl(viewMode)).then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const events = data?.events ?? [];
  const repOptions = data?.repOptions ?? [];

  const now = new Date();
  const nextEventId = events.find((e) => new Date(e.startTime) >= now)?.id ?? null;

  function handleDispositioned(eventId: string) {
    queryClient.setQueryData<CallsData>(["dashboard-calls", viewMode], (prev) => {
      if (!prev) return prev;
      return { ...prev, events: prev.events.filter((e) => e.id !== eventId) };
    });
  }

  function scroll(dir: "left" | "right") {
    if (!scrollRef.current) return;
    const amount = TILE_WIDTH * 4;
    scrollRef.current.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  }

  const currentLabel =
    viewMode === "own" ? "My Calls"
    : viewMode === "allReps" ? "All Reps"
    : repOptions.find((r) => r.email === viewMode)?.name?.split(" ")[0] ?? viewMode;

  return (
    <div className="bg-card border border-border rounded-[10px] p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4 text-muted-foreground" />
          <h3
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Calls
          </h3>
          {events.length > 0 && (
            <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full tabular-nums">
              {events.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Carousel arrows — only shown when there are events */}
          {events.length > 4 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => scroll("left")}
                className="p-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => scroll("right")}
                className="p-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Admin rep switcher */}
          {isAdmin && repOptions.length > 0 && (
            <div className="relative">
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1 text-xs font-medium border border-border rounded-[7px] bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer"
              >
                <option value="own">My Calls</option>
                {repOptions.map((r) => (
                  <option key={r.email} value={r.email}>{r.name.split(" ")[0]}&apos;s Calls</option>
                ))}
                <option value="allReps">All Reps</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[160px] w-[260px] shrink-0 rounded-[10px] bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-primary/30 mb-2" />
          <p className="text-sm font-medium text-foreground">All clear</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {viewMode === "allReps"
              ? "No pending calls across the team."
              : `No pending calls for ${currentLabel}.`}
            {" "}New bookings will appear here automatically.
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scroll-smooth pb-1"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {events.map((event) => (
            <div key={event.id} className="shrink-0 w-[260px]">
              <CallTile
                event={event}
                isNext={event.id === nextEventId}
                isAdmin={isAdmin && viewMode === "allReps"}
                onDispositioned={handleDispositioned}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
