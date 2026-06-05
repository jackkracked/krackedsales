"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { MetaSettings } from "@/components/settings/meta-settings";
import { TikTokSettings } from "@/components/settings/tiktok-settings";
import { SlackSettings } from "@/components/settings/slack-settings";
import { N8nSettings } from "@/components/settings/n8n-settings";
import { FathomConnectCard } from "@/components/fathom/fathom-connect-card";
import { KeywordManager } from "@/components/settings/keyword-manager";

// ─── Types ─────────────────────────────────────────────────────────────────────

type IntegrationId = "ghl" | "clickup" | "meta" | "tiktok" | "slack" | "n8n" | "fathom";
type StatusVariant = "connected" | "configured" | "not-connected" | "always-on";

// ─── Status fetching ────────────────────────────────────────────────────────────

interface MetaData { pages: unknown[] }
interface TikTokData { isConnected: boolean; hasBusinessToken: boolean }
interface SlackData { settings: { botToken: string | null; demoWebhookUrl: string | null } | null }

function useMetaStatus() {
  const { data } = useQuery<MetaData>({
    queryKey: ["meta-pages"],
    queryFn: () => fetch("/api/settings/meta").then(r => r.json()),
    staleTime: 30_000,
  });
  const connected = (data?.pages?.length ?? 0) > 0;
  return connected ? "connected" : "not-connected" as StatusVariant;
}

function useTikTokStatus() {
  const { data } = useQuery<TikTokData>({
    queryKey: ["tiktok-settings"],
    queryFn: () => fetch("/api/settings/tiktok").then(r => r.json()),
    staleTime: 30_000,
  });
  const connected = !!(data?.isConnected || data?.hasBusinessToken);
  return connected ? "connected" : "not-connected" as StatusVariant;
}

function useSlackStatus() {
  const { data } = useQuery<SlackData>({
    queryKey: ["slack-settings"],
    queryFn: () => fetch("/api/slack/settings").then(r => r.json()),
    staleTime: 30_000,
  });
  const connected = data?.settings?.botToken != null;
  return connected ? "connected" : "not-connected" as StatusVariant;
}

function useN8nStatus() {
  const { data } = useQuery<SlackData>({
    queryKey: ["slack-settings"],
    queryFn: () => fetch("/api/slack/settings").then(r => r.json()),
    staleTime: 30_000,
  });
  const configured = data?.settings?.demoWebhookUrl != null;
  return configured ? "configured" : "not-connected" as StatusVariant;
}

interface FathomData { connected: boolean }

function useFathomStatus() {
  const { data } = useQuery<FathomData>({
    queryKey: ["fathom-status"],
    queryFn: () => fetch("/api/fathom/status").then(r => r.json()),
    staleTime: 30_000,
  });
  const connected = data?.connected ?? false;
  return connected ? "connected" : "not-connected" as StatusVariant;
}

// ─── Icons ──────────────────────────────────────────────────────────────────────

function GHLLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/ghl-logo.jpg" alt="GoHighLevel" className="w-10 h-10 rounded-[10px] object-cover shrink-0" />
  );
}

function ClickUpLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/clickup-icon.svg" alt="ClickUp" className="w-10 h-10 rounded-[10px] object-contain shrink-0" />
  );
}

function MetaLogo() {
  return (
    <div className="w-10 h-10 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="10" fill="#1877F2" />
        <path
          d="M20 9C13.925 9 9 13.925 9 20c0 5.545 4.064 10.143 9.375 10.977v-7.765h-2.82V20h2.82v-2.448c0-2.784 1.658-4.322 4.197-4.322 1.215 0 2.487.217 2.487.217v2.734h-1.4c-1.381 0-1.811.857-1.811 1.736V20h3.08l-.492 3.212h-2.588v7.765C26.936 30.143 31 25.545 31 20c0-6.075-4.925-11-11-11z"
          fill="white"
        />
      </svg>
    </div>
  );
}

