"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2, Check, AlertCircle, Hash, Lock, FileText, PhoneMissed, PhoneCall, CheckSquare, Bell } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface NotifVar { token: string; label: string; sample: string }
interface Rule {
  key: string; name: string; description: string;
  recipients: "rep" | "gage" | "both"; messageTemplate: string; enabled: boolean;
}
interface ApiData { rules: Rule[]; variables: Record<string, NotifVar[]>; descriptions: Record<string, string> }

const RECIPIENT_OPTS: { value: Rule["recipients"]; label: string }[] = [
  { value: "both", label: "Rep + Gage" },
  { value: "rep", label: "Rep only" },
  { value: "gage", label: "Gage only" },
];

const RULE_ICON: Record<string, React.ElementType> = {
  proposal_stalling: FileText,
  call_outcome_missing: PhoneMissed,
  call_upcoming: PhoneCall,
  task_due: CheckSquare,
};

function interpolate(t: string, vars: NotifVar[]): string {
  const map = Object.fromEntries(vars.map((v) => [v.token, v.sample]));
  return t.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => map[k] ?? "");
}
function mentionPreview(recipients: Rule["recipients"], vars: NotifVar[]): string {
  const rep = (vars.find((v) => v.token === "rep.name")?.sample ?? "Alice").split(" ")[0];
  if (recipients === "rep") return `@${rep}`;
  if (recipients === "gage") return `@Gage`;
  return `@${rep}  @Gage`;
}

// Rules the engine delivers as private DMs (see lib/reminders/engine.ts `deliver: "dm"`).
// Admin alerts additionally copy the owner (Jack), matching lib/notifications/dispatch.ts.
const DM_RULES = new Set(["proposal_stalling"]);

/** First names a DM-delivered alert reaches; the owner ("you") is copied on admin alerts. */
function dmRecipientNames(recipients: Rule["recipients"], vars: NotifVar[]): string[] {
  const rep = (vars.find((v) => v.token === "rep.name")?.sample ?? "Alice").split(" ")[0];
  const names: string[] = [];
  if (recipients === "rep" || recipients === "both") names.push(rep);
  if (recipients === "gage" || recipients === "both") names.push("Gage", "you");
  return names;
}
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function NotificationsClient() {
  const { data, isLoading, isError } = useQuery<ApiData>({
    queryKey: ["notification-rules"],
    queryFn: async () => { const r = await fetch("/api/notifications/rules"); if (!r.ok) throw new Error("Failed"); return r.json(); },
  });

  if (isLoading) return <div className="space-y-5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-56 animate-pulse rounded-[14px] bg-muted/40" />)}</div>;
  if (isError) return (
    <div className="flex items-center gap-2 rounded-[8px] bg-destructive/8 px-3 py-2.5 text-destructive">
      <AlertCircle className="h-4 w-4" /><span className="text-sm">Couldn&apos;t load notifications.</span>
    </div>
  );

  return (
    <div className="space-y-5">
      {(data?.rules ?? []).map((rule) => (
        <NotificationCard key={rule.key} rule={rule} variables={data!.variables[rule.key] ?? []} />
      ))}
    </div>
  );
}

