"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MetaPage {
  pageId: string;
  pageName: string;
  pageAvatar: string | null;
  instagramHandle: string | null;
  instagramAvatar: string | null;
  connectedAt: string;
  tokenPreview: string | null;
}

interface MetaSettingsData {
  pages: MetaPage[];
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchMetaPages(): Promise<MetaSettingsData> {
  const res = await fetch("/api/settings/meta");
  if (!res.ok) throw new Error("Failed to fetch Meta settings");
  return res.json();
}

async function disconnectMetaPage(pageId: string): Promise<void> {
  const res = await fetch(`/api/settings/meta/${pageId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to disconnect page");
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function MetaIcon({ className }: { className?: string }) {
  // Meta infinity wordmark — simplified SVG path
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="8" fill="#1877F2" />
      <path
        d="M18 8C12.477 8 8 12.477 8 18c0 4.991 3.657 9.128 8.438 9.879V20.89h-2.54V18h2.54v-2.203c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V18h2.773l-.443 2.89h-2.33v6.989C24.343 27.128 28 22.991 28 18c0-5.523-4.477-10-10-10z"
        fill="white"
      />
    </svg>
  );
}

function InstagramGradientIcon({ className }: { className?: string }) {
  const gradId = "ig-grad-meta-settings";
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <radialGradient
          id={gradId}
          cx="30%"
          cy="107%"
          r="150%"
        >
          <stop offset="0%" stopColor="#ffd600" />
          <stop offset="50%" stopColor="#ff0069" />
          <stop offset="100%" stopColor="#d300c5" />
        </radialGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill={`url(#${gradId})`} />
      <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1.5" fill="none" />
      <circle cx="17.5" cy="6.5" r="1" fill="white" />
    </svg>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageAvatar({
  src,
  name,
  size = "md",
}: {
  src: string | null;
  name: string;
  size?: "md" | "sm";
}) {
  const sizeClass = size === "md" ? "w-10 h-10 text-sm" : "w-6 h-6 text-xs";

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={cn("rounded-full object-cover shrink-0 ring-2 ring-white", sizeClass)}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full shrink-0 flex items-center justify-center font-semibold text-white",
        "ring-2 ring-white",
        sizeClass
      )}
      style={{ background: "#1877F2" }}
      aria-label={name}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function formatConnectedDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function PageCard({
  page,
  onDisconnect,
  isDisconnecting,
}: {
  page: MetaPage;
  onDisconnect: () => void;
  isDisconnecting: boolean;
}) {
  function handleDisconnect() {
    const confirmed = window.confirm(
      `Disconnect "${page.pageName}"? This will stop receiving messages from this page.`
    );
    if (confirmed) onDisconnect();
  }

  return (
    <div
      className={cn(
        "bg-muted/40 rounded-lg p-4 transition-all duration-200",
        "ring-1 ring-transparent hover:ring-border hover:shadow-sm"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left — avatar + info */}
        <div className="flex items-start gap-3 min-w-0">
          <PageAvatar src={page.pageAvatar} name={page.pageName} size="md" />

          <div className="min-w-0 space-y-1.5">
            {/* Page name */}
            <p className="text-sm font-semibold text-foreground leading-tight truncate">
              {page.pageName}
            </p>
            <p className="text-xs text-muted-foreground">Facebook Page</p>

            {/* Instagram row — only when handle exists */}
            {page.instagramHandle && (
              <div className="flex items-center gap-1.5 mt-1">
                {page.instagramAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={page.instagramAvatar}
                    alt={page.instagramHandle}
                    className="w-4 h-4 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <InstagramGradientIcon className="w-4 h-4 shrink-0" />
                )}
                <span className="text-xs text-muted-foreground">
                  @{page.instagramHandle}
                </span>
              </div>
            )}

            {/* Connected date */}
            <p className="text-xs text-muted-foreground/70">
              Connected {formatConnectedDate(page.connectedAt)}
            </p>
          </div>
        </div>

        {/* Right — disconnect */}
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={isDisconnecting}
          className={cn(
            "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-[6px]",
            "text-xs font-medium transition-colors",
            "border border-destructive/40 text-destructive",
            "hover:bg-destructive/5 hover:border-destructive/60",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {isDisconnecting && <RefreshCw className="w-3 h-3 animate-spin" />}
          Disconnect
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-muted/40 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-2 pt-0.5">
              <div className="h-3.5 bg-muted rounded w-2/5" />
              <div className="h-3 bg-muted rounded w-1/4" />
              <div className="h-3 bg-muted rounded w-1/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-4">
        <MetaIcon className="w-10 h-10 opacity-80" />
      </div>
      <p
        className="text-sm font-semibold text-foreground mb-1"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        No pages connected
      </p>
      <p className="text-xs text-muted-foreground max-w-[280px] mb-5 leading-relaxed">
        Connect your Facebook Page to manage Instagram and Facebook messages from
        this app.
      </p>
      <button
        type="button"
        onClick={onConnect}
        className={cn(
          "inline-flex items-center gap-2 px-5 py-2.5 rounded-[8px]",
          "text-sm font-semibold text-white transition-colors",
          "shadow-sm hover:shadow"
        )}
        style={{ background: "#1877F2" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "#1666d8")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "#1877F2")
        }
      >
        <MetaIcon className="w-4 h-4" />
        Connect Facebook Page
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MetaSettings() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<MetaSettingsData>({
    queryKey: ["meta-pages"],
    queryFn: fetchMetaPages,
    refetchOnWindowFocus: true,
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectMetaPage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta-pages"] });
    },
  });

  function openMetaOAuth() {
    const popup = window.open(
      "/api/meta/auth",
      "meta-oauth",
      "width=600,height=700,scrollbars=yes"
    );

    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "meta-oauth-success") {
        window.removeEventListener("message", handleMessage);
        popup?.close();
        queryClient.invalidateQueries({ queryKey: ["meta-pages"] });
      }
    }

    window.addEventListener("message", handleMessage);
  }

  const pages = data?.pages ?? [];
  const hasPages = pages.length > 0;

  return (
    <div className="bg-card border border-border rounded-[10px] p-5 space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <MetaIcon className="w-5 h-5 shrink-0" />
          <h2
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Meta — Facebook &amp; Instagram
          </h2>
        </div>

        {/* Show "+ Connect Page" in header only when pages already exist */}
        {hasPages && (
          <button
            type="button"
            onClick={openMetaOAuth}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px]",
              "text-xs font-semibold text-white transition-colors"
            )}
            style={{ background: "#1877F2" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "#1666d8")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "#1877F2")
            }
          >
            + Connect Page
          </button>
        )}
      </div>

      {/* Error banner */}
      {isError && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-[6px] bg-destructive/8 border border-destructive/20 text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p className="text-xs font-medium">
            Failed to load Meta settings. Please refresh and try again.
          </p>
        </div>
      )}

      {/* Disconnect error */}
      {disconnectMutation.isError && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-[6px] bg-destructive/8 border border-destructive/20 text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p className="text-xs font-medium">
            Failed to disconnect page. Please try again.
          </p>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : hasPages ? (
        <div className="space-y-2.5">
          {pages.map((page) => (
            <PageCard
              key={page.pageId}
              page={page}
              onDisconnect={() => disconnectMutation.mutate(page.pageId)}
              isDisconnecting={
                disconnectMutation.isPending &&
                disconnectMutation.variables === page.pageId
              }
            />
          ))}
        </div>
      ) : (
        !isError && <EmptyState onConnect={openMetaOAuth} />
      )}
    </div>
  );
}