function TikTokLogo() {
  return (
    <div
      className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0"
      style={{ background: "#010101" }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.77a4.85 4.85 0 0 1-1.01-.08z" />
      </svg>
    </div>
  );
}

function SlackLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/slack-icon.svg" alt="Slack" className="w-10 h-10 rounded-[10px] object-contain shrink-0" />
  );
}

function N8nLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/n8n-icon.svg"
      alt="n8n"
      className="w-10 h-10 rounded-[10px] shrink-0"
      aria-hidden="true"
    />
  );
}

function FathomLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/fathom-logo.png" alt="Fathom" className="w-10 h-10 rounded-[10px] object-cover shrink-0" />
  );
}

// ─── Status badge ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  StatusVariant,
  { label: string; dotClass: string; badgeClass: string }
> = {
  connected: {
    label: "Connected",
    dotClass: "bg-emerald-500",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
  configured: {
    label: "Configured",
    dotClass: "bg-emerald-500",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
  "not-connected": {
    label: "Not connected",
    dotClass: "bg-muted-foreground/50",
    badgeClass: "bg-muted text-muted-foreground border border-border",
  },
  "always-on": {
    label: "Always on",
    dotClass: "bg-blue-500",
    badgeClass: "bg-blue-50 text-blue-700 border border-blue-200",
  },
};

function StatusBadge({ status }: { status: StatusVariant }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        cfg.badgeClass
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dotClass)} />
      {cfg.label}
    </span>
  );
}

// ─── Integration card ───────────────────────────────────────────────────────────

interface CardProps {
  logo: React.ReactNode;
  name: string;
  description: string;
  status: StatusVariant;
  action?: React.ReactNode;
}

function IntegrationCard({ logo, name, description, status, action }: CardProps) {
  return (
    <div
      className={cn(
        "bg-card border border-border rounded-xl p-5 flex flex-col gap-4",
        "hover:shadow-md hover:border-border/80 transition-all cursor-default",
        "min-h-[160px]"
      )}
    >
      {/* Top row: logo + text */}
      <div className="flex items-start gap-3">
        {logo}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[15px] font-semibold text-foreground leading-tight">{name}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
            {description}
          </p>
        </div>
      </div>

      {/* Bottom row: status + action */}
      <div className="flex items-center justify-between mt-auto">
        <StatusBadge status={status} />
        {action}
      </div>
    </div>
  );
}

// ─── Panel header logo/name mapping ────────────────────────────────────────────

const PANEL_HEADER: Record<
  string,
  { logo: React.ReactNode; name: string }
> = {
  meta: { logo: <MetaLogo />, name: "Meta — Facebook & Instagram" },
  tiktok: { logo: <TikTokLogo />, name: "TikTok" },
  slack: { logo: <SlackLogo />, name: "Slack" },
  n8n: { logo: <N8nLogo />, name: "n8n" },
  fathom: { logo: <FathomLogo />, name: "Fathom" },
};

// ─── Main component ─────────────────────────────────────────────────────────────

