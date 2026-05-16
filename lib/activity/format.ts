export interface ActivityEvent {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Converts a raw activity event into a plain-English past-tense sentence.
 * Subject (user name) is NOT included — callers add it: "Jack {sentence}"
 */
export function formatActivitySentence(event: ActivityEvent): string {
  const name = event.entityName ?? "an item";
  const meta = (event.metadata ?? {}) as Record<string, string>;

  switch (event.action) {
    case "opportunity.created":
    case "lead.added":
      return `added ${name} to the pipeline`;
    case "opportunity.stage_changed":
      return meta.from_stage
        ? `moved ${name} from ${meta.from_stage} to ${meta.to_stage}`
        : `moved ${name} to ${meta.to_stage ?? "a new stage"}`;
    case "note.created":
      return `added a note on ${name}`;
    case "note.updated":
      return `updated a note on ${name}`;
    case "call.dispositioned":
      return `logged ${String(meta.outcome ?? "").replace(/_/g, " ")} on ${name}`;
    case "proposal.created":
      return `created a proposal for ${name}`;
    case "proposal.sent":
      return `sent a proposal to ${name}`;
    case "proposal.signed":
      return `${name} signed a proposal`;
    case "message.sent":
      return `sent a ${meta.channel ?? ""} message to ${name}`;
    case "template.sent":
      return `sent template "${meta.template_name ?? ""}" to ${name}`;
    case "task.created":
      return `created this task`;
    case "task.completed":
      return `marked this task complete`;
    case "task.updated":
      return `updated this task`;
    case "demo.started":
      return `started a demo for ${name}`;
    case "follow_up.sent":
      return `sent a follow-up to ${name}`;
    default:
      return `performed an action on ${name}`;
  }
}

/**
 * Derives a consistent colour (Tailwind bg class) from a user's name.
 * Same name always gets the same colour — stable across sessions.
 */
const AVATAR_COLOURS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-pink-500",
];

export function avatarColour(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
