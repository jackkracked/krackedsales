import { User, Briefcase, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Shared identity language so the Contact modal (a person) and the Opportunity
// modal (a deal) are unmistakable at a glance, without changing either layout
// or any of their actions. Navy = person, gold = deal. Three quiet, reinforcing
// cues: a labelled type chip, a tinted lead visual (round = person, square =
// deal), and a soft header wash. Restrained on purpose — premium, not loud.

type EntityKind = "contact" | "opportunity";

interface IdentitySpec {
  label: string;
  icon: LucideIcon;
  /** Type chip. */
  chip: string;
  /** Soft top-down wash applied to the modal header. */
  headerWash: string;
  /** Ring around the round contact avatar. */
  avatarRing: string;
  /** Square lead tile for the opportunity. */
  tile: string;
  tileIcon: string;
}

export const ENTITY_IDENTITY: Record<EntityKind, IdentitySpec> = {
  contact: {
    label: "Contact",
    icon: User,
    chip: "bg-[#0F3A5C]/[0.07] text-[#0F3A5C] ring-1 ring-inset ring-[#0F3A5C]/15",
    headerWash: "bg-gradient-to-b from-[#0F3A5C]/[0.055] to-transparent",
    avatarRing: "ring-2 ring-[#0F3A5C]/15 ring-offset-1 ring-offset-card",
    tile: "",
    tileIcon: "",
  },
  opportunity: {
    label: "Opportunity",
    icon: Briefcase,
    chip: "bg-[#D4A574]/[0.18] text-[#7A4A1A] ring-1 ring-inset ring-[#D4A574]/45",
    headerWash: "bg-gradient-to-b from-[#D4A574]/[0.16] to-transparent",
    avatarRing: "",
    tile: "bg-gradient-to-br from-[#E6C79B] to-[#D4A574] ring-1 ring-inset ring-[#B8884F]/40 shadow-sm",
    tileIcon: "text-[#5E3A12]",
  },
};

/** Small uppercase type chip: an icon + the entity kind. */
export function EntityTypeChip({ kind, className }: { kind: EntityKind; className?: string }) {
  const id = ENTITY_IDENTITY[kind];
  const Icon = id.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.09em] leading-none",
        id.chip,
        className
      )}
    >
      <Icon className="w-2.5 h-2.5" strokeWidth={2.5} />
      {id.label}
    </span>
  );
}
