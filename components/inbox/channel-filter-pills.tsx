"use client";

import { cn } from "@/lib/utils/cn";
import { MessageSquare, Mail } from "lucide-react";
import { InstagramIcon, FacebookIcon, TikTokIcon } from "@/components/shared/channel-icon";

export type ChannelFilter = "ALL" | "TYPE_SMS" | "TYPE_EMAIL" | "TYPE_INSTAGRAM" | "TYPE_FB";

const FILTERS: Array<{
  value: ChannelFilter;
  label: string;
  icon: React.ElementType;
}> = [
  { value: "ALL", label: "All", icon: MessageSquare },
  { value: "TYPE_SMS", label: "SMS", icon: MessageSquare },
  { value: "TYPE_EMAIL", label: "Email", icon: Mail },
  { value: "TYPE_INSTAGRAM", label: "Instagram", icon: InstagramIcon },
  { value: "TYPE_FB", label: "Facebook", icon: FacebookIcon },
];

interface ChannelFilterPillsProps {
  value: ChannelFilter;
  onChange: (v: ChannelFilter) => void;
}

export function ChannelFilterPills({ value, onChange }: ChannelFilterPillsProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {FILTERS.map(({ value: v, label, icon: Icon }) => {
        const isActive = value === v;
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150 border",
              isActive
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
            )}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        );
      })}

      {/* TikTok — coming soon */}
      <button
        disabled
        title="TikTok DM API is restricted — coming soon"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-border bg-card text-muted-foreground opacity-40 cursor-not-allowed"
      >
        <TikTokIcon className="w-3 h-3" />
        TikTok
        <span className="text-[10px] opacity-70">soon</span>
      </button>
    </div>
  );
}
