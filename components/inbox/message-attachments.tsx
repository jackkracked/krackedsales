"use client";

import { useState } from "react";
import { FileText, Download } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)(\?|#|$)/i;

function isImageUrl(url: string): boolean {
  return IMAGE_RE.test(url);
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").pop() || "file");
  } catch {
    return "file";
  }
}

/** Renders a message's attachments — images inline (click to open full), other files as a
 *  tappable chip. Broken images fall back to the file chip so a bubble is never blank. */
export function MessageAttachments({ urls, className }: { urls: string[]; className?: string }) {
  const clean = urls.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u));
  if (clean.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {clean.map((url, i) => (
        <Attachment key={`${url}-${i}`} url={url} />
      ))}
    </div>
  );
}

function Attachment({ url }: { url: string }) {
  const [broken, setBroken] = useState(false);

  if (isImageUrl(url) && !broken) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="block overflow-hidden rounded-[12px] border border-border/70 bg-background max-w-[240px] transition-shadow hover:shadow-md"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="attachment"
          loading="lazy"
          onError={() => setBroken(true)}
          className="block max-h-[280px] w-auto max-w-full object-contain"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-2 max-w-[240px] rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground hover:border-primary/40 hover:bg-primary/[0.03] transition-colors"
    >
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="truncate">{fileNameFromUrl(url)}</span>
      <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-auto" />
    </a>
  );
}
