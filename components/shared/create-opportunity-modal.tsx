"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { AD_FUNNEL_PIPELINE_ID } from "@/lib/ghl/pipeline-ids";

/**
 * Create a GoHighLevel opportunity for a contact that has none.
 *
 * Two steps on purpose. Creating an opportunity drops the contact into a pipeline stage, and GHL
 * automations attached to that stage can message the client, so the second step states the
 * destination in words before anything is written. The repo already carries the incident this
 * guards against: a stage write against the wrong opportunity messaged the wrong client.
 *
 * Everything that can be prefilled is prefilled. The rep should be able to open this and press
 * Create without typing, and only touch a field when the default is wrong.
 */

interface Pipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string; position?: number }>;
}

/** Exactly what the confirm step promised, frozen when the rep pressed Continue. */
interface PendingCreate {
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
  name: string;
  monetaryValue: number | null;
  /** GHL user id, or "" for the creator. Frozen too: it is the one field with cross-rep effect. */
  assignedTo: string;
  ownerLabel: string;
}

/** "1,000", " $2,500 " and "2500" all mean the same thing to a person typing a deal value. */
function parseMoney(raw: string): number {
  return Number(raw.replace(/[$,\s]/g, ""));
}

export function CreateOpportunityModal({
  contactId,
  contactName,
  defaultSource,
  onClose,
  onCreated,
}: {
  contactId: string;
  contactName: string;
  /** The contact's own source (Facebook, Instagram…), carried onto the opportunity. */
  defaultSource?: string | null;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const qc = useQueryClient();
  const uid = useId();
  const [name, setName] = useState(contactName.trim().slice(0, 120) || "New opportunity");
  const [pipelineId, setPipelineId] = useState(AD_FUNNEL_PIPELINE_ID);
  const [stageId, setStageId] = useState("");
  const [value, setValue] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** Non-null means we are on the confirm step, showing exactly these values. */
  const [pending, setPending] = useState<PendingCreate | null>(null);

  const errorRef = useRef<HTMLParagraphElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const { data: pipelinesData, isLoading: pipelinesLoading, isError: pipelinesError } = useQuery<{
    pipelines: Pipeline[];
  }>({
    queryKey: ["pipelines"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/pipelines");
      if (!res.ok) throw new Error("Could not load pipelines");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // Admin-only endpoint. A rep without permission simply gets no picker and the server assigns
  // the opportunity to them, rather than being shown a control that always fails.
  const { data: usersData } = useQuery<{ users: Array<{ id: string; name: string; ghlUserId: string | null }> }>({
    queryKey: ["team-users"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (!res.ok) throw new Error("no roster");
      return res.json();
    },
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  const owners = (usersData?.users ?? []).filter((u) => u.ghlUserId);

  const pipelines = useMemo(() => pipelinesData?.pipelines ?? [], [pipelinesData]);
  const pipeline = useMemo(
    () => pipelines.find((p) => p.id === pipelineId) ?? pipelines[0],
    [pipelines, pipelineId],
  );
  const stages = useMemo(
    () => (pipeline?.stages ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [pipeline],
  );
  // The stage select is never left dangling on a pipeline it does not belong to: whenever the
  // chosen stage is not in the current pipeline, the first stage stands in.
  const effectiveStageId = stages.some((s) => s.id === stageId) ? stageId : (stages[0]?.id ?? "");
  const stageName = stages.find((s) => s.id === effectiveStageId)?.name ?? "";

  const parsedValue = parseMoney(value);
  const valueInvalid = value.trim() !== "" && !(Number.isFinite(parsedValue) && parsedValue >= 0);
  const noPipelines = !pipelinesLoading && pipelines.length === 0;
  const noStages = !pipelinesLoading && !!pipeline && stages.length === 0;

  const create = useMutation({
    // Reads ONLY from the frozen snapshot, so what gets created is what the confirm step named.
    mutationFn: async (p: PendingCreate) => {
      const res = await fetch(`/api/ghl/contacts/${encodeURIComponent(contactId)}/opportunity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: p.pipelineId,
          pipelineStageId: p.stageId,
          name: p.name,
          monetaryValue: p.monetaryValue,
          source: defaultSource ?? null,
          assignedTo: p.assignedTo || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Could not create the opportunity");
      return body;
    },
    onSuccess: () => {
      setDone(true);
      qc.invalidateQueries({ queryKey: ["contact-opportunity", contactId] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onCreated?.();
      closeTimer.current = setTimeout(onClose, 1200);
    },
    onError: (e: Error) => {
      setError(e.message);
      setPending(null); // back to the form, where it can be corrected, never stranded
    },
  });

  // Move focus to the problem rather than leaving it on a button that just unmounted.
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const canContinue =
    !!pipeline && !!effectiveStageId && name.trim().length > 0 && !valueInvalid && !create.isPending;

  const field = "w-full text-sm px-3 py-2.5 border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors disabled:opacity-60";
  const labelCls = "text-xs font-medium text-muted-foreground uppercase tracking-wide";

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o && !create.isPending) onClose(); }}
      label="Create opportunity"
      size="max-w-md"
      className="p-5"
    >
      {done ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          <p className="text-sm font-medium text-foreground">Opportunity created</p>
          <p className="max-w-full break-words text-xs text-muted-foreground">
            {pending?.name} is now in {pending?.stageName}.
          </p>
        </div>
      ) : pending ? (
        <div>
          <h2 className="text-base font-semibold text-foreground">Create this opportunity?</h2>
          <dl className="mt-3 space-y-2 rounded-[8px] border border-border/60 bg-muted/20 px-3.5 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-muted-foreground">Name</dt>
              <dd className="min-w-0 truncate font-medium text-foreground">{pending.name}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-muted-foreground">Pipeline</dt>
              <dd className="min-w-0 truncate text-foreground">{pending.pipelineName}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-muted-foreground">Stage</dt>
              <dd className="min-w-0 truncate font-medium text-foreground">{pending.stageName}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-muted-foreground">Owner</dt>
              <dd className="min-w-0 truncate text-foreground">{pending.ownerLabel}</dd>
            </div>
            {pending.monetaryValue != null && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-xs text-muted-foreground">Deal value</dt>
                <dd className="tabular-nums text-foreground">${pending.monetaryValue.toLocaleString()}</dd>
              </div>
            )}
          </dl>

          <p className="mt-3 flex items-start gap-2 text-xs leading-snug text-muted-foreground">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span>
              Any GoHighLevel automation on{" "}
              <span className="font-medium text-foreground">{pending.stageName}</span> will run, and
              some of those message the client.
            </span>
          </p>

          {/* Escape and click-outside are blocked while the write is in flight, because
              unmounting mid-create loses the rep's only record of what happened. A frozen dialog
              needs to explain itself, so this fades in after 5s. CSS, not state: it is pure
              presentation and the delay must not cost a re-render. */}
          {create.isPending && (
            <p
              role="status"
              className="mt-3 text-xs text-muted-foreground opacity-0"
              style={{ animation: "fade-in 240ms ease-out 5s forwards" }}
            >
              Still working. GoHighLevel is slow right now, so this can take a few more seconds.
            </p>
          )}

          <div className="mt-5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={create.isPending}
              className="inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
            <button
              type="button"
              onClick={() => create.mutate(pending)}
              disabled={create.isPending}
              className="inline-flex items-center gap-2 rounded-[7px] bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {create.isPending ? "Creating…" : "Create opportunity"}
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!canContinue || !pipeline) return;
            setPending({
              pipelineId: pipeline.id,
              pipelineName: pipeline.name,
              stageId: effectiveStageId,
              stageName,
              name: name.trim(),
              monetaryValue: value.trim() === "" ? null : parsedValue,
              assignedTo,
              ownerLabel: assignedTo
                ? (owners.find((u) => u.ghlUserId === assignedTo)?.name ?? "another rep")
                : "You",
            });
          }}
        >
          <h2 className="text-base font-semibold text-foreground">Create opportunity</h2>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            For {contactName || "this contact"}
          </p>

          {pipelinesError || noPipelines ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              Couldn&apos;t load your pipelines, so there is nowhere to put this yet. Close this and
              try again in a moment.
            </p>
          ) : (
            <div className="mt-4 space-y-3.5">
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-name`} className={labelCls}>Opportunity name</label>
                <input
                  id={`${uid}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  className={field}
                  placeholder="Opportunity name"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor={`${uid}-pipeline`} className={labelCls}>Pipeline</label>
                  <select
                    id={`${uid}-pipeline`}
                    value={pipeline?.id ?? ""}
                    onChange={(e) => { setPipelineId(e.target.value); setStageId(""); }}
                    disabled={pipelinesLoading || pipelines.length === 0}
                    className={field}
                  >
                    {pipelinesLoading && <option value="">Loading…</option>}
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`${uid}-stage`} className={labelCls}>Stage</label>
                  <select
                    id={`${uid}-stage`}
                    value={effectiveStageId}
                    onChange={(e) => setStageId(e.target.value)}
                    disabled={pipelinesLoading || stages.length === 0}
                    className={field}
                  >
                    {(pipelinesLoading || stages.length === 0) && <option value="">
                      {pipelinesLoading ? "Loading…" : "No stages"}
                    </option>}
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor={`${uid}-value`} className={labelCls}>Deal value</label>
                  <input
                    id={`${uid}-value`}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    inputMode="decimal"
                    placeholder="Optional"
                    aria-invalid={valueInvalid}
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`${uid}-owner`} className={labelCls}>Owner</label>
                  {owners.length > 0 ? (
                    <select
                      id={`${uid}-owner`}
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      className={field}
                    >
                      <option value="">You</option>
                      {owners.map((u) => (
                        <option key={u.id} value={u.ghlUserId ?? ""}>{u.name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="px-3 py-2.5 text-sm text-muted-foreground">You</p>
                  )}
                </div>
              </div>

              {noStages && (
                <p role="alert" className="text-xs text-destructive">
                  That pipeline has no stages, so nothing can be created in it. Pick another.
                </p>
              )}
              {valueInvalid && (
                <p className="text-xs text-destructive">
                  Deal value must be a number. Leave it blank if you don&apos;t know it yet.
                </p>
              )}
              {/* Always mounted, so a screen reader announces the change rather than a new node. */}
              <p
                ref={errorRef}
                tabIndex={-1}
                role="status"
                aria-live="polite"
                className={error ? "text-xs text-destructive outline-none" : "sr-only"}
              >
                {error ?? ""}
              </p>
              {defaultSource && (
                <p className="text-[11px] text-muted-foreground">Source carried over: {defaultSource}</p>
              )}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[7px] px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canContinue}
              className="rounded-[7px] bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
