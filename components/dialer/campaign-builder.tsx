"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Check, Loader2, Phone } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { DialerCampaign } from "./mock-data";

interface StageCounts {
  people: number;
  dialable: number;
  skippedNoPhone: number;
  skippedDnd: number;
  duplicatesMerged: number;
  truncated: boolean;
}

/** Initials for the chip, from a real name. */
function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

const INPUT =
  "w-full rounded-[8px] border border-border bg-input px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-2 focus:ring-ring/20";

/** New-campaign builder. Admins assign any reps; a rep's campaign is locked to
 *  themselves (the assignee field is disabled and defaulted to them). Preview
 *  creates a real local campaign (empty queue — add contacts from Contacts/Pipeline). */
export function CampaignBuilder({
  isAdmin,
  currentUser,
  currentUserId,
  onClose,
  onCreate,
}: {
  isAdmin: boolean;
  currentUser: { name: string; initials: string };
  /** The signed-in user's id. Needed so "assign myself" works for every role. */
  currentUserId: string | null;
  onClose: () => void;
  /** Returns a promise so the builder can stay disabled until the create resolves. */
  onCreate: (c: DialerCampaign) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(3);
  /**
   * The real team, not a placeholder.
   *
   * This list was two hardcoded fake names ("Gage Flasher", "Alice Monroe"), and
   * `createCampaign` never sent the selection, so every campaign silently assigned itself to
   * whoever created it. Kelsey was not in the list at all, which meant an admin could not
   * hand her a queue and she would never see one — the exact thing this feature exists for.
   *
   * `/api/settings/team` serves every role: admins get the full payload, everyone else a
   * minimal roster. So a rep can still see (and assign) themselves.
   */
  const { data: teamData } = useQuery<{ team?: Array<{ id: string; name: string; role: string; isActive: boolean }>; users?: Array<{ id: string; name: string; role: string; isActive: boolean }> }>({
    queryKey: ["settings-team"],
    queryFn: () => fetch("/api/settings/team").then((r) => (r.ok ? r.json() : {})),
    staleTime: 5 * 60 * 1000,
  });
  const team = (teamData?.team ?? teamData?.users ?? []).filter((u) => u.isActive);
  /** You first, then everyone else by name. You can always assign yourself. */
  const assignable = [...team].sort((a, b) =>
    a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : a.name.localeCompare(b.name),
  );

  const [reps, setReps] = useState<string[]>([]);
  // Default to yourself the moment the roster lands, for admins and reps alike.
  useEffect(() => {
    if (!reps.length && currentUserId && assignable.some((u) => u.id === currentUserId)) {
      setReps([currentUserId]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignable.length, currentUserId]);

  /**
   * Where the queue comes from.
   *
   * "blank" is the original behaviour, untouched and still the default: create an empty
   * campaign and add contacts from the Contacts or Pipeline pages.
   *
   * "stage" is Jack's ask (2026-09-22): pick a pipeline, pick a stage, load every number in
   * it. Hand-adding 237 leads a page at a time is why Kelsey was still dialling inside
   * GoHighLevel instead of here.
   */
  const [source, setSource] = useState<"blank" | "stage">("blank");
  /** Once the user edits the name, stop overwriting it. */
  const [nameTouched, setNameTouched] = useState(false);
  /** Guards the create button: onCreate is async and the modal stays open until it resolves,
   *  so without this a double-click creates two campaigns and two full queues. */
  const [busy, setBusy] = useState(false);
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");

  const { data: pipelineData } = useQuery<{ pipelines: Array<{ id: string; name: string; stages?: Array<{ id: string; name: string; position?: number }> }> }>({
    queryKey: ["pipelines"],
    // Guarded, and identical to the one in dialer-client: both observers share this cache key,
    // so a queryFn that swallowed an error here would poison the pipeline list everywhere.
    queryFn: () => fetch("/api/ghl/pipelines").then((r) => (r.ok ? r.json() : { pipelines: [] })),
    staleTime: 5 * 60 * 1000,
  });
  const pipelines = pipelineData?.pipelines ?? [];
  // In the board's own order, so the list reads the way the columns do on screen.
  const stages = [...(pipelines.find((p) => p.id === pipelineId)?.stages ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Counts only. Reads the local mirror, so previewing costs no GoHighLevel calls.
  const { data: stageData, isFetching: loadingStage, isError: stageError } = useQuery<{ counts: StageCounts }>({
    queryKey: ["stage-contacts", pipelineId, stageId],
    queryFn: async () => {
      const r = await fetch(`/api/dialer/stage-contacts?pipelineId=${pipelineId}&stageId=${stageId}`);
      // Without this, a 500 or an expired session renders as a confident "0 ready to dial",
      // which invents an explanation for a server error.
      if (!r.ok) throw new Error("stage lookup failed");
      return r.json();
    },
    enabled: source === "stage" && !!pipelineId && !!stageId,
    staleTime: 60 * 1000,
    retry: 1,
  });
  const counts = stageData?.counts;

  /**
   * Pick the stage and the name writes itself, and KEEPS rewriting itself until the user
   * types their own. Only auto-filling the first time leaves a campaign labelled with the
   * first stage you considered while holding the second one's contacts.
   */
  function chooseStage(id: string) {
    setStageId(id);
    const stageName = stages.find((s) => s.id === id)?.name;
    if (stageName && !nameTouched) {
      const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      setName(`${stageName} · ${today}`);
    }
  }

  const stageReady =
    source === "blank" || (!!stageId && !loadingStage && !stageError && (counts?.dialable ?? 0) > 0);
  const canSave = name.trim().length > 0 && (isAdmin ? reps.length > 0 : true) && stageReady && !busy;

  /** Admins assign anyone. A rep can only assign themselves, which is still a real choice. */
  function toggleRep(userId: string) {
    if (!isAdmin && userId !== currentUserId) return;
    setReps((r) => (r.includes(userId) ? r.filter((x) => x !== userId) : [...r, userId]));
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
    const assigned = assignable
      .filter((t) => reps.includes(t.id))
      .map((t) => ({ name: t.name, initials: initialsOf(t.name) }));
    await onCreate({
      // Actually sent now, so the campaign lands in the right person's rail.
      repUserIds: reps,
      // Carried so the caller can queue them straight after the campaign is created.
      stageSource: source === "stage" && pipelineId && stageId ? { pipelineId, stageId } : undefined,
      id: `camp_new_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}_${name.length}`,
      name: name.trim(),
      reps: assigned.length ? assigned : [currentUser],
      maxAttempts,
      reached: 0,
      exhausted: 0,
      contacts: [],
    });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--overlay)" }}>
      <div
        data-r10n-card
        className="w-full max-w-md overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_24px_60px_-20px_rgba(28,35,51,0.4)] motion-safe:animate-[dialerFade_180ms_ease-out]"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>New Power Dialer campaign</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Where the numbers come from. Blank stays the default so nothing changes for
              anyone already using this. */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Build the queue</label>
            <div className="inline-flex w-full rounded-[9px] border border-border bg-muted/40 p-0.5">
              {([
                { key: "blank", label: "Empty campaign" },
                { key: "stage", label: "From pipeline stage" },
              ] as const).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setSource(o.key)}
                  className={cn(
                    "flex-1 rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold transition-all",
                    source === o.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {source === "stage" && (
            <div className="space-y-3 rounded-[10px] border border-border bg-muted/25 p-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pipeline</label>
                <select
                  value={pipelineId}
                  onChange={(e) => { setPipelineId(e.target.value); setStageId(""); }}
                  className={INPUT}
                >
                  <option value="">Choose a pipeline…</option>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stage</label>
                <select
                  value={stageId}
                  onChange={(e) => chooseStage(e.target.value)}
                  disabled={!pipelineId}
                  className={cn(INPUT, !pipelineId && "cursor-not-allowed opacity-50")}
                >
                  <option value="">{pipelineId ? "Choose a stage…" : "Pick a pipeline first"}</option>
                  {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </div>

              {/* Say exactly what will be loaded, before anything is created. A queue that
                  silently shrinks from 237 to 194 is how people stop trusting the tool. */}
              {stageId && (
                <div className="flex items-start gap-2 rounded-[8px] border border-border bg-card px-3 py-2.5">
                  {loadingStage ? (
                    <>
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                      <span className="text-[12.5px] text-muted-foreground">Counting this stage…</span>
                    </>
                  ) : stageError ? (
                    <>
                      <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      <span className="text-[12.5px] text-destructive">
                        Could not read that stage. Try again.
                      </span>
                    </>
                  ) : (
                    <>
                      <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      <div className="text-[12.5px] leading-relaxed">
                        <span className="font-semibold tabular-nums text-foreground">
                          {counts?.dialable ?? 0} ready to dial
                        </span>
                        {!!counts?.skippedNoPhone && (
                          <span className="text-muted-foreground"> · {counts.skippedNoPhone} skipped, no phone number</span>
                        )}
                        {!!counts?.skippedDnd && (
                          <span className="text-muted-foreground"> · {counts.skippedDnd} do not contact</span>
                        )}
                        {!!counts?.duplicatesMerged && (
                          <span className="text-muted-foreground"> · {counts.duplicatesMerged} duplicate{counts.duplicatesMerged === 1 ? "" : "s"} merged</span>
                        )}
                        {counts?.truncated && (
                          <p className="mt-0.5 text-muted-foreground">Capped at 2,000. Load the rest in a second campaign.</p>
                        )}
                        {counts?.dialable === 0 && (
                          <p className="mt-0.5 text-muted-foreground">
                            {counts.people === 0
                              ? "This stage is empty."
                              : "Nobody here can be called — no phone number, or marked do not contact."}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Campaign name</label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
              placeholder="e.g. Q3 Cold Outbound"
              className={INPUT}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Max attempts per contact</label>
            <div className="inline-flex rounded-[9px] border border-border bg-muted/40 p-0.5">
              {[3, 5, 7].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxAttempts(n)}
                  className={cn(
                    "rounded-[7px] px-4 py-1.5 text-[13px] font-semibold tabular-nums transition-all",
                    maxAttempts === n ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Assigned reps {!isAdmin && <span className="ml-1 font-normal normal-case text-muted-foreground/70">— you can assign yourself</span>}
            </label>
            <div className="flex flex-wrap gap-2">
              {assignable.map((t) => {
                const on = reps.includes(t.id);
                const selectable = isAdmin || t.id === currentUserId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!selectable}
                    onClick={() => toggleRep(t.id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all",
                      on ? "border-info/40 bg-info/10 text-info" : "border-border bg-card text-muted-foreground hover:border-border/80",
                      !selectable && "cursor-default opacity-50",
                    )}
                  >
                    <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-foreground/10 text-[8px] font-bold">{initialsOf(t.name)}</span>
                    {t.id === currentUserId ? `${t.name.split(" ")[0]} (you)` : t.name}
                    {on && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          <button onClick={onClose} className="rounded-[10px] px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">Cancel</button>
          <button
            disabled={!canSave}
            onClick={create}
            className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35"
          >
            {busy
              ? "Creating…"
              : source === "stage" && (counts?.dialable ?? 0) > 0
                ? `Create and load ${counts!.dialable}`
                : "Create campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
