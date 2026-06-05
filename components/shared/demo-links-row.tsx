"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { DemoLinks } from "@/app/api/contacts/[id]/demo-links/route";

function MiroLogo({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21.6632 -0.000366211H78.3368C90.293 -0.000366211 100 9.70665 100 21.6628V78.3364C100 90.2926 90.293 99.9996 78.3368 99.9996H21.6632C9.70702 99.9996 0 90.2926 0 78.3364V21.6628C0 9.70665 9.70702 -0.000366211 21.6632 -0.000366211Z" fill="#FFD02F"/>
      <path d="M69.488 12.4886H58.5084L67.6531 28.5584L47.5288 12.4886H36.5492L46.6114 32.1393L25.5697 12.4886H14.5901L25.5697 37.496L14.5901 87.5107H25.5697L46.6114 33.915L36.5492 87.5107H47.5288L67.6531 30.3637L58.5084 87.5107H69.488L89.6123 24.9775L69.488 12.4886Z" fill="#050038"/>
    </svg>
  );
}

const pillClass =
  "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full bg-muted hover:bg-border/60 text-foreground/80 transition-colors";

/**
 * Shows the demo's Miro board + ClickUp task for a contact, so the team can jump
 * straight to them from the opportunity view. Renders nothing when no demo is
 * linked (or while loading) to keep the panel clean.
 *
 * `contactId` is the GHL contact id. The audit link slots in here once that
 * feature is wired up (the endpoint already returns `auditUrl`, currently null).
 */
export function DemoLinksRow({ contactId }: { contactId?: string | null }) {
  const { data } = useQuery<DemoLinks>({
    queryKey: ["demo-links", contactId],
    queryFn: () => fetch(`/api/contacts/${contactId}/demo-links`).then((r) => r.json()),
    enabled: !!contactId,
    staleTime: 5 * 60 * 1000,
  });

  if (!data || (!data.miroUrl && !data.clickupUrl && !data.auditUrl)) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {data.miroUrl && (
        <a href={data.miroUrl} target="_blank" rel="noopener noreferrer" className={pillClass}>
          <MiroLogo size={13} />
          Miro Board
        </a>
      )}
      {data.auditUrl && (
        <a href={data.auditUrl} target="_blank" rel="noopener noreferrer" className={pillClass}>
          <ExternalLink className="w-3 h-3" />
          Audit
        </a>
      )}
      {data.clickupUrl && (
        <a href={data.clickupUrl} target="_blank" rel="noopener noreferrer" className={pillClass}>
          <ExternalLink className="w-3 h-3" />
          ClickUp
        </a>
      )}
    </div>
  );
}
