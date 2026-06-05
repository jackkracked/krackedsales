"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { Globe, X } from "lucide-react";

/** Human-readable label for an IANA timezone */
function tzLabel(tz: string): string {
  try {
    const now = new Date();
    const short = now.toLocaleTimeString("en-US", { timeZone: tz, timeZoneName: "short" }).split(" ").pop() ?? "";
    const city = tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
    return `${city} (${short})`;
  } catch {
    return tz;
  }
}

export function TimezoneDetector() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [detectedTz, setDetectedTz] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const { data: me } = useQuery<{ id: string; role: string; timezone: string | null }>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/me").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!me) return;

    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserTz) return;

    // If user has no timezone set, silently set it to browser timezone
    if (!me.timezone) {
      fetch("/api/me/timezone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: browserTz }),
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["me"] });
      });
      return;
    }

    // If timezone differs from stored, show the modal
    if (me.timezone !== browserTz) {
      setDetectedTz(browserTz);
      setShowModal(true);
    }
  }, [me, queryClient]);

  async function handleUpdate() {
    if (!detectedTz) return;
    setUpdating(true);
    try {
      await fetch("/api/me/timezone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: detectedTz }),
      });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      setShowModal(false);
    } finally {
      setUpdating(false);
    }
  }

  function handleDismiss() {
    setShowModal(false);
  }

  if (!showModal || !detectedTz || !me?.timezone) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-slide-up-fade">
      <div className="bg-card border border-border rounded-[12px] shadow-xl p-4 w-[340px]">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Globe className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-semibold text-foreground mb-1"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Timezone changed?
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              Your browser is in <span className="font-medium text-foreground">{tzLabel(detectedTz)}</span>,
              but your account is set to <span className="font-medium text-foreground">{tzLabel(me.timezone)}</span>.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleUpdate}
                disabled={updating}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-[7px] transition-all",
                  "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {updating ? "Updating..." : `Use ${tzLabel(detectedTz).split(" (")[0]}`}
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Keep current
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
