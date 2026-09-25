"use client";

import { cn } from "@/lib/utils/cn";
import { MessageSquare, Mail } from "lucide-react";
import { InstagramIcon, FacebookIcon, TikTokIcon } from "@/components/shared/channel-icon";
import { Avatar } from "@/components/ui/avatar";

// Per-channel glyph. Shared by the conversation list, message thread, rail and composer so every
// surface renders the exact same channel logo.
export const CHANNEL_ICONS: Record<string, React.ElementType> = {
  TYPE_SMS: MessageSquare,
  TYPE_EMAIL: Mail,
  TYPE_INSTAGRAM: InstagramIcon,
  TYPE_FB: FacebookIcon,
  TYPE_TIKTOK: TikTokIcon,
};

// Each channel's REAL brand colour for its logo — Instagram magenta, Facebook blue, TikTok black,
// SMS green, Email slate, WhatsApp green. Never our accent blue.
export const CHANNEL_COLOR: Record<string, string> = {
  TYPE_SMS: "text-[#16A34A]",
  TYPE_EMAIL: "text-[#64748B]",
  TYPE_INSTAGRAM: "text-[#E1306C]",
  TYPE_FB: "text-[#1877F2]",
  TYPE_TIKTOK: "text-[#111111]",
  TYPE_WHATSAPP: "text-[#25D366]",
};

export const CHANNEL_LABEL: Record<string, string> = {
  TYPE_SMS: "SMS",
  TYPE_EMAIL: "Email",
  TYPE_INSTAGRAM: "Instagram",
  TYPE_FB: "Facebook",
  TYPE_TIKTOK: "TikTok",
  TYPE_WHATSAPP: "WhatsApp",
};

// Back-compat alias (older imports) — the brand colour drives the badge glyph now.
export const CHANNEL_BADGE = CHANNEL_COLOR;

interface ContactAvatarProps {
  name: string;
  channelType?: string;
  /** contact = colourful initials, rep = brand-tinted (outbound/us). */
  variant?: "contact" | "rep";
  size?: number;
  /** Real profile photo (Instagram/Facebook), when GHL provides one. Falls back to initials. */
  avatarUrl?: string | null;
}

// A light circular avatar (initials) with the channel's real logo as a small white disc half-
// overlapping the bottom-right — the logo in its BRAND colour, lifted off the avatar with a ring +
// soft shadow (GHL-style). No data-hook here, so the theme can't recolour the brand logo.
export function ContactAvatar({ name, channelType, variant = "contact", size = 40, avatarUrl }: ContactAvatarProps) {
  const Icon = channelType ? CHANNEL_ICONS[channelType] : undefined;
  const color = channelType ? CHANNEL_COLOR[channelType] : undefined;
  return (
    <div className="relative shrink-0">
      <Avatar name={name} size={size} variant={variant} src={avatarUrl} />
      {Icon && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 w-[16px] h-[16px] rounded-full flex items-center justify-center bg-white ring-2 ring-card shadow-[0_1px_2.5px_rgba(0,0,0,0.18)]",
            color,
          )}
        >
          <Icon className="w-2.5 h-2.5" />
        </span>
      )}
    </div>
  );
}