export function IntegrationsGrid({ initialPanel }: { initialPanel?: string }) {
  const [openPanel, setOpenPanel] = useState<IntegrationId | null>(
    initialPanel && ["ghl", "clickup", "meta", "tiktok", "slack", "n8n", "fathom"].includes(initialPanel)
      ? (initialPanel as IntegrationId)
      : null
  );
  const queryClient = useQueryClient();

  // Individual status hooks
  const metaStatus = useMetaStatus();
  const tiktokStatus = useTikTokStatus();
  const slackStatus = useSlackStatus();
  const n8nStatus = useN8nStatus();
  const fathomStatus = useFathomStatus();

  // Meta OAuth — open popup directly from card
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

  const panelHeader = openPanel ? PANEL_HEADER[openPanel] : null;

  return (
    <div className="p-6 space-y-6">
      {/* ── Integration cards — 3-col grid, last row stretches to fill ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 [&>*:nth-last-child(1):nth-child(3n+1)]:sm:col-span-2 [&>*:nth-last-child(1):nth-child(3n+1)]:xl:col-span-3 [&>*:nth-last-child(2):nth-child(3n+1)]:xl:col-span-2 [&>*:nth-last-child(1):nth-child(3n+2)]:xl:col-span-2">

        {/* 1. GoHighLevel — always on */}
        <IntegrationCard
          logo={<GHLLogo />}
          name="GoHighLevel"
          description="CRM, pipeline, SMS, email and calendar — core platform"
          status="always-on"
        />

        {/* 2. ClickUp — always on */}
        <IntegrationCard
          logo={<ClickUpLogo />}
          name="ClickUp"
          description="Demo tracker — tasks sync directly from your ClickUp workspace"
          status="always-on"
        />

        {/* 3. Meta */}
        <IntegrationCard
          logo={<MetaLogo />}
          name="Meta — Facebook & Instagram"
          description="Facebook Page DMs, Instagram DMs, and ad comment leads"
          status={metaStatus}
          action={
            metaStatus === "connected" ? (
              <button
                onClick={() => setOpenPanel("meta")}
                className="border border-border rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
              >
                Manage
              </button>
            ) : (
              <button
                onClick={openMetaOAuth}
                className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                Connect Page
              </button>
            )
          }
        />

        {/* 4. TikTok */}
        <IntegrationCard
          logo={<TikTokLogo />}
          name="TikTok"
          description="TikTok DMs via GHL and post/ad comment leads via Business API"
          status={tiktokStatus}
          action={
            <button
              onClick={() => setOpenPanel("tiktok")}
              className="border border-border rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              Configure
            </button>
          }
        />

        {/* 5. Slack */}
        <IntegrationCard
          logo={<SlackLogo />}
          name="Slack"
          description="AI sales bot in your Slack channel — ask questions about pipeline, KPIs, and spend"
          status={slackStatus}
          action={
            <button
              onClick={() => setOpenPanel("slack")}
              className="border border-border rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              Configure
            </button>
          }
        />

        {/* 6. n8n */}
        <IntegrationCard
          logo={<N8nLogo />}
          name="n8n"
          description="Webhook trigger for creating email demos automatically on demo request"
          status={n8nStatus}
          action={
            <button
              onClick={() => setOpenPanel("n8n")}
              className="border border-border rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              Configure
            </button>
          }
        />

        {/* 7. Fathom */}
        <IntegrationCard
          logo={<FathomLogo />}
          name="Fathom"
          description="AI meeting transcription — auto-sync call recordings and transcripts"
          status={fathomStatus}
          action={
            <button
              onClick={() => setOpenPanel("fathom")}
              className="border border-border rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              Configure
            </button>
          }
        />
      </div>

      {/* ── Keyword Manager ── */}
      <KeywordManager />

      {/* ── Slide-over backdrop ── */}
      {openPanel && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={() => setOpenPanel(null)}
          aria-hidden="true"
        />
      )}

      {/* ── Slide-over panel ── */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-[440px] bg-card border-l border-border shadow-2xl z-50",
          "transform transition-transform duration-300 ease-in-out",
          openPanel ? "translate-x-0" : "translate-x-full"
        )}
        aria-modal="true"
        role="dialog"
        aria-label={panelHeader?.name ?? "Integration settings"}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            {/* Smaller logo version in panel header */}
            <div className="w-8 h-8 shrink-0 flex items-center justify-center">
              {panelHeader?.logo}
            </div>
            <span
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {panelHeader?.name}
            </span>
          </div>
          <button
            onClick={() => setOpenPanel(null)}
            className={cn(
              "w-8 h-8 flex items-center justify-center rounded-[6px]",
              "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            )}
            aria-label="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Panel body — scrollable, renders settings component */}
        <div className="overflow-y-auto h-[calc(100%-65px)] p-5">
          {openPanel === "meta" && <MetaSettings />}
          {openPanel === "tiktok" && <TikTokSettings />}
          {openPanel === "slack" && <SlackSettings />}
          {openPanel === "n8n" && <N8nSettings />}
          {openPanel === "fathom" && <FathomConnectCard onClose={() => setOpenPanel(null)} />}
        </div>
      </div>
    </div>
  );
}
