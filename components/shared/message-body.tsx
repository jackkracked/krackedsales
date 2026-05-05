"use client";

import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Renders message body text with URLs parsed as clickable links.
 * Handles http/https URLs, www. URLs, and bare domain patterns.
 */

// Matches http(s):// URLs and www. URLs
const URL_REGEX = /(https?:\/\/[^\s\[\]<>]+|www\.[^\s\[\]<>]+\.[a-zA-Z]{2,}[^\s\[\]<>]*)/gi;

function ensureHref(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function isUrl(str: string): boolean {
  return URL_REGEX.test(str);
}

interface MessageBodyProps {
  body: string;
  className?: string;
  linkClassName?: string;
}

export function MessageBody({ body, className, linkClassName }: MessageBodyProps) {
  // Reset regex lastIndex before use
  URL_REGEX.lastIndex = 0;

  const parts: Array<{ text: string; isLink: boolean }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset before use
  URL_REGEX.lastIndex = 0;

  while ((match = URL_REGEX.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: body.slice(lastIndex, match.index), isLink: false });
    }
    parts.push({ text: match[0], isLink: true });
    lastIndex = URL_REGEX.lastIndex;
  }

  if (lastIndex < body.length) {
    parts.push({ text: body.slice(lastIndex), isLink: false });
  }

  // If no URLs found, render plain
  if (parts.length === 0 || !parts.some((p) => p.isLink)) {
    return (
      <p className={cn("leading-relaxed whitespace-pre-wrap break-words", className)}>
        {body}
      </p>
    );
  }

  return (
    <p className={cn("leading-relaxed whitespace-pre-wrap break-words", className)}>
      {parts.map((part, i) =>
        part.isLink ? (
          <a
            key={i}
            href={ensureHref(part.text)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex items-center gap-0.5 underline underline-offset-2 hover:opacity-80 break-all",
              linkClassName
            )}
          >
            {part.text}
            <ExternalLink className="w-3 h-3 inline shrink-0" />
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </p>
  );
}