function NotificationCard({ rule, variables }: { rule: Rule; variables: NotifVar[] }) {
  const qc = useQueryClient();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [recipients, setRecipients] = useState<Rule["recipients"]>(rule.recipients);
  const [message, setMessage] = useState(rule.messageTemplate);
  const dirty = enabled !== rule.enabled || recipients !== rule.recipients || message !== rule.messageTemplate;
  const Icon = RULE_ICON[rule.key] ?? Bell;
  const isDm = DM_RULES.has(rule.key);
  const adminIncluded = recipients === "gage" || recipients === "both";

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/notifications/rules", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: rule.key, enabled, recipients, messageTemplate: message }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-rules"] }),
  });

  function insertToken(token: string) {
    const el = taRef.current;
    if (!el) { setMessage((m) => `${m}{{${token}}}`); return; }
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? start;
    setMessage(`${message.slice(0, start)}{{${token}}}${message.slice(end)}`);
    requestAnimationFrame(() => { el.focus(); const p = start + token.length + 4; el.setSelectionRange(p, p); });
  }

  return (
    <section
      data-r10n-settings-card
      className={cn("overflow-hidden rounded-[14px] border bg-card transition-colors", enabled ? "border-border shadow-sm" : "border-border/60 bg-muted/20")}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }} data-r10n-settings-cardtitle>{rule.name}</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{rule.description}</p>
          </div>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
          <span className={cn("font-medium", enabled ? "text-success" : "text-muted-foreground")}>{enabled ? "On" : "Off"}</span>
          <button type="button" role="switch" aria-checked={enabled} aria-label={`Turn ${rule.name} ${enabled ? "off" : "on"}`}
            onClick={() => setEnabled((v) => !v)}
            className={cn("relative h-5 w-9 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1", enabled ? "bg-success" : "bg-muted-foreground/30")}>
            <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", enabled ? "left-[18px]" : "left-0.5")} />
          </button>
        </label>
      </div>

      {/* Body: balanced two columns of equal height */}
      <div className="grid items-stretch lg:grid-cols-2">
        {/* Left: setup */}
        <div className="space-y-5 px-6 py-5 lg:border-r lg:border-border">
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Who gets pinged</label>
            <div className="inline-flex overflow-hidden rounded-[8px] border border-border">
              {RECIPIENT_OPTS.map((o) => (
                <button key={o.value} type="button" onClick={() => setRecipients(o.value)} aria-pressed={recipients === o.value}
                  className={cn("px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                    recipients === o.value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60")}>
                  {o.label}
                </button>
              ))}
            </div>
            {isDm && adminIncluded && (
              <p className="mt-2 text-[11px] text-muted-foreground">You&apos;re copied on every admin alert.</p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Message</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {variables.map((v) => (
                <button key={v.token} type="button" onClick={() => insertToken(v.token)}
                  className="cursor-pointer rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  {v.label}
                </button>
              ))}
            </div>
            <textarea ref={taRef} value={message} onChange={(e) => setMessage(e.target.value)} rows={5}
              className="w-full resize-y rounded-[8px] border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              placeholder="What the Slack message says…" />
          </div>
        </div>

        {/* Right: a real Slack window, filling the column height */}
        <div className="flex flex-col bg-muted/25 px-6 py-5">
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isDm ? "Preview · private DM" : "Preview in Slack"}
          </label>
          <div className="flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-[12px] border border-black/10 bg-white shadow-sm">
            {/* conversation bar: a private DM vs the sales channel */}
            {isDm ? (
              <div className="flex items-center gap-1.5 border-b border-black/5 px-4 py-2.5">
                <Lock className="h-3 w-3 shrink-0 text-[#616061]" />
                <span className="shrink-0 text-[13px] font-bold text-[#1D1C1D]">Direct message</span>
                <span className="min-w-0 truncate text-[12px] text-[#616061]">to {joinNames(dmRecipientNames(recipients, variables))}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 border-b border-black/5 px-4 py-2.5">
                <Hash className="h-3.5 w-3.5 text-[#8a8a8a]" />
                <span className="text-[13px] font-bold text-[#1D1C1D]">kracked-ai-sales</span>
              </div>
            )}
            {/* message */}
            <div className="flex flex-1 items-start gap-2.5 px-4 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#0A0A0B]">
                <span className="text-base font-bold text-white" style={{ fontFamily: "var(--font-heading)" }}>K</span>
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="mb-0.5 text-[13px] font-bold text-[#1D1C1D]">
                  Kracked AI <span className="ml-1 rounded bg-[#e8e8e8] px-1 py-px text-[9px] font-semibold uppercase text-[#616061] align-[1px]">App</span>
                  <span className="ml-1.5 text-[11px] font-normal text-[#9a9a9a]">just now</span>
                </p>
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#1D1C1D]">
                  {!isDm && (
                    <><span className="rounded bg-[#1264A3]/10 px-1 font-semibold text-[#1264A3]">{mentionPreview(recipients, variables)}</span>{"  "}</>
                  )}
                  {interpolate(message, variables)}
                </p>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {isDm ? "Sample data. Each person gets their own private DM." : "Shown with sample data."}
          </p>
        </div>
      </div>

      {/* Footer: save / saved */}
      {(dirty || save.isPending) ? (
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-3">
          {save.isError && <span className="text-xs text-destructive">{(save.error as Error).message}</span>}
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-70">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{save.isPending ? "Saving" : "Save changes"}
          </button>
        </div>
      ) : save.isSuccess ? (
        <div className="flex items-center justify-end gap-1.5 border-t border-border px-6 py-2.5 text-xs font-medium text-success">
          <Check className="h-3.5 w-3.5" /> Saved
        </div>
      ) : null}
    </section>
  );
}
