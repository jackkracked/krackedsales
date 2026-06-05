"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Headphones, X, ExternalLink } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

interface FathomStatusData {
  connected: boolean;
}

async function fetchFathomStatus(): Promise<FathomStatusData> {
  const res = await fetch("/api/fathom/status");
  if (!res.ok) throw new Error("Failed to fetch Fathom status");
  return res.json();
}

export function FathomNudgeBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data: status, isLoading } = useQuery<FathomStatusData>({
    queryKey: ["fathom-status"],
    queryFn: fetchFathomStatus,
    staleTime: Infinity,
  });

  // Hide while loading, if connected, or if dismissed
  if (isLoading || status?.connected || dismissed) return null;

  return (
    <div
      className={cn(
        "relative flex items-center justify-between gap-4 rounded-[10px] border border-primary/15 px-5 py-4",
        "bg-primary/[0.04]"
      )}
    >
      {/* Left: icon + text */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center justify-center w-9 h-9 rounded-[8px] bg-primary/10 shrink-0">
          <Headphones className="w-4.5 h-4.5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">
            Connect Fathom to automatically transcribe every sales call
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Get AI-powered call insights, objection tracking, and auto-filled dispositions
          </p>
        </div>
      </div>

      {/* Right: buttons */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/settings?tab=integrations&panel=fathom"
          className={cn(
            "inline-flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
            "bg-primary text-white hover:bg-primary/90"
          )}
        >
          Connect Now
        </Link>
        <a
          href="https://fathom.video"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
            "border border-border hover:bg-muted"
          )}
        >
          Download Fathom
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors ml-1"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
