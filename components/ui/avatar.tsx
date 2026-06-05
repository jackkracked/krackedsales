"use client";

import { cn } from "@/lib/utils/cn";

// Consistent color palette for contact/prospect avatars
// Uses warm, muted tones that work with the app's neutral palette
const CONTACT_COLORS = [
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-orange-100 text-orange-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
];

// Team/rep avatars always use primary brand color
const REP_CLASS = "bg-primary/12 text-primary";

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getInitials(name: string, maxChars = 2): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, maxChars)
    .join("")
    .toUpperCase() || "?";
}

interface AvatarProps {
  name: string;
  size?: number;           // pixel size, default 28
  variant?: "contact" | "rep";  // contact = colorful, rep = brand primary
  className?: string;
}

export function Avatar({ name, size = 28, variant = "contact", className }: AvatarProps) {
  const colorClass = variant === "rep"
    ? REP_CLASS
    : CONTACT_COLORS[hashName(name) % CONTACT_COLORS.length];

  const fontSize = size <= 24 ? "text-[9px]" : size <= 32 ? "text-[11px]" : "text-xs";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-bold shrink-0 select-none",
        fontSize,
        colorClass,
        className
      )}
      style={{ width: size, height: size }}
      title={name}
    >
      {getInitials(name)}
    </span>
  );
}
