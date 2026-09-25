"use client";

import { useState, useRef, useEffect, useCallback, useMemo, createContext, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Pen, RefreshCw, Check, AlertTriangle, Clock, Shield, Download, Pencil,
  GripVertical, Plus, X, Loader2,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils/cn";
import {
  priceSuffix,
  clientSentence,
  discountSentence,
  discountInfo,
  amountBlockLabel,
  fullTermTotal,
  termMultiplier,
  managementSchedule,
  billingAnchor,
  type BillingTerms,
} from "@/lib/proposals/billing";
import { RichTextEditor } from "@/components/proposals/rich-text-editor";
import type {
  Deliverables,
  DeliverableGroup,
  DeliverableItem,
  ProposalContent,
  AdditionalRate,
} from "@/lib/proposals/content";

interface Instalment {
  id: string;
  instalmentNumber: number;
  amount: number;
  dueDate: string;
  status: string;
  isDeposit?: boolean;
  stripeHostedUrl?: string | null;
}

interface ProposalData {
  id: string;
  title: string;
  type: string;
  contactName: string;
  contactEmail: string | null;
  totalAmount: number;
  currency: string;
  serviceDescription: string | null;
  paymentStructure: string;
  billingInterval: string | null;
  billingIntervalCount: number | null;
  autoRenew?: boolean | null;
  listAmount?: number | null;
  discountType?: string | null;
  discountValue?: number | null;
  discountScope?: string | null;
  startDate: string | null;
  subscriptionStartDate?: string | null;
  // 90-Day Management billing display fields.
  managementOption?: string | null;
  autoRebillMode?: string | null;
  firstPaymentSplit?: Array<{ amount: number; offsetDays?: number }> | null;
  contractStartAt?: string | null;
  endDate: string | null;
  expiresAt: string | null;
  status: string;
  instalments: Instalment[];
  agreementTerms: string;
  additionalRates: string | null;
  hasDeposit?: boolean;
  depositTotal?: number | null;
  depositsPaidTotal?: number | null;
  deliverables?: Deliverables | null;
  content?: ProposalContent | null;
}

// ─── Document-level autosave indicator ─────────────────────────────────────────
// One calm, shared status line for the whole draft. Every inline editor reports through
// the same context so the admin sees a single "Saving… / Saved / Couldn't save" pill
// instead of a per-field flurry. `retry` re-runs the last failed save.

type SaveState = "idle" | "saving" | "saved" | "error";

interface SaveContextValue {
  state: SaveState;
  begin: () => void;
  succeed: () => void;
  fail: (retry: () => void) => void;
  retry: () => void;
}

const SaveContext = createContext<SaveContextValue | null>(null);

function useSave(): SaveContextValue {
  return (
    useContext(SaveContext) ?? {
      // No provider (non-draft view) — a harmless no-op so components never crash.
      state: "idle",
      begin: () => {},
      succeed: () => {},
      fail: () => {},
      retry: () => {},
    }
  );
}

function SaveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SaveState>("idle");
  const inFlight = useRef(0);
  const retryRef = useRef<(() => void) | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const begin = useCallback(() => {
    inFlight.current += 1;
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setState("saving");
  }, []);

  const settle = useCallback((next: "saved" | "error") => {
    inFlight.current = Math.max(0, inFlight.current - 1);
    if (inFlight.current > 0) return; // let the last one report
    setState(next);
    if (next === "saved") {
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setState("idle"), 1800);
    }
  }, []);

  const succeed = useCallback(() => settle("saved"), [settle]);
  const fail = useCallback(
    (retry: () => void) => {
      retryRef.current = retry;
      settle("error");
    },
    [settle],
  );
  const retry = useCallback(() => {
    const fn = retryRef.current;
    retryRef.current = null;
    fn?.();
  }, []);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const value = useMemo(
    () => ({ state, begin, succeed, fail, retry }),
    [state, begin, succeed, fail, retry],
  );

  return <SaveContext.Provider value={value}>{children}</SaveContext.Provider>;
}

function SaveIndicator() {
  const { state, retry } = useSave();
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 print:hidden"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-opacity duration-150 ease-out",
          state === "idle" && "opacity-0",
          state !== "idle" && "opacity-100",
          state === "saving" && "border-black/8 bg-white/90 text-muted-foreground",
          state === "saved" && "border-green-600/20 bg-green-50/95 text-green-700",
          state === "error" && "border-red-500/25 bg-red-50/95 text-red-700",
        )}
        data-r10n-proposal-save
      >
        {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {state === "saved" && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
        {state === "error" && <AlertTriangle className="h-3.5 w-3.5" />}
        <span>
          {state === "saving" && "Saving…"}
          {state === "saved" && "Saved"}
          {state === "error" && "Couldn't save"}
        </span>
        {state === "error" && (
          <button
            type="button"
            onClick={retry}
            className="ml-0.5 rounded-full px-2 py-0.5 font-semibold text-red-700 underline underline-offset-2 hover:text-red-800"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// A debounced autosave that funnels through the shared indicator. Returns a `save(body)`
// that debounces `delay` ms; `flush()` fires any pending save immediately (used on blur).
function useAutosave(proposalId: string, delay = 600) {
  const save = useSave();
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);
  // Holds the latest `send` so the failure path can retry the exact same body without a
  // self-referential callback (avoids the temporal-dead-zone / immutability lint hazard).
  const sendRef = useRef<(body: Record<string, unknown>) => void>(() => {});

  // Send one concrete body. Body-explicit so retry re-sends the exact same payload.
  const send = useCallback(
    async (body: Record<string, unknown>) => {
      save.begin();
      const ok = await persistEdit(proposalId, body);
      if (ok) {
        save.succeed();
        queryClient.invalidateQueries({ queryKey: ["public-proposal"] });
      } else {
        save.fail(() => sendRef.current(body));
      }
    },
    [proposalId, save, queryClient],
  );
  sendRef.current = send;

  const run = useCallback(() => {
    const body = pending.current;
    pending.current = null;
    if (body) send(body);
  }, [send]);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    run();
  }, [run]);

  const schedule = useCallback(
    (body: Record<string, unknown>, immediate = false) => {
      pending.current = { ...(pending.current ?? {}), ...body };
      if (timer.current) clearTimeout(timer.current);
      if (immediate) { run(); return; }
      timer.current = setTimeout(run, delay);
    },
    [run, delay],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { schedule, flush };
}

// ─── Themed markdown renderer (matches the document's typography) ───────────────
// react-markdown with remark-gfm ONLY (no rehype-raw): raw HTML in the stored markdown is
// escaped, never executed, so the public signing page has no XSS path. The component map
// mirrors the legacy hardcoded JSX so copy rendered from `content` looks byte-close to the
// legacy sections (text-sm, foreground/80, bold headings, disc lists, black-bar-free rules).

const DOC_MD_COMPONENTS: Components = {
  h1: (p) => <p className="mt-5 mb-2 text-sm font-bold text-foreground" {...p} />,
  h2: (p) => <p className="mt-5 mb-2 text-sm font-bold text-foreground" {...p} />,
  h3: (p) => <p className="mt-4 mb-1.5 text-sm font-semibold text-foreground" {...p} />,
  p: (p) => <p className="mb-2.5 text-sm leading-relaxed text-foreground/80" {...p} />,
  ul: (p) => <ul className="mb-3 list-disc space-y-2 pl-5 text-sm text-foreground/80" {...p} />,
  ol: (p) => <ol className="mb-3 list-decimal space-y-2 pl-5 text-sm text-foreground/80" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  a: ({ href, ...p }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
      {...p}
    />
  ),
  hr: () => <div className="h-3 bg-foreground rounded-sm my-6" />,
  table: (p) => (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  th: (p) => (
    <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground" {...p} />
  ),
  td: (p) => <td className="border border-foreground/20 px-3 py-2 text-foreground/80" {...p} />,
};

function DocMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={DOC_MD_COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Substitute the literal {{client}} token with the client's name. */
function fillClient(md: string, clientName: string): string {
  return (md ?? "").replace(/\{\{client\}\}/g, clientName);
}

// ─── Deliverables display ───────────────────────────────────────────────────────
// Structured, line-by-line scope. Grouped (Included / Exclusive / Additional) with an
// optional headline count row. Read-only render; inline editing layers on top in draft mode.
const DELIVERABLE_GROUPS: { key: DeliverableGroup; label: string }[] = [
  { key: "included", label: "Included" },
  { key: "exclusive", label: "Exclusive to your plan" },
  { key: "custom", label: "Additional" },
];

function CountStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5 rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-1.5">
      <span className="text-base font-bold text-foreground tabular-nums">{value}</span>
      <span className="text-xs text-foreground/60">{label}</span>
    </div>
  );
}

function DeliverablesDisplay({ deliverables }: { deliverables: Deliverables }) {
  const emails = deliverables.emails ?? 0;
  const popUps = deliverables.popUps ?? 0;
  const hasCounts = emails > 0 || popUps > 0;
  const populated = DELIVERABLE_GROUPS.map((g) => ({
    ...g,
    items: deliverables.items.filter((i) => i.group === g.key).sort((a, b) => a.order - b.order),
  })).filter((g) => g.items.length > 0);
  const showLabels = populated.length > 1;

  return (
    <div className="space-y-4">
      {hasCounts && (
        <div className="flex flex-wrap gap-2.5">
          {emails > 0 && <CountStat value={emails} label={emails === 1 ? "Email campaign / flow" : "Email campaigns + flows"} />}
          {popUps > 0 && <CountStat value={popUps} label={popUps === 1 ? "Pop-up redesign" : "Pop-up redesigns"} />}
        </div>
      )}
      {populated.map((g) => (
        <div key={g.key} className="space-y-2">
          {showLabels && (
            <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/45">{g.label}</p>
          )}
          <ul className="space-y-2">
            {g.items.map((it) => (
              <li key={it.id} className="flex gap-2.5 text-sm leading-relaxed">
                <Check className="mt-0.5 h-[15px] w-[15px] shrink-0 text-foreground/35" strokeWidth={2.5} />
                <span className="text-foreground/85">
                  <span className="font-medium text-foreground">{it.label}</span>
                  {it.detail ? <span className="text-foreground/55"> — {it.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ─── Deliverables editor (draft only) ──────────────────────────────────────────
// The owner's #1 surface. Grouped, line-by-line, drag-to-reorder within a group. Add /
// edit label + detail / remove / change group / edit counts / add a custom line. Every
// change autosaves the WHOLE deliverables object through the shared indicator.

function uid() {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function SortableDeliverableRow({
  item,
  onChange,
  onRemove,
}: {
  item: DeliverableItem;
  onChange: (patch: Partial<DeliverableItem>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-start gap-2 rounded-[8px] border border-dashed border-transparent px-1.5 py-1.5 transition-colors duration-150 ease-out hover:border-[var(--color-signal,#2563EB)]/30 hover:bg-[var(--color-signal,#2563EB)]/[0.04]",
        isDragging && "border-[var(--color-signal,#2563EB)]/40 bg-white shadow-md",
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        className="mt-1 shrink-0 cursor-grab touch-none rounded p-0.5 text-foreground/25 transition-colors hover:text-foreground/60 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Check className="mt-2 h-[15px] w-[15px] shrink-0 text-foreground/35" strokeWidth={2.5} />
      <div className="min-w-0 flex-1 space-y-1">
        <input
          type="text"
          value={item.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Deliverable"
          className="w-full rounded-[5px] border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-foreground outline-none transition-colors duration-150 ease-out hover:border-black/10 focus:border-[var(--color-signal,#2563EB)]/50 focus:bg-white"
        />
        <input
          type="text"
          value={item.detail ?? ""}
          onChange={(e) => onChange({ detail: e.target.value })}
          placeholder="Add a short detail (optional)"
          className="w-full rounded-[5px] border border-transparent bg-transparent px-1.5 py-0.5 text-[13px] text-foreground/55 outline-none transition-colors duration-150 ease-out placeholder:text-foreground/30 hover:border-black/10 focus:border-[var(--color-signal,#2563EB)]/50 focus:bg-white"
        />
      </div>
      <select
        value={item.group}
        onChange={(e) => onChange({ group: e.target.value as DeliverableGroup })}
        aria-label="Group"
        className="mt-0.5 shrink-0 cursor-pointer rounded-[5px] border border-black/10 bg-white px-1.5 py-1 text-[11px] font-medium text-foreground/70 outline-none transition-colors duration-150 ease-out hover:border-[var(--color-signal,#2563EB)]/40 focus:border-[var(--color-signal,#2563EB)]/60"
      >
        <option value="included">Included</option>
        <option value="exclusive">Exclusive</option>
        <option value="custom">Additional</option>
      </select>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove deliverable"
        className="mt-1 shrink-0 rounded p-1 text-foreground/25 opacity-0 transition-all duration-150 ease-out hover:bg-red-50 hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function CountEditor({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-1.5">
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="w-12 rounded-[4px] border border-black/10 bg-white px-1.5 py-0.5 text-center text-base font-bold tabular-nums text-foreground outline-none transition-colors duration-150 ease-out focus:border-[var(--color-signal,#2563EB)]/60"
      />
      <span className="text-xs text-foreground/60">{label}</span>
    </label>
  );
}

function DeliverablesEditor({
  deliverables,
  proposalId,
}: {
  deliverables: Deliverables | null;
  proposalId: string;
}) {
  // Local working copy; the server normalizes and re-orders on save, then the query refetch
  // reconciles. We keep edits snappy by mutating locally and autosaving the whole blob.
  const seed = useMemo<Deliverables>(
    () =>
      deliverables ?? { packageId: null, packageName: null, emails: null, popUps: null, items: [] },
    [deliverables],
  );
  const [draft, setDraft] = useState<Deliverables>(seed);
  const lastSaved = useRef(JSON.stringify(seed));
  const { schedule } = useAutosave(proposalId);

  // Re-seed from the server only when the incoming value genuinely differs from what we
  // last persisted (avoids clobbering in-progress typing on a background refetch).
  useEffect(() => {
    const incoming = JSON.stringify(seed);
    if (incoming !== lastSaved.current) {
      lastSaved.current = incoming;
      setDraft(seed);
    }
  }, [seed]);

  const commit = useCallback(
    (next: Deliverables, immediate = false) => {
      setDraft(next);
      lastSaved.current = JSON.stringify(next);
      schedule({ deliverables: next }, immediate);
    },
    [schedule],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const grouped = DELIVERABLE_GROUPS.map((g) => ({
    ...g,
    items: draft.items.filter((i) => i.group === g.key).sort((a, b) => a.order - b.order),
  }));

  function reorderWithin(groupKey: DeliverableGroup, from: string, to: string) {
    const inGroup = draft.items.filter((i) => i.group === groupKey).sort((a, b) => a.order - b.order);
    const oldIndex = inGroup.findIndex((i) => i.id === from);
    const newIndex = inGroup.findIndex((i) => i.id === to);
    if (oldIndex < 0 || newIndex < 0) return;
    const moved = arrayMove(inGroup, oldIndex, newIndex);
    const others = draft.items.filter((i) => i.group !== groupKey);
    // Re-flatten: keep other groups, splice this group's new order back in global order space.
    const next = [...others, ...moved].map((it, i) => ({ ...it, order: i }));
    commit({ ...draft, items: next });
  }

  function patchItem(id: string, patch: Partial<DeliverableItem>) {
    const next = draft.items.map((it) => {
      if (it.id !== id) return it;
      const merged = { ...it, ...patch };
      if (patch.detail !== undefined && !patch.detail.trim()) delete merged.detail;
      return merged;
    });
    commit({ ...draft, items: next });
  }

  function removeItem(id: string) {
    const next = draft.items.filter((it) => it.id !== id).map((it, i) => ({ ...it, order: i }));
    commit({ ...draft, items: next }, true);
  }

  function addItem(group: DeliverableGroup) {
    const next: DeliverableItem = { id: uid(), label: "", group, order: draft.items.length };
    commit({ ...draft, items: [...draft.items, next] });
  }

  return (
    <div className="space-y-4" data-r10n-proposal-deliverables-editor>
      {/* Counts */}
      <div className="flex flex-wrap items-center gap-2.5">
        <CountEditor
          label="Email campaigns + flows"
          value={draft.emails ?? 0}
          onChange={(n) => commit({ ...draft, emails: n || null })}
        />
        <CountEditor
          label="Pop-up redesigns"
          value={draft.popUps ?? 0}
          onChange={(n) => commit({ ...draft, popUps: n || null })}
        />
      </div>

      {/* Grouped, sortable items */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e: DragEndEvent) => {
          const { active, over } = e;
          if (!over || active.id === over.id) return;
          const item = draft.items.find((i) => i.id === active.id);
          if (!item) return;
          reorderWithin(item.group, String(active.id), String(over.id));
        }}
      >
        <div className="space-y-4">
          {grouped.map((g) => (
            <div key={g.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/45">{g.label}</p>
                <button
                  type="button"
                  onClick={() => addItem(g.key)}
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-[var(--color-signal,#2563EB)] transition-colors duration-150 ease-out hover:bg-[var(--color-signal,#2563EB)]/10"
                >
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                  Add line
                </button>
              </div>
              {g.items.length === 0 ? (
                <p className="rounded-[8px] border border-dashed border-black/10 px-3 py-2 text-xs text-foreground/40">
                  No lines yet.
                </p>
              ) : (
                <SortableContext items={g.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-0.5">
                    {g.items.map((it) => (
                      <SortableDeliverableRow
                        key={it.id}
                        item={it}
                        onChange={(patch) => patchItem(it.id, patch)}
                        onRemove={() => removeItem(it.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              )}
            </div>
          ))}
        </div>
      </DndContext>
    </div>
  );
}

// Signature line shows the name in title case (content stores it upper-cased, e.g.
// "GAGE FLESHER" → "Gage Flesher") to match the legacy italic serif signature.
function titleCaseName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(d: string | Date | null) {
  if (!d) return null;
  const date = new Date(d);
  return `${date.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function fmtDateShort(d: string | Date | null) {
  if (!d) return null;
  const date = new Date(d);
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

// ─── Signature Canvas ──────────────────────────────────────────────────────────

function SignatureCanvas({
  onSign,
  disabled,
  canSign = true,
}: {
  onSign: (dataUrl: string) => void;
  disabled?: boolean;
  canSign?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [strong, setStrong] = useState(false); // enough ink + spread to be a real signature
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // A real signature has meaningful ink AND spans a real area. A single dot/tap fails both,
  // so people can't just place a dot and continue.
  function evaluateSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0, minX = canvas.width, maxX = -1, minY = canvas.height, maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] > 20) {
          ink++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    setStrong(ink >= 100 && maxX - minX >= 40 && maxY - minY >= 12);
  }

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvasRef.current!.width / rect.width),
      y: (e.clientY - rect.top) * (canvasRef.current!.height / rect.height),
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing(true);
    const pos = getPos(e);
    lastPos.current = pos;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1, 0, Math.PI * 2);
    ctx.fillStyle = "#0F3A5C";
    ctx.fill();
    setHasStroke(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing || !lastPos.current || disabled) return;
    const pos = getPos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#0F3A5C";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
  }

  function handlePointerUp() {
    setDrawing(false);
    lastPos.current = null;
    evaluateSignature();
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
    setStrong(false);
  }

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-border rounded-[6px] overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={480}
          height={100}
          className={cn(
            "w-full touch-none select-none",
            disabled ? "opacity-40 cursor-not-allowed" : "cursor-crosshair"
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {!hasStroke && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 text-muted-foreground/40">
              <Pen className="w-3.5 h-3.5" />
              <span className="text-sm">Draw your signature here</span>
            </div>
          </div>
        )}
      </div>
      {hasStroke && !strong && (
        <p className="text-[11px] text-amber-600">Please draw your full signature to continue.</p>
      )}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={clear}
          disabled={!hasStroke || disabled}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <RefreshCw className="w-3 h-3" />
          Clear
        </button>
        <button
          type="button"
          onClick={() => {
            if (!strong || !canvasRef.current || !canSign) return;
            onSign(canvasRef.current.toDataURL("image/png"));
          }}
          disabled={!strong || disabled || !canSign}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-[7px] transition-all",
            strong && !disabled && canSign
              ? "bg-primary text-white hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          <Check className="w-3.5 h-3.5" />
          Sign &amp; Continue
        </button>
      </div>
    </div>
  );
}

// ─── Status screens ────────────────────────────────────────────────────────────

function StatusScreen({
  icon: Icon,
  title,
  message,
  color = "muted",
}: {
  icon: React.ElementType;
  title: string;
  message: string;
  color?: "muted" | "green" | "amber" | "red";
}) {
  const colorMap = {
    muted: "text-muted-foreground bg-muted",
    green: "text-green-600 bg-green-50",
    amber: "text-amber-600 bg-amber-50",
    red: "text-red-600 bg-red-50",
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="text-center max-w-xs">
        <div className={cn("w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4", colorMap[color])}>
          <Icon className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>{title}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

// ─── Scope display ─────────────────────────────────────────────────────────────
// Parses the compileScope() output format into clean section headers + bullet lists

function ScopeDisplay({ text }: { text: string }) {
  const sections = text.split(/\n\n+/);
  return (
    <div className="mb-4 space-y-3">
      {sections.map((section, si) => {
        const lines = section.split("\n").filter(Boolean);
        if (!lines.length) return null;

        // Check if first line is a section header (ends with : and no bullet)
        const firstLine = lines[0];
        const isHeader = firstLine.endsWith(":") && !firstLine.startsWith("•");
        const header = isHeader ? firstLine.slice(0, -1) : null;
        const bodyLines = isHeader ? lines.slice(1) : lines;

        return (
          <div key={si}>
            {header && (
              <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-1.5">{header}</p>
            )}
            {/* Render every line IN ITS ORIGINAL ORDER. Bullet lines (•/-/*) keep a
                bullet marker, plain lines render as prose — nothing is reshuffled.
                (Previously bullets were grouped and rendered before all prose, which
                moved lines around between edit and preview/send.) */}
            <div className="space-y-0.5">
              {bodyLines.map((line, li) => {
                const isBullet =
                  line.startsWith("•") || line.startsWith("-") || line.startsWith("*");
                return isBullet ? (
                  <div key={li} className="flex items-baseline gap-2 text-sm text-foreground/80">
                    <span className="text-foreground/40 shrink-0">•</span>
                    <span>{line.replace(/^[•\-*]\s*/, "")}</span>
                  </div>
                ) : (
                  <p key={li} className="text-sm text-foreground/80 leading-relaxed">{line}</p>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Document divider (matches PDF black bars) ─────────────────────────────────

function DocDivider() {
  return <div className="h-3 bg-foreground rounded-sm my-6" />;
}

// ─── Pricing table ─────────────────────────────────────────────────────────────

function PricingTable({ proposal }: { proposal: ProposalData }) {
  const isManagement = proposal.type === "management";
  // All billing wording derives from one shared model so the table, the sidebar,
  // the PDF, and the admin view always agree — and always match what Stripe charges.
  const terms = proposal as BillingTerms;
  const suffix = priceSuffix(terms);
  const disc = discountInfo(terms);
  const discSentence = discountSentence(terms, (n) => fmtAmount(n, proposal.currency));
  // 90-Day Management leads with the full 90-day total (monthly × 3); every other proposal
  // already stores its true total, so mult is 1 and nothing changes for them.
  const mult = termMultiplier(terms);
  const totalLabel = `${fmtAmount(fullTermTotal(terms), proposal.currency)}${suffix}`;
  const listLabel = disc ? `${fmtAmount(disc.listAmount, proposal.currency)}${suffix}` : null;
  const mgmtSchedule = managementSchedule(terms);

  // The price cell: struck-through list price → billed price when a discount applies.
  const priceNode = disc ? (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-foreground/40 line-through font-normal">{listLabel}</span>
      <span>{totalLabel}</span>
    </span>
  ) : (
    <>{totalLabel}</>
  );

  // Prefer the per-proposal content snapshot's service label; fall back to the legacy
  // hardcoded label when a proposal has no content (older/legacy records).
  const serviceLabel =
    proposal.content?.serviceLabel ??
    (isManagement ? "Kracked Retention Email + SMS Marketing Management" : "Project Services");

  // For project proposals with structured scope text, render it as formatted bullets
  const serviceCellContent = !isManagement && proposal.serviceDescription ? (
    <ScopeDisplay text={proposal.serviceDescription} />
  ) : (
    <span className="font-medium">{serviceLabel}</span>
  );

  return (
    <div className="my-6">
      <p className="text-sm font-bold text-foreground mb-1">Pricing</p>
      <p className="text-sm text-foreground/80 mb-3">
        All costs listed below are based on the scope and assumptions included in this Statement of Work.
      </p>

      {/* ── Mobile pricing card (hidden on sm+) ── */}
      <div className="sm:hidden border border-foreground/20 rounded-[8px] overflow-hidden mb-4 text-sm">
        <div className="bg-foreground/5 px-4 py-2.5 flex items-center justify-between border-b border-foreground/20">
          <span className="font-bold text-foreground text-xs uppercase tracking-wide">{isManagement ? "Services" : "Project"}</span>
          <span className="font-bold text-foreground">{priceNode}</span>
        </div>
        <div className="px-4 py-3">{serviceCellContent}</div>
        <div className="bg-foreground/5 px-4 py-3 border-t border-foreground/20 flex items-center justify-between">
          <span className="font-bold text-foreground">Total</span>
          <span className="text-xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{totalLabel}</span>
        </div>
      </div>

      {/* ── Desktop pricing table (hidden on mobile) ── */}
      <table className="hidden sm:table w-full border-collapse mb-4 text-sm">
        <thead>
          <tr>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground">
              {isManagement ? "Services" : "Project"}
            </th>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-right font-bold text-foreground w-32">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-foreground/20 px-3 py-2 text-foreground">{serviceCellContent}</td>
            <td className="border border-foreground/20 px-3 py-2 text-right font-bold text-foreground align-top">{priceNode}</td>
          </tr>
          <tr>
            <td className="border border-foreground/20 px-3 py-2 text-right font-bold text-foreground">Total:</td>
            <td className="border border-foreground/20 px-3 py-2 text-right font-bold text-foreground">{totalLabel}</td>
          </tr>
        </tbody>
      </table>

      {/* Plain-language billing summary + savings — what they pay and whether it recurs */}
      <p className="text-sm text-foreground/75 mb-1.5">{clientSentence(terms)}</p>
      {/* A once-off discount reduces payment 1 on the schedule below while the monthly price
          stays whole. Without this line the client sees two figures and no reason for the gap. */}
      {discSentence && <p className="text-sm text-foreground/75 mb-1.5">{discSentence}</p>}
      {disc && (
        <p className="text-xs font-semibold text-green-700 mb-3">
          You save {fmtAmount(disc.saved, proposal.currency)} ({disc.pct}% off).
        </p>
      )}

      {/* ── Payment schedule ── */}
      {proposal.paymentStructure === "instalment" && proposal.instalments.length > 0 && (() => {
        const sorted = [...proposal.instalments].sort((a, b) => a.instalmentNumber - b.instalmentNumber);
        return (
          <>
            {/* Mobile */}
            <div className="sm:hidden border border-foreground/20 rounded-[8px] overflow-hidden mb-4 text-sm">
              <div className="bg-foreground/5 px-4 py-2.5 border-b border-foreground/20">
                <span className="font-bold text-foreground text-xs uppercase tracking-wide">Payment Schedule</span>
              </div>
              {sorted.map((inst) => (
                <div key={inst.id} className="flex items-center justify-between px-4 py-3 border-b border-foreground/10 last:border-0">
                  <div>
                    <p className="font-medium text-foreground">Instalment {inst.instalmentNumber} of {proposal.instalments.length}</p>
                    <p className="text-xs text-foreground/60 mt-0.5">Due {fmtDateShort(inst.dueDate)}</p>
                  </div>
                  <span className="font-bold text-foreground">{fmtAmount(inst.amount, proposal.currency)}</span>
                </div>
              ))}
            </div>

            {/* Desktop */}
            <table className="hidden sm:table w-full border-collapse mb-4 text-sm">
              <thead>
                <tr>
                  <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground" colSpan={3}>Payment Schedule</th>
                </tr>
                <tr>
                  <th className="border border-foreground/20 bg-foreground/8 px-3 py-1.5 text-left text-xs font-semibold text-foreground/70">Instalment</th>
                  <th className="border border-foreground/20 bg-foreground/8 px-3 py-1.5 text-left text-xs font-semibold text-foreground/70">Due Date</th>
                  <th className="border border-foreground/20 bg-foreground/8 px-3 py-1.5 text-right text-xs font-semibold text-foreground/70">Amount</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((inst) => (
                  <tr key={inst.id}>
                    <td className="border border-foreground/20 px-3 py-2 text-foreground">{inst.instalmentNumber} of {proposal.instalments.length}</td>
                    <td className="border border-foreground/20 px-3 py-2 text-foreground">{fmtDateShort(inst.dueDate)}</td>
                    <td className="border border-foreground/20 px-3 py-2 text-right font-bold text-foreground">{fmtAmount(inst.amount, proposal.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        );
      })()}

      {/* ── 90-Day Management payment schedule (spread) — mirrors the project instalment table ── */}
      {mgmtSchedule && mgmtSchedule.length > 0 && (
        <>
          {/* Mobile */}
          <div className="sm:hidden border border-foreground/20 rounded-[8px] overflow-hidden mb-4 text-sm">
            <div className="bg-foreground/5 px-4 py-2.5 border-b border-foreground/20">
              <span className="font-bold text-foreground text-xs uppercase tracking-wide">Payment Schedule</span>
            </div>
            {mgmtSchedule.map((row, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-foreground/10 last:border-0">
                <div>
                  <p className="font-medium text-foreground">{row.label}</p>
                  <p className="text-xs text-foreground/60 mt-0.5">{row.when}</p>
                </div>
                <span className="font-bold text-foreground">{fmtAmount(row.amount, proposal.currency)}</span>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <table className="hidden sm:table w-full border-collapse mb-4 text-sm">
            <thead>
              <tr>
                <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground" colSpan={3}>Payment Schedule</th>
              </tr>
              <tr>
                <th className="border border-foreground/20 bg-foreground/8 px-3 py-1.5 text-left text-xs font-semibold text-foreground/70">Payment</th>
                <th className="border border-foreground/20 bg-foreground/8 px-3 py-1.5 text-left text-xs font-semibold text-foreground/70">Date</th>
                <th className="border border-foreground/20 bg-foreground/8 px-3 py-1.5 text-right text-xs font-semibold text-foreground/70">Amount</th>
              </tr>
            </thead>
            <tbody>
              {mgmtSchedule.map((row, i) => (
                <tr key={i}>
                  <td className="border border-foreground/20 px-3 py-2 text-foreground">{row.label}</td>
                  <td className="border border-foreground/20 px-3 py-2 text-foreground">{row.when}</td>
                  <td className="border border-foreground/20 px-3 py-2 text-right font-bold text-foreground">{fmtAmount(row.amount, proposal.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ── Invoice date + payment options ── */}
      {/* Mobile */}
      <div className="sm:hidden border border-foreground/20 rounded-[8px] overflow-hidden text-sm">
        <div className="px-4 py-3 flex items-center justify-between border-b border-foreground/10">
          <span className="text-xs font-semibold text-foreground/60 uppercase tracking-wide">Invoice Date</span>
          <span className="font-medium text-foreground" suppressHydrationWarning>
            {fmtDate(billingAnchor(terms)) ?? fmtDate(new Date())}
          </span>
        </div>
        <div className="px-4 py-3">
          <span className="text-xs font-semibold text-foreground/60 uppercase tracking-wide block mb-1">Payment</span>
          <span className="text-foreground/80">Invoice via Stripe, Bank Transfer, or Zelle</span>
        </div>
      </div>

      {/* Desktop */}
      <table className="hidden sm:table w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground">Invoice Date</th>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground">Payment Options</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-foreground/20 px-3 py-2 font-medium text-foreground" suppressHydrationWarning>
              {fmtDate(billingAnchor(terms)) ?? fmtDate(new Date())}
            </td>
            <td className="border border-foreground/20 px-3 py-2 text-foreground/80">
              Invoice via Stripe, Bank Transfer, or Zelle
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Legal section heading ─────────────────────────────────────────────────────

function LegalHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-bold text-foreground mt-5 mb-2">{children}</p>;
}

// ─── Additional scope pricing table ───────────────────────────────────────────

function AdditionalScopePricing({
  isManagement,
  isDraft,
  proposalId,
  savedRates,
}: {
  isManagement: boolean;
  isDraft?: boolean;
  proposalId?: string;
  savedRates?: string | null;
}) {
  const defaults = isManagement
    ? [
        { item: "Campaign Emails", cost: "$200 per email" },
        { item: "Flow Emails", cost: "$200 per email" },
        { item: "Flow Email Edits", cost: "$100 per email" },
        { item: "SMS", cost: "FREE" },
        { item: "Pop-Up", cost: "$150 per Pop-Up" },
      ]
    : [
        { item: "Flow Emails", cost: "$200 per email" },
        { item: "SMS", cost: "FREE" },
        { item: "Pop-Up", cost: "$150 per Pop-Up" },
      ];

  const [rows, setRows] = useState<{ item: string; cost: string }[]>(() => {
    try {
      return savedRates ? JSON.parse(savedRates) : defaults;
    } catch {
      return defaults;
    }
  });
  const queryClient = useQueryClient();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [saveError, setSaveError] = useState(false);

  async function saveRow(idx: number) {
    if (!proposalId) return;
    // Small delay to ensure React state has flushed to the ref
    await new Promise(r => setTimeout(r, 50));
    setSavingIdx(idx);
    setSaveError(false);
    const ok = await persistEdit(proposalId, { additionalRates: JSON.stringify(rowsRef.current) });
    setSavingIdx(null);
    if (ok) queryClient.invalidateQueries({ queryKey: ["public-proposal"] });
    else setSaveError(true);
  }

  return (
    <div className="my-4">
      {saveError && (
        <p className="text-xs text-red-600 font-medium mb-2 bg-red-50 px-2.5 py-1.5 rounded-[6px] print:hidden">
          A pricing change didn&apos;t save. Edit the cell again and tab out to retry.
        </p>
      )}
      <p className="text-sm text-foreground/80 leading-relaxed mb-3">
        {isManagement
          ? "If additional services are requested (e.g., extra campaigns, flow build-outs, or any other additional support), Kracked Retention will pro-rate based on the below table. If a service is not listed, a proposal via Slack or email will be sent upon request outlining the additional scope and cost. Upon written acceptance, work will be completed and prorated at the end of the month."
          : "Any services outside the agreed scope (e.g., Monthly Management, extra flows, or campaigns) will require a separate agreement mutually approved by both parties. If additional items are requested after the kick-off call, they will be pro-rated and invoiced separately per the pricing table below."}
      </p>
      {/* Mobile */}
      <div className="sm:hidden border border-foreground/20 rounded-[8px] overflow-hidden text-sm mb-1">
        <div className="bg-foreground/5 px-4 py-2.5 border-b border-foreground/20">
          <span className="font-bold text-foreground text-xs uppercase tracking-wide">Additional Scope Pricing</span>
        </div>
        {rows.map((row, idx) => (
          <div key={idx} className={cn("flex items-center justify-between px-4 py-2.5 border-b border-foreground/10 last:border-0", savingIdx === idx && "opacity-60")}>
            <span className="font-medium text-foreground">{row.item}</span>
            {isDraft ? (
              <input
                type="text"
                value={row.cost}
                onChange={(e) => { const v = e.target.value; setRows(prev => prev.map((r, i) => i === idx ? { ...r, cost: v } : r)); }}
                onBlur={() => saveRow(idx)}
                className="w-32 text-right bg-amber-50/70 hover:bg-amber-50 border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-200 rounded-[4px] px-2 py-1 outline-none transition-all text-sm text-foreground/80"
              />
            ) : (
              <span className="text-foreground/70">{row.cost}</span>
            )}
          </div>
        ))}
      </div>

      {/* Desktop */}
      <table className="hidden sm:table w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground">Additional Scope Pricing</th>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-right font-bold text-foreground w-40">
              Cost{isDraft && <span className="ml-1 text-[10px] font-normal text-primary/50">(click to edit)</span>}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className={cn(savingIdx === idx && "opacity-60")}>
              <td className="border border-foreground/20 px-3 py-2 font-medium text-foreground">{row.item}</td>
              <td className="border border-foreground/20 px-1 py-1 text-right text-foreground/80">
                {isDraft ? (
                  <input
                    type="text"
                    value={row.cost}
                    onChange={(e) => { const v = e.target.value; setRows(prev => prev.map((r, i) => i === idx ? { ...r, cost: v } : r)); }}
                    onBlur={() => saveRow(idx)}
                    className="w-full text-right bg-amber-50/70 hover:bg-amber-50 border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-200 rounded-[4px] px-2 py-1 outline-none transition-all text-sm text-foreground/80"
                  />
                ) : (
                  <span className="px-2">{row.cost}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Management legal terms ────────────────────────────────────────────────────

function ManagementTerms({ isDraft, proposalId, savedRates }: { isDraft?: boolean; proposalId?: string; savedRates?: string | null }) {
  return (
    <div className="text-sm text-foreground/80 leading-relaxed">
      <p className="mb-3">
        Invoices will be issued monthly via Stripe, ACH, or Zelle, and payment is due upon receipt.
        Failure to complete payment within the agreed timeframe may result in a temporary pause of
        services until payment is received.
      </p>

      <AdditionalScopePricing isManagement={true} isDraft={isDraft} proposalId={proposalId} savedRates={savedRates} />

      <LegalHeading>Clarifications</LegalHeading>
      <p className="mb-2">
        <strong className="text-foreground">Flow Email Edit</strong> — A modification to an existing
        flow email that does not change the core strategy or structure. This includes copy revisions,
        minor design adjustments, formatting updates, or small content swaps where the original email
        framework remains intact.
      </p>
      <p className="mb-2">
        <strong className="text-foreground">New Flow Email</strong> — A newly created flow email that
        requires new strategy, messaging, or layout. This includes net new emails added to an existing
        flow, replacement emails built from scratch, or any email where the copy, design, or structure
        is materially different from an existing asset.
      </p>
      <p className="mb-4 text-foreground/60 italic">
        *If a request does not fit any of the above definitions, both parties will agree on a mutual rate.
      </p>

      <LegalHeading>Service Collaboration &amp; Cooperation</LegalHeading>
      <p className="mb-2">
        To maintain a fair and healthy long-term relationship, Kracked Retention reserves the right to
        temporarily pause services if cooperation or communication from the Client prevents effective
        service delivery. This pause will remain in effect until both parties reach a mutual resolution
        on how to proceed. Additionally, if payment for services is not made, Kracked Retention may
        suspend all active services until the agreed-upon payment is completed.
      </p>
      <p>
        Our goal is to maintain a positive, collaborative, and results-driven partnership to ensure
        successful outcomes across all managed brands.
      </p>

      <LegalHeading>Term &amp; Renewal</LegalHeading>
      <p className="mb-2">
        This Agreement operates on a month-to-month basis and will automatically renew unless terminated
        in accordance with the Pause &amp; Termination Policy. Services and billing will automatically
        renew monthly (every 30 Days) per the terms of this agreement.
      </p>
      <p>
        If the Client wishes to initiate any additional services during a billing month, a separate
        invoice will be issued based on the additional scope pricing as mutually agreed upon by both
        parties. This ensures seamless continuity across all planning, scheduling, and delivery efforts
        for the Client.
      </p>

      <LegalHeading>Pause &amp; Termination Policy</LegalHeading>
      <p className="mb-3">
        Kracked Retention&apos;s production cycle requires strategic planning, copywriting, and design to
        be completed up to 30 days ahead of implementation. Given that Kracked Retention operates on a
        proactive schedule and plans all campaigns and deliverables in advance, the Client agrees to the
        following terms regarding pauses or cancellations:
      </p>
      <ul className="list-disc pl-5 space-y-2 mb-3">
        <li>
          <strong className="text-foreground">Notice Requirement:</strong> If the Client wishes to pause
          or suspend services, a minimum of 30 days&apos; written notice must be provided to
          admin@krackedretention.com. This allows Kracked Retention to adjust campaign schedules,
          production timelines, and resources accordingly.
        </li>
        <li>
          <strong className="text-foreground">Work Completed in Advance:</strong> Because Kracked
          Retention begins preparing campaigns and creative assets ahead of schedule, any work that has
          already been completed or is in progress at the time of notice, as documented in internal
          project management tools, Figma files, or Slack communications, will remain billable and will
          be invoiced in full. These deliverables will be completed, implemented, or provided to the
          Client as part of the final closeout.
        </li>
        <li>
          <strong className="text-foreground">Final Closeout:</strong> Once all in-progress work has
          been completed and implemented, Kracked Retention will consider the client&apos;s account closed
          and inactive until a written request to resume services is made and mutually agreed upon.
        </li>
        <li>
          <strong className="text-foreground">No Immediate Termination:</strong> Pausing or canceling
          services without providing the required notice may result in outstanding invoices for work
          already planned or completed under the 30-day lookahead schedule.
        </li>
      </ul>
      <p>
        This policy ensures clarity and fairness regarding scheduling, deliverables, and billing for
        all parties involved.
      </p>

      <LegalHeading>Privacy &amp; Confidentiality</LegalHeading>
      <p className="mb-2">
        Both parties agree to maintain the confidentiality of all business information, data, and
        assets shared throughout the partnership.
      </p>
      <ul className="list-disc pl-5 space-y-2 mb-2">
        <li>Kracked Retention and Client agree to keep all confidential business information private and not disclose it to any third party.</li>
        <li>The final email assets, including copy and design, will be owned by the Client upon full payment.</li>
        <li>Kracked Retention will maintain necessary access to each brand&apos;s ESP and SMS platforms in addition to Shopify until all deliverables and payments are completed.</li>
        <li>If either party violates or shows intent to violate any agreements within this section, the non-violating party shall be entitled to injunctive relief to prevent further harm.</li>
        <li>You further agree that your participation is subject to our Privacy Policy and Terms of Use.</li>
      </ul>

      <LegalHeading>Terms of Sale</LegalHeading>
      <ul className="list-disc pl-5 space-y-2 mb-2">
        <li>You acknowledge that all sales are final and non-refundable. You waive any rights to charge back your purchase with your credit card processor, provided that the project is completed in a timely manner as agreed upon by both parties.</li>
        <li>If the Client wishes to cancel the services, they must provide written notice via email to admin@krackedretention.com or via Slack. Any outstanding balance for work completed up to the cancellation date remains due, unless the cancellation is due to an agreed-upon cause of incompletion, such as the Service Provider&apos;s inability to fulfill the agreed scope of work.</li>
        <li>Deliverables are measured by work planned and created, not by final deployment. Any campaign, message, or asset that is strategized, written, designed, or prepared during the billing period will be counted toward deliverable limits and billed accordingly, regardless of whether the Client elects to send, delay, or cancel deployment.</li>
        <li>This agreement applies only to the baseline services outlined in the scope of work. Any additional services, including extra email campaigns, SMS campaigns, or flows, will require mutual written agreement and will be invoiced separately.</li>
        <li>The Client retains sole ownership of all Customer Materials, including final assets created under this agreement, upon full payment.</li>
      </ul>

      <LegalHeading>Governing Law</LegalHeading>
      <ul className="list-disc pl-5 space-y-2">
        <li>This Agreement is governed by the laws of the State of Tennessee. All parties consent to the jurisdiction of Tennessee courts for dispute resolution and waive the right to a jury trial to the full extent allowable.</li>
        <li>This Agreement constitutes the entire understanding between the parties and supersedes all prior agreements, whether written or verbal. In the event any provision of this Agreement is held invalid or unenforceable, the remaining provisions shall remain in full force and effect. Time is of the essence in fulfilling all obligations under this Agreement.</li>
      </ul>
    </div>
  );
}

// ─── Project legal terms ───────────────────────────────────────────────────────

function ProjectTerms({ isDraft, proposalId, savedRates }: { isDraft?: boolean; proposalId?: string; savedRates?: string | null }) {
  return (
    <div className="text-sm text-foreground/80 leading-relaxed">
      <AdditionalScopePricing isManagement={false} isDraft={isDraft} proposalId={proposalId} savedRates={savedRates} />

      <LegalHeading>Service Collaboration &amp; Cooperation</LegalHeading>
      <p className="mb-2">
        To fully experience and gain the most benefit from our services, you agree: In order to
        maintain a fair and healthy long-term relationship, we reserve the right to temporarily pause
        our services if you become uncooperative to the extent that it hampers our ability to provide
        effective service. This pause will remain in effect until we reach a mutual agreement on how to
        proceed. Additionally, if payment for our services is not made, we may also suspend all services
        until the agreed-upon payment is completed.
      </p>
      <p>
        Our goal is to maintain a positive, collaborative, and results-driven partnership to ensure a
        successful outcome for both parties.
      </p>

      <LegalHeading>Privacy &amp; Confidentiality</LegalHeading>
      <p className="mb-2">
        We respect your privacy and must insist that you respect the privacy of team members involved.
        Video calls and phone calls may be recorded for quality and training purposes. We respect your
        confidential and proprietary information, ideas, and plans.
      </p>
      <ul className="list-disc pl-5 space-y-2 mb-2">
        <li>Kracked Retention and Client agree to keep all confidential business information private and not disclose it to any third party.</li>
        <li>The final email assets, including copy and design, will be owned by the Client upon full payment.</li>
        <li>Kracked Retention must be granted access to the ESP (e.g., Klaviyo) until the project is completed and all outstanding payments are settled.</li>
        <li>If either party violates or shows intent to violate any agreements within this section, the non-violating party shall be entitled to injunctive relief to prevent further harm.</li>
        <li>If the Client chooses to cancel services, both parties must return all documents and materials containing Confidential Information, delete all such information from digital systems, and provide written certification of compliance.</li>
        <li>You further agree that your participation is subject to our Privacy Policy and Terms of Use.</li>
      </ul>

      <LegalHeading>Terms of Sale</LegalHeading>
      <ul className="list-disc pl-5 space-y-2 mb-2">
        <li>You acknowledge that all sales are final and non-refundable. You waive any rights to charge back your purchase with your credit card processor, provided that the project is completed in a timely manner as deemed by Kracked Retention.</li>
        <li>If the Client wishes to cancel the project before completion, they must provide written notice via email to admin@krackedretention.com. Any outstanding balance for work completed up to the cancellation date remains due, unless the cancellation is due to an agreed-upon cause of project incompletion, such as the Service Provider&apos;s inability to fulfill the agreed scope of work.</li>
        <li>Unlimited revisions apply only to refinements within the brand direction and strategy approved at kickoff. Any request that requires reworking or recreating email assets due to a material change in branding, positioning, tone, or creative direction is considered out of scope and will be billed separately, with fees and timelines agreed upon in writing before work begins.</li>
        <li><strong className="text-foreground">Revision:</strong> A minor adjustment to an existing email that does not alter the approved strategy, structure, or creative direction. Revisions include small copy edits, light visual tweaks, formatting adjustments, or clarification requests that build upon the originally approved concept without requiring rework of the email.</li>
        <li><strong className="text-foreground">Substantive Revision:</strong> Any change that materially alters the approved strategy, messaging, structure, or creative direction of an email. This includes requests driven by shifts in branding, tone, positioning, layout, or campaign objective, and any change that requires partial or full re-creation of copy, design, or implementation. Substantive revisions are treated as new scope and billed at $100 per email.</li>
        <li>This agreement applies only to the one-time setup project outlined in the scope of work. Any additional services, including ongoing monthly management, require a separate agreement.</li>
        <li>The Client retains sole ownership of all Customer Materials, including final email assets created under this agreement, upon full payment.</li>
        <li>This Agreement is governed by the laws of the State of Tennessee. All parties consent to the jurisdiction of Tennessee courts for dispute resolution and waive the right to a jury trial to the full extent allowable.</li>
        <li>This Agreement constitutes the entire understanding between the parties and supersedes all prior agreements, whether written or verbal. Time is of the essence in fulfilling all obligations under this Agreement.</li>
      </ul>
    </div>
  );
}

// ─── Acceptance body text (type-specific) ─────────────────────────────────────

function AcceptanceText({ isManagement }: { isManagement: boolean }) {
  if (isManagement) {
    return (
      <>
        <p className="text-sm text-foreground/80 leading-relaxed mb-2">
          The Client named below acknowledges and agrees to all terms outlined in this Statement of
          Work. Both parties confirm they have the authority to enter into this Agreement on behalf of
          their respective companies.
        </p>
        <p className="text-sm text-foreground/80 leading-relaxed mb-2">
          The Client authorizes Kracked Retention to issue invoices and collect payments for all
          services rendered under this Agreement, including any approved additional work or prorated
          amounts. The Client certifies that they are an authorized user of the provided payment method
          and agrees not to dispute charges that align with the terms of this Agreement.
        </p>
        <p className="text-sm text-foreground/80 leading-relaxed mb-2">
          In the event of a failed or delayed payment, Kracked Retention reserves the right to adjust
          the payment schedule, suspend services, or modify invoice amounts as necessary to recover any
          outstanding balance.
        </p>
        <p className="text-sm text-foreground/80 leading-relaxed mb-6">
          The Client represents and warrants that they are authorized to execute this Agreement and
          payment authorization and agrees to indemnify and hold harmless Kracked Retention, its
          affiliates, the bank, and any payment processors from all claims, damages, or losses arising
          from authorized transactions made pursuant to this Agreement.
        </p>
      </>
    );
  }
  return (
    <>
      <p className="text-sm text-foreground/80 leading-relaxed mb-2">
        The Client named below acknowledges and agrees to the terms outlined in this Statement of
        Work. Both parties confirm they have the proper authority to enter into this agreement on
        behalf of their respective companies.
      </p>
      <p className="text-sm text-foreground/80 leading-relaxed mb-2">
        The Client authorizes Kracked Retention to invoice for the agreed-upon purchase and payment
        plan. The Client certifies that they are an authorized user of the provided payment method
        and will not dispute the payment, provided it aligns with the terms of this agreement.
      </p>
      <p className="text-sm text-foreground/80 leading-relaxed mb-2">
        In the event of a failed payment, the payment schedule and/or amounts may be adjusted to
        recover any outstanding balance.
      </p>
      <p className="text-sm text-foreground/80 leading-relaxed mb-6">
        The Client represents and warrants that they are authorized to execute this payment
        authorization and indemnifies Kracked Retention, the bank, and the payment processor from
        any claims, damages, or losses arising from authorized transactions under this agreement.
      </p>
    </>
  );
}

// ─── Admin inline edit components (draft preview only) ─────────────────────────

/**
 * Persist an inline edit to the proposal. Returns true only when the DB confirms it.
 *
 * `keepalive: true` is the critical bit: a blur-triggered save can start just as the
 * admin navigates away to send the proposal. Without keepalive the browser aborts the
 * in-flight request on navigation, the field never reaches the DB, and the sent proposal
 * silently falls back to its template — the "edits reverted on send" bug. keepalive tells
 * the browser to finish the request regardless. Body is tiny, well under the 64KB limit.
 */
async function persistEdit(proposalId: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/proposals/${proposalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

function InlineEditText({
  value,
  proposalId,
  field,
  multiline,
  inputClassName,
  displayClassName,
  placeholder,
  onSave,
}: {
  value: string;
  proposalId: string;
  field: string;
  multiline?: boolean;
  inputClassName?: string;
  displayClassName?: string;
  placeholder?: string;
  onSave?: (newValue: string) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  async function handleBlur() {
    setEditing(false);
    if (localValue.trim() === value.trim()) return;
    const finalValue = localValue.trim() || value;
    setSaveFailed(false);
    const ok = await persistEdit(proposalId, { [field]: finalValue });
    if (!ok) { setSaveFailed(true); return; }
    onSave?.(finalValue);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    queryClient.invalidateQueries({ queryKey: ["public-proposal"] });
  }

  if (editing) {
    if (multiline) {
      return (
        <textarea
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          autoFocus
          rows={10}
          className={cn(
            "w-full text-sm leading-relaxed font-mono border border-primary/40 rounded-[6px] px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y",
            inputClassName
          )}
        />
      );
    }
    return (
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        autoFocus
        className={cn(
          "border-b border-primary/60 bg-transparent focus:outline-none text-foreground w-full",
          inputClassName
        )}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={cn(
        "group relative cursor-text rounded-[4px] px-1 -mx-1 py-0.5 transition-all",
        "bg-amber-50/70 hover:bg-amber-50",
        displayClassName
      )}
      title="Click to edit"
    >
      {localValue || placeholder || "—"}
      <Pencil className="inline-block w-3 h-3 ml-1 text-primary/40 opacity-0 group-hover:opacity-100 transition-opacity align-middle" />
      {saved && (
        <span className="absolute -top-5 left-0 text-[10px] text-green-600 font-semibold whitespace-nowrap bg-white px-1 rounded shadow-sm">
          Saved
        </span>
      )}
      {saveFailed && (
        <span className="absolute -top-5 left-0 text-[10px] text-red-600 font-semibold whitespace-nowrap bg-white px-1.5 rounded shadow-sm">
          Not saved — click to retry
        </span>
      )}
    </span>
  );
}

function InlineEditScope({
  value,
  proposalId,
}: {
  value: string;
  proposalId: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  async function handleBlur() {
    setEditing(false);
    if (localValue === value) return;
    setSaveFailed(false);
    const ok = await persistEdit(proposalId, { serviceDescription: localValue });
    if (!ok) { setSaveFailed(true); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    queryClient.invalidateQueries({ queryKey: ["public-proposal"] });
  }

  if (editing) {
    return (
      <textarea
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        autoFocus
        rows={12}
        className="w-full text-sm leading-relaxed font-mono border border-primary/40 rounded-[6px] px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y mb-4"
        placeholder="Describe the scope of work…"
      />
    );
  }

  return (
    <div
      className="group relative cursor-text rounded-[4px] bg-amber-50/70 hover:bg-amber-50 transition-all px-1 -mx-1 py-1"
      onClick={() => setEditing(true)}
      title="Click to edit scope"
    >
      <ScopeDisplay text={localValue} />
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-white/90 rounded px-1.5 py-0.5 shadow-sm">
        <Pencil className="w-3 h-3 text-primary/60" />
        <span className="text-[10px] text-primary/60 font-medium">Edit</span>
      </div>
      {saved && (
        <span className="absolute -top-5 left-0 text-[10px] text-green-600 font-semibold whitespace-nowrap bg-white px-1 rounded shadow-sm">
          Saved
        </span>
      )}
      {saveFailed && (
        <span className="absolute -top-5 left-0 text-[10px] text-red-600 font-semibold whitespace-nowrap bg-white px-1.5 rounded shadow-sm">
          Not saved — click to retry
        </span>
      )}
    </div>
  );
}

// ─── Content-section editors (draft only, `content` present) ───────────────────
// These edit fields on the per-proposal `content` snapshot. Each writes the WHOLE content
// object back (server merges/normalizes) so a single field edit never drops the rest.

/** A rich-text (markdown) copy section: renders read-only, reveals an editor on click. */
function ContentMarkdownEditor({
  content,
  field,
  proposalId,
  clientName,
  ariaLabel,
  fillClientName = false,
}: {
  content: ProposalContent;
  field: keyof ProposalContent;
  proposalId: string;
  clientName: string;
  ariaLabel: string;
  fillClientName?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>((content[field] as string) ?? "");
  const { schedule, flush } = useAutosave(proposalId);

  // Keep local value in sync when a background refetch changes the stored copy while idle.
  useEffect(() => {
    if (!editing) setValue((content[field] as string) ?? "");
  }, [content, field, editing]);

  const rendered = fillClientName ? fillClient(value, clientName) : value;

  if (editing) {
    return (
      <div className="my-3">
        <RichTextEditor
          value={value}
          ariaLabel={ariaLabel}
          onChange={(md) => {
            setValue(md);
            schedule({ content: { ...content, [field]: md } });
          }}
        />
        <div className="mt-1.5 flex items-center justify-between">
          {fillClientName && (
            <span className="text-[11px] text-foreground/45">
              Tip: <code className="rounded bg-foreground/5 px-1">{"{{client}}"}</code> inserts the client name.
            </span>
          )}
          <button
            type="button"
            onClick={() => { flush(); setEditing(false); }}
            className="ml-auto rounded-full bg-foreground/5 px-3 py-1 text-[11px] font-semibold text-foreground/70 transition-colors duration-150 ease-out hover:bg-foreground/10"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(true); } }}
      title="Click to edit"
      className="group relative -mx-1.5 cursor-text rounded-[8px] border border-dashed border-transparent px-1.5 py-0.5 transition-colors duration-150 ease-out hover:border-[var(--color-signal,#2563EB)]/30 hover:bg-[var(--color-signal,#2563EB)]/[0.04]"
    >
      <DocMarkdown>{rendered || "_Click to add copy…_"}</DocMarkdown>
      <span className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-signal,#2563EB)] opacity-0 shadow-sm transition-opacity duration-150 ease-out group-hover:opacity-100">
        <Pencil className="h-3 w-3" /> Edit
      </span>
    </div>
  );
}

/** A single inline text field on the content object (docTitle, serviceLabel, signature.*). */
function ContentTextEditor({
  content,
  proposalId,
  getValue,
  apply,
  displayClassName,
  inputClassName,
  placeholder,
}: {
  content: ProposalContent;
  proposalId: string;
  getValue: (c: ProposalContent) => string;
  apply: (c: ProposalContent, v: string) => ProposalContent;
  displayClassName?: string;
  inputClassName?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(getValue(content));
  const { schedule, flush } = useAutosave(proposalId);

  useEffect(() => {
    if (!editing) setValue(getValue(content));
  }, [content, editing, getValue]);

  if (editing) {
    return (
      <input
        type="text"
        value={value}
        autoFocus
        onChange={(e) => { setValue(e.target.value); schedule({ content: apply(content, e.target.value) }); }}
        onBlur={() => { flush(); setEditing(false); }}
        onKeyDown={(e) => { if (e.key === "Enter") { flush(); setEditing(false); } }}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-[5px] border-b border-[var(--color-signal,#2563EB)]/60 bg-transparent text-foreground outline-none",
          inputClassName,
        )}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(true); } }}
      title="Click to edit"
      className={cn(
        "group cursor-text rounded-[4px] border border-dashed border-transparent px-1 -mx-1 py-0.5 transition-colors duration-150 ease-out hover:border-[var(--color-signal,#2563EB)]/30 hover:bg-[var(--color-signal,#2563EB)]/[0.05]",
        displayClassName,
      )}
    >
      {value || placeholder || "—"}
      <Pencil className="ml-1 inline-block h-3 w-3 align-middle text-[var(--color-signal,#2563EB)]/40 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100" />
    </span>
  );
}

/** The additional-scope pricing rows stored on `content` (label + cost, add/edit/remove). */
function ContentRatesEditor({ content, proposalId }: { content: ProposalContent; proposalId: string }) {
  const [rows, setRows] = useState<AdditionalRate[]>(content.additionalRates ?? []);
  const { schedule } = useAutosave(proposalId);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setRows(content.additionalRates ?? []);
  }, [content]);

  function commit(next: AdditionalRate[], immediate = false) {
    setRows(next);
    schedule({ content: { ...content, additionalRates: next } }, immediate);
  }

  return (
    <div className="my-4">
      <div className="overflow-hidden rounded-[8px] border border-foreground/20 text-sm">
        <div className="flex items-center justify-between bg-foreground/8 px-3 py-2">
          <span className="font-bold text-foreground">Additional Scope Pricing</span>
          <button
            type="button"
            onClick={() => commit([...rows, { item: "", cost: "" }])}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-[var(--color-signal,#2563EB)] transition-colors duration-150 ease-out hover:bg-[var(--color-signal,#2563EB)]/10"
          >
            <Plus className="h-3 w-3" strokeWidth={2.5} /> Add row
          </button>
        </div>
        {rows.map((row, idx) => (
          <div key={idx} className="group flex items-center gap-2 border-t border-foreground/10 px-3 py-1.5">
            <input
              type="text"
              value={row.item}
              placeholder="Service"
              onFocus={() => { editingRef.current = true; }}
              onBlur={() => { editingRef.current = false; }}
              onChange={(e) => commit(rows.map((r, i) => (i === idx ? { ...r, item: e.target.value } : r)))}
              className="min-w-0 flex-1 rounded-[5px] border border-transparent bg-transparent px-1.5 py-0.5 font-medium text-foreground outline-none transition-colors duration-150 ease-out hover:border-black/10 focus:border-[var(--color-signal,#2563EB)]/50 focus:bg-white"
            />
            <input
              type="text"
              value={row.cost}
              placeholder="Cost"
              onFocus={() => { editingRef.current = true; }}
              onBlur={() => { editingRef.current = false; }}
              onChange={(e) => commit(rows.map((r, i) => (i === idx ? { ...r, cost: e.target.value } : r)))}
              className="w-32 rounded-[5px] border border-transparent bg-transparent px-1.5 py-0.5 text-right text-foreground/80 outline-none transition-colors duration-150 ease-out hover:border-black/10 focus:border-[var(--color-signal,#2563EB)]/50 focus:bg-white"
            />
            <button
              type="button"
              onClick={() => commit(rows.filter((_, i) => i !== idx), true)}
              aria-label="Remove row"
              className="shrink-0 rounded p-1 text-foreground/25 opacity-0 transition-all duration-150 ease-out hover:bg-red-50 hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Read-only render of the additional-scope pricing rows from `content`. */
function ContentRatesDisplay({ rates }: { rates: AdditionalRate[] }) {
  if (!rates.length) return null;
  return (
    <div className="my-4">
      {/* Mobile */}
      <div className="mb-1 overflow-hidden rounded-[8px] border border-foreground/20 text-sm sm:hidden">
        <div className="border-b border-foreground/20 bg-foreground/5 px-4 py-2.5">
          <span className="text-xs font-bold uppercase tracking-wide text-foreground">Additional Scope Pricing</span>
        </div>
        {rates.map((row, idx) => (
          <div key={idx} className="flex items-center justify-between border-b border-foreground/10 px-4 py-2.5 last:border-0">
            <span className="font-medium text-foreground">{row.item}</span>
            <span className="text-foreground/70">{row.cost}</span>
          </div>
        ))}
      </div>
      {/* Desktop */}
      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr>
            <th className="border border-foreground/20 bg-foreground/8 px-3 py-2 text-left font-bold text-foreground">Additional Scope Pricing</th>
            <th className="w-40 border border-foreground/20 bg-foreground/8 px-3 py-2 text-right font-bold text-foreground">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((row, idx) => (
            <tr key={idx}>
              <td className="border border-foreground/20 px-3 py-2 font-medium text-foreground">{row.item}</td>
              <td className="border border-foreground/20 px-3 py-2 text-right text-foreground/80">{row.cost}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Inline numeric pricing editor: total + optional discount (list price, percent|fixed). */
function PricingEditor({ proposal }: { proposal: ProposalData }) {
  const { schedule } = useAutosave(proposal.id);
  const disc = discountInfo(proposal as BillingTerms);
  const suffix = priceSuffix(proposal as BillingTerms);

  const [total, setTotal] = useState(String(proposal.totalAmount));
  const [hasDiscount, setHasDiscount] = useState(!!disc);
  const [list, setList] = useState(String(proposal.listAmount ?? ""));
  const [dType, setDType] = useState<"percent" | "fixed">(
    proposal.discountType === "fixed" ? "fixed" : "percent",
  );
  const [dValue, setDValue] = useState(String(proposal.discountValue ?? ""));
  const editingRef = useRef(false);

  // Reconcile from the server (which recomputes) whenever we're not mid-edit.
  useEffect(() => {
    if (editingRef.current) return;
    setTotal(String(proposal.totalAmount));
    setHasDiscount(!!disc);
    setList(String(proposal.listAmount ?? ""));
    setDType(proposal.discountType === "fixed" ? "fixed" : "percent");
    setDValue(String(proposal.discountValue ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal.totalAmount, proposal.listAmount, proposal.discountType, proposal.discountValue]);

  function save(next: {
    total?: string; hasDiscount?: boolean; list?: string; dType?: "percent" | "fixed"; dValue?: string;
  }, immediate = false) {
    const t = next.total ?? total;
    const hd = next.hasDiscount ?? hasDiscount;
    const l = next.list ?? list;
    const dt = next.dType ?? dType;
    const dv = next.dValue ?? dValue;
    const totalNum = parseFloat(t);
    if (!Number.isFinite(totalNum) || totalNum <= 0) return; // let the field settle first
    const body: Record<string, unknown> = { totalAmount: totalNum };
    if (hd && l && dv) {
      body.listAmount = parseFloat(l);
      body.discountType = dt;
      body.discountValue = parseFloat(dv);
    } else {
      body.listAmount = null;
      body.discountType = null;
      body.discountValue = null;
    }
    schedule(body, immediate);
  }

  const numCls =
    "w-28 rounded-[6px] border border-black/15 bg-white px-2 py-1 text-sm tabular-nums text-foreground outline-none transition-colors duration-150 ease-out focus:border-[var(--color-signal,#2563EB)]/60";

  return (
    <div className="my-4 space-y-3 rounded-[10px] border border-dashed border-[var(--color-signal,#2563EB)]/25 bg-[var(--color-signal,#2563EB)]/[0.03] p-3" data-r10n-proposal-pricing-editor>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-foreground/60">Total</span>
        <div className="flex items-center gap-1">
          <span className="text-sm text-foreground/50">$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={total}
            onFocus={() => { editingRef.current = true; }}
            onBlur={() => { editingRef.current = false; save({}, true); }}
            onChange={(e) => { setTotal(e.target.value); save({ total: e.target.value }); }}
            className={numCls}
          />
          {suffix && <span className="text-xs text-foreground/50">{suffix}</span>}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs font-medium text-foreground/70">
        <input
          type="checkbox"
          checked={hasDiscount}
          onChange={(e) => { setHasDiscount(e.target.checked); save({ hasDiscount: e.target.checked }, true); }}
          className="h-3.5 w-3.5 accent-[var(--color-signal,#2563EB)]"
        />
        Show a discount (struck-through list price)
      </label>

      {hasDiscount && (
        <div className="flex flex-wrap items-center gap-3 pl-5">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-foreground/50">List $</span>
            <input
              type="number" min={0} step="0.01" value={list}
              onFocus={() => { editingRef.current = true; }}
              onBlur={() => { editingRef.current = false; save({}, true); }}
              onChange={(e) => { setList(e.target.value); save({ list: e.target.value }); }}
              className={numCls}
            />
          </div>
          <div className="flex items-center gap-1">
            <select
              value={dType}
              onChange={(e) => { const v = e.target.value as "percent" | "fixed"; setDType(v); save({ dType: v }, true); }}
              className="rounded-[6px] border border-black/15 bg-white px-2 py-1 text-xs text-foreground outline-none focus:border-[var(--color-signal,#2563EB)]/60"
            >
              <option value="percent">% off</option>
              <option value="fixed">$ off</option>
            </select>
            <input
              type="number" min={0} step="0.01" value={dValue}
              onFocus={() => { editingRef.current = true; }}
              onBlur={() => { editingRef.current = false; save({}, true); }}
              onChange={(e) => { setDValue(e.target.value); save({ dValue: e.target.value }); }}
              className={numCls}
            />
          </div>
        </div>
      )}
      <p className="text-[11px] text-foreground/45">
        The server validates and recomputes the discount; a discount only shows when the list price is above the total.
      </p>
    </div>
  );
}

/** Inline email editor for contactEmail (only value returned by the public payload). */
function ContentEmailEditor({ value, proposalId }: { value: string | null; proposalId: string }) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(value ?? "");
  const [invalid, setInvalid] = useState(false);
  const { schedule, flush } = useAutosave(proposalId);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  useEffect(() => { if (!editing) setEmail(value ?? ""); }, [value, editing]);

  function commitIfValid(v: string) {
    if (EMAIL_RE.test(v.trim())) { setInvalid(false); schedule({ contactEmail: v.trim() }); }
    else setInvalid(!!v.trim());
  }

  if (editing) {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <input
          type="email"
          value={email}
          autoFocus
          onChange={(e) => { setEmail(e.target.value); commitIfValid(e.target.value); }}
          onBlur={() => { flush(); setEditing(false); }}
          placeholder="client@email.com"
          className={cn(
            "rounded-[5px] border-b bg-transparent px-1 py-0.5 text-sm text-foreground outline-none",
            invalid ? "border-red-400" : "border-[var(--color-signal,#2563EB)]/60",
          )}
        />
        {invalid && <span className="text-[10px] text-red-500">Enter a valid email</span>}
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(true); } }}
      title="Click to edit"
      className="group cursor-text rounded-[4px] border border-dashed border-transparent px-1 -mx-1 py-0.5 text-sm text-foreground/80 transition-colors duration-150 ease-out hover:border-[var(--color-signal,#2563EB)]/30 hover:bg-[var(--color-signal,#2563EB)]/[0.05]"
    >
      {email || "Add client email"}
      <Pencil className="ml-1 inline-block h-3 w-3 align-middle text-[var(--color-signal,#2563EB)]/40 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100" />
    </span>
  );
}

/** Inline date editor bound to a real proposal date field (draft only). */
function ContentDateEditor({
  value,
  proposalId,
  field,
}: {
  value: string | null | undefined;
  proposalId: string;
  field: "startDate" | "endDate";
}) {
  const [local, setLocal] = useState(value ? new Date(value).toISOString().slice(0, 10) : "");
  const { schedule } = useAutosave(proposalId);
  useEffect(() => { setLocal(value ? new Date(value).toISOString().slice(0, 10) : ""); }, [value]);
  return (
    <input
      type="date"
      value={local}
      onChange={(e) => { setLocal(e.target.value); schedule({ [field]: e.target.value || null }, true); }}
      className="cursor-pointer rounded-[5px] border border-dashed border-[var(--color-signal,#2563EB)]/30 bg-[var(--color-signal,#2563EB)]/[0.04] px-1.5 py-0.5 text-inherit outline-none transition-colors duration-150 ease-out hover:border-[var(--color-signal,#2563EB)]/50 focus:border-[var(--color-signal,#2563EB)]/70"
    />
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ProposalSigningPage({ token, preview = false }: { token: string; preview?: boolean }) {
  const [signed, setSigned] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const today = format(new Date(), "MM/dd/yyyy");

  const { data, isLoading, isError } = useQuery<
    { preview?: boolean; proposal: ProposalData } | { status: string; title?: string }
  >({
    queryKey: ["public-proposal", token, preview],
    queryFn: () =>
      fetch(`/api/proposals/public/${token}${preview ? "?preview=1" : ""}`).then((r) => r.json()),
    staleTime: 60 * 1000,
    retry: false,
  });

  // Initialise signerName once proposal data arrives
  useEffect(() => {
    if (data && "proposal" in data && !signerName) {
      setSignerName((data as { proposal: ProposalData }).proposal.contactName);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const signMutation = useMutation({
    mutationFn: async (signatureDataUrl: string) => {
      const proposal = (data as { proposal: ProposalData }).proposal;
      const res = await fetch(`/api/proposals/${proposal.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: signatureDataUrl, signerName: signerName.trim() || proposal.contactName, signerTitle: signerTitle.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Failed to sign");
      return res.json() as Promise<{ hostedUrl: string | null }>;
    },
    onSuccess: ({ hostedUrl }) => {
      setSigned(true);
      if (hostedUrl) {
        setRedirecting(true);
        // Small delay so the user sees the confirmation before redirect
        setTimeout(() => { window.location.href = hostedUrl; }, 1200);
      }
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <StatusScreen
        icon={AlertTriangle}
        title="Proposal not found"
        message="This link may be invalid or has expired."
        color="red"
      />
    );
  }

  if ("status" in data && !("proposal" in data)) {
    const statusMap: Record<string, { title: string; message: string; color: "muted" | "green" | "amber" | "red"; icon: React.ElementType }> = {
      draft: { icon: Clock, title: "Not available yet", message: "This proposal isn't ready to be viewed yet.", color: "muted" },
      signed: { icon: Check, title: "Already signed", message: "This proposal has already been signed. Check your email for your invoice.", color: "green" },
      paid: { icon: Check, title: "Paid in full", message: "This proposal has been signed and paid. Thank you!", color: "green" },
      void: { icon: AlertTriangle, title: "Proposal voided", message: "This proposal is no longer active.", color: "muted" },
      failed: { icon: AlertTriangle, title: "Payment issue", message: "There was an issue with payment. Please contact us.", color: "red" },
      overdue: { icon: Clock, title: "Proposal overdue", message: "This proposal has passed its due date. Please contact us.", color: "amber" },
      // CLIENT-FACING. A paying retainer client reopening their link previously fell through to
      // the "Unavailable" fallback below, which reads like their agreement had been cancelled.
      // These are the states a client can legitimately be in after they have paid.
      active: { icon: Check, title: "Signed and active", message: "Your agreement is signed and your retainer is running. Thank you!", color: "green" },
      completed: { icon: Check, title: "Term complete", message: "This term is complete and paid in full. Thank you!", color: "green" },
      partial: { icon: Clock, title: "Payment in progress", message: "Thank you. We've received your first payment and the rest of your schedule is set up.", color: "green" },
      past_due: { icon: AlertTriangle, title: "Payment issue", message: "A scheduled payment didn't go through. Please contact us so we can sort it out.", color: "amber" },
      lost: { icon: AlertTriangle, title: "Proposal closed", message: "This proposal is no longer active.", color: "muted" },
    };
    const s = statusMap[data.status] ?? { icon: AlertTriangle, title: "Unavailable", message: "This proposal is not currently available.", color: "muted" as const };
    return <StatusScreen icon={s.icon} title={s.title} message={s.message} color={s.color} />;
  }

  if (signed) {
    const proposalData = (data && "proposal" in data) ? (data as { proposal: ProposalData }).proposal : null;
    const isDepositProposal = proposalData?.hasDeposit;
    const depositInstalments = proposalData?.instalments?.filter(i => i.isDeposit) ?? [];

    if (isDepositProposal && depositInstalments.length > 0) {
      // Deposit proposal — show deposit payment schedule instead of redirect
      const firstUnpaid = depositInstalments.find(i => i.status !== "paid");
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="max-w-md w-full">
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 bg-green-50">
                <Check className="w-7 h-7" />
              </div>
              <h1 className="text-xl font-bold text-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                Proposal signed!
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Pay your deposits to get started{billingAnchor(proposalData as BillingTerms) ? ` on ${fmtDate(billingAnchor(proposalData as BillingTerms))}` : ""}.
              </p>
            </div>

            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{fmtAmount(proposalData.depositsPaidTotal ?? 0, proposalData.currency)} paid</span>
                <span>{fmtAmount(proposalData.depositTotal ?? proposalData.totalAmount, proposalData.currency)} total</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${((proposalData.depositsPaidTotal ?? 0) / ((proposalData.depositTotal ?? proposalData.totalAmount) || 1)) * 100}%` }}
                />
              </div>
            </div>

            {/* Deposit schedule */}
            <div className="border border-border rounded-[8px] overflow-hidden mb-4">
              {depositInstalments
                .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
                .map((inst) => (
                  <div key={inst.id} className="flex items-center justify-between px-4 py-3 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Deposit {inst.instalmentNumber}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Due {fmtDate(inst.dueDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-foreground tabular-nums">
                        {fmtAmount(inst.amount, proposalData.currency)}
                      </span>
                      {inst.status === "paid" ? (
                        <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded">Paid</span>
                      ) : inst.stripeHostedUrl ? (
                        <a
                          href={inst.stripeHostedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-white bg-primary px-3 py-1 rounded-[6px] hover:bg-primary/90 transition-colors"
                        >
                          Pay Now
                        </a>
                      ) : (
                        <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded">Pending</span>
                      )}
                    </div>
                  </div>
                ))}
            </div>

            {/* First deposit CTA */}
            {firstUnpaid?.stripeHostedUrl && (
              <a
                href={firstUnpaid.stripeHostedUrl}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white text-sm font-medium rounded-[8px] hover:bg-primary/90 transition-colors"
              >
                Pay First Deposit — {fmtAmount(firstUnpaid.amount, proposalData.currency)}
              </a>
            )}

            <p className="text-[11px] text-muted-foreground text-center mt-4">
              Recurring billing starts after all deposits are collected.
            </p>
          </div>
        </div>
      );
    }

    if (redirecting) {
      return (
        <StatusScreen
          icon={Check}
          title="Taking you to payment..."
          message="Your proposal is signed. Redirecting to your invoice now."
          color="green"
        />
      );
    }
    // Signed but no Stripe redirect — payment link will be sent manually
    return (
      <StatusScreen
        icon={Check}
        title="Proposal signed!"
        message="Thank you — your signed agreement has been received. You'll receive a payment link by email shortly."
        color="green"
      />
    );
  }

  const isPreview = preview || ("preview" in data && data.preview === true);
  const { proposal } = data as { proposal: ProposalData };
  const isManagement = proposal.type === "management";
  const isDraft = isPreview && proposal.status === "draft";

  // The per-proposal copy snapshot. The public route resolves it (snapshot → template →
  // defaults) so it is present in practice; we still guard for null so an older draft, or a
  // DB hiccup, falls back to the legacy hardcoded JSX byte-for-byte (rendered below).
  const content = proposal.content ?? null;

  const body = (
    <div className="min-h-screen bg-[#f5f5f0]">
      {/* Preview banner */}
      {isPreview && (
        <div className="bg-primary text-primary-foreground px-6 py-2.5 flex items-center justify-center gap-3 text-sm font-medium print:hidden">
          <span className="px-2 py-0.5 bg-white/20 rounded text-xs font-bold tracking-wide uppercase">Preview</span>
          {isDraft ? (
            <span>Draft mode — <Pencil className="inline w-3.5 h-3.5 mx-0.5 align-middle" /> click any highlighted field to edit. Changes save automatically.</span>
          ) : (
            <span>This is how your client will see the proposal. Signing is disabled.</span>
          )}
        </div>
      )}

      {/* Proposals no longer expire — the expiry banner has been removed so a link never
          reads as "expired" and clients can always sign. */}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 lg:py-12">
        <div className="flex flex-col-reverse lg:flex-row gap-6 lg:gap-10 items-start lg:items-stretch">

          {/* ── Left: Full SOW document ── */}
          <div className="flex-1 min-w-0 bg-white shadow-sm border border-black/8 rounded-[4px] px-4 py-6 sm:px-8 sm:py-10 lg:py-12 print:shadow-none print:border-0 print:px-0">

            {/* Download PDF button — hidden in print */}
            <div className="flex justify-end mb-6 print:hidden">
              <a
                href={`/api/proposals/${proposal.id}/pdf`}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-[6px] hover:border-foreground/40 hover:text-foreground transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </a>
            </div>

            {/* Logo */}
            <div className="text-center mb-8">
              <img
                src="/kracked-logo.png"
                alt="Kracked Retention"
                className="h-12 w-auto mx-auto object-contain"
              />
            </div>

            {/* Document title — from content when present, else the legacy hardcoded string */}
            <p className="text-sm font-bold text-foreground mb-1">
              {isDraft && content ? (
                <ContentTextEditor
                  content={content}
                  proposalId={proposal.id}
                  getValue={(c) => c.docTitle}
                  apply={(c, v) => ({ ...c, docTitle: v })}
                  displayClassName="text-sm font-bold text-foreground"
                  inputClassName="text-sm font-bold text-foreground"
                  placeholder="Service Agreement and Statement of Work"
                />
              ) : content ? (
                content.docTitle
              ) : (
                "Service Agreement and Statement of Work"
              )}
            </p>
            {isDraft ? (
              <p className="text-sm text-muted-foreground mb-4">
                <InlineEditText
                  value={proposal.title}
                  proposalId={proposal.id}
                  field="title"
                  displayClassName="text-sm text-muted-foreground"
                  inputClassName="text-sm text-muted-foreground"
                  placeholder="Proposal title"
                />
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mb-4">{proposal.title}</p>
            )}

            {/* Draft-only recipient metadata. The client name flows into the intro's
                {{client}} token; contactEmail is the send-to address. */}
            {isDraft && (
              <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-[8px] border border-dashed border-[var(--color-signal,#2563EB)]/25 bg-[var(--color-signal,#2563EB)]/[0.03] px-3 py-2 text-sm print:hidden">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-wide text-foreground/50">Client</span>
                  <InlineEditText
                    value={proposal.contactName}
                    proposalId={proposal.id}
                    field="contactName"
                    displayClassName="font-semibold text-foreground"
                    inputClassName="font-semibold text-foreground"
                    placeholder="Client name"
                    onSave={(newName) => setSignerName(newName)}
                  />
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-wide text-foreground/50">Send to</span>
                  <ContentEmailEditor value={proposal.contactEmail} proposalId={proposal.id} />
                </span>
              </div>
            )}

            <DocDivider />

            {/* Opening paragraph (intro) — from content when present, else legacy JSX */}
            {content ? (
              isDraft ? (
                <div className="mb-6">
                  <ContentMarkdownEditor
                    content={content}
                    field="intro"
                    proposalId={proposal.id}
                    clientName={proposal.contactName}
                    ariaLabel="Preamble"
                    fillClientName
                  />
                </div>
              ) : (
                <DocMarkdown className="mb-6">{fillClient(content.intro, proposal.contactName)}</DocMarkdown>
              )
            ) : (
              <p className="text-sm text-foreground/80 leading-relaxed mb-6">
                This {isManagement ? "Agreement" : "agreement"} is made between Kracked Retention{" "}
                {isManagement ? '("Service Provider")' : ""} and{" "}
                {isDraft ? (
                  <InlineEditText
                    value={proposal.contactName}
                    proposalId={proposal.id}
                    field="contactName"
                    displayClassName="font-bold"
                    inputClassName="font-bold"
                    placeholder="Client name"
                    onSave={(newName) => setSignerName(newName)}
                  />
                ) : (
                  <strong>{proposal.contactName}</strong>
                )}{" "}
                (&ldquo;Client&rdquo;) and becomes effective upon the
                execution of this document or the commencement of services, whichever occurs first.
              </p>
            )}

            {/* Project Scope framing — from content.scopeIntro when present, else legacy JSX */}
            {content ? (
              isDraft ? (
                <div className="mb-1">
                  <ContentMarkdownEditor
                    content={content}
                    field="scopeIntro"
                    proposalId={proposal.id}
                    clientName={proposal.contactName}
                    ariaLabel="Scope framing"
                  />
                </div>
              ) : (
                <DocMarkdown className="mb-1">{content.scopeIntro}</DocMarkdown>
              )
            ) : (
              <>
                <p className="text-sm font-bold text-foreground mb-2">Project Scope</p>
                <p className="text-sm text-foreground/80 mb-3">
                  Kracked Retention will fully manage and deliver the following
                  {isManagement ? " services for the Client's brand" : ""}:
                </p>
              </>
            )}

            {/* Deliverables: structured editor/display when items exist; else content default
                scope (markdown) or the legacy serviceDescription/bullets fallback. */}
            {isDraft ? (
              // Legacy drafts with free-text scope and no structured deliverables keep the
              // free-text editor so nothing is stranded; everything else gets the structured
              // deliverables editor (the normal, content-backed path).
              !proposal.deliverables?.items?.length && proposal.serviceDescription ? (
                <InlineEditScope value={proposal.serviceDescription} proposalId={proposal.id} />
              ) : (
                <DeliverablesEditor deliverables={proposal.deliverables ?? null} proposalId={proposal.id} />
              )
            ) : proposal.deliverables && proposal.deliverables.items.length > 0 ? (
              <DeliverablesDisplay deliverables={proposal.deliverables} />
            ) : proposal.serviceDescription ? (
              <ScopeDisplay text={proposal.serviceDescription} />
            ) : content ? (
              <DocMarkdown>{content.defaultScope}</DocMarkdown>
            ) : (
              <ul className="text-sm text-foreground/80 leading-relaxed list-disc pl-6 mb-2 space-y-1">
                {isManagement ? (
                  <>
                    <li><strong>Email + SMS Marketing Management</strong> — Strategy, copywriting, design, and implementation of all campaigns, including campaign calendar planning, ideation, scheduling, and execution</li>
                    <li><strong>Optimization &amp; Reporting</strong> — Monthly reporting and quarterly flow deep dive presenting opportunities within your account</li>
                    <li><strong>Creative Delivery</strong> — All designs delivered within Miro for review</li>
                    <li><strong>Creative Assets</strong> — All designs available in Figma for future use</li>
                    <li><strong>Communication</strong> — Dedicated Slack channel and bi-weekly or monthly check-in calls with account strategist</li>
                  </>
                ) : (
                  <>
                    <li>Kick-off call &amp; project completion call</li>
                    <li>Strategy, copy, design, and implementation included</li>
                    <li>All designs delivered in Miro for review</li>
                    <li>All designs available in Figma for future use</li>
                  </>
                )}
              </ul>
            )}

            <DocDivider />

            {/* Pricing */}
            {isDraft && (
              <div className="mb-2 space-y-2">
                {content && (
                  <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-[var(--color-signal,#2563EB)]/25 bg-[var(--color-signal,#2563EB)]/[0.03] p-3 text-sm text-foreground/80">
                    <span className="text-xs font-bold uppercase tracking-wide text-foreground/60">Service label</span>
                    <ContentTextEditor
                      content={content}
                      proposalId={proposal.id}
                      getValue={(c) => c.serviceLabel}
                      apply={(c, v) => ({ ...c, serviceLabel: v })}
                      displayClassName="font-medium text-foreground"
                      inputClassName="font-medium text-foreground"
                      placeholder="Service label"
                    />
                  </div>
                )}
                <PricingEditor proposal={proposal} />
                {/* Dates — invoice/start date and (project) end date live on the proposal. */}
                <div className="flex flex-wrap items-center gap-4 rounded-[10px] border border-dashed border-[var(--color-signal,#2563EB)]/25 bg-[var(--color-signal,#2563EB)]/[0.03] p-3 text-sm text-foreground/80">
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-foreground/60">Invoice / Start date</span>
                    <ContentDateEditor value={proposal.startDate} proposalId={proposal.id} field="startDate" />
                  </label>
                  {!isManagement && (
                    <label className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-foreground/60">End date</span>
                      <ContentDateEditor value={proposal.endDate} proposalId={proposal.id} field="endDate" />
                    </label>
                  )}
                </div>
              </div>
            )}
            <PricingTable proposal={proposal} />

            <DocDivider />

            {/* Agreement terms. From content when present (additional-scope table + markdown
                terms); else the legacy hardcoded per-type JSX (byte-for-byte unchanged). */}
            {content ? (
              <div className="text-sm text-foreground/80 leading-relaxed">
                {isDraft ? (
                  <>
                    <ContentMarkdownEditor
                      content={content}
                      field="additionalScopeIntro"
                      proposalId={proposal.id}
                      clientName={proposal.contactName}
                      ariaLabel="Additional scope intro"
                    />
                    <ContentRatesEditor content={content} proposalId={proposal.id} />
                    <ContentMarkdownEditor
                      content={content}
                      field="terms"
                      proposalId={proposal.id}
                      clientName={proposal.contactName}
                      ariaLabel="Legal terms"
                    />
                  </>
                ) : (
                  <>
                    <DocMarkdown>{content.additionalScopeIntro}</DocMarkdown>
                    <ContentRatesDisplay rates={content.additionalRates} />
                    <DocMarkdown>{content.terms}</DocMarkdown>
                  </>
                )}
              </div>
            ) : isManagement ? (
              <ManagementTerms isDraft={isDraft} proposalId={proposal.id} savedRates={proposal.additionalRates} />
            ) : (
              <ProjectTerms isDraft={isDraft} proposalId={proposal.id} savedRates={proposal.additionalRates} />
            )}

            <DocDivider />

            {/* Acceptance section — from content when present, else legacy JSX */}
            {content ? (
              isDraft ? (
                <ContentMarkdownEditor
                  content={content}
                  field="acceptance"
                  proposalId={proposal.id}
                  clientName={proposal.contactName}
                  ariaLabel="Acceptance"
                />
              ) : (
                <DocMarkdown>{content.acceptance}</DocMarkdown>
              )
            ) : (
              <>
                <p className="text-sm font-bold text-foreground mb-3">Acceptance</p>
                <AcceptanceText isManagement={isManagement} />
              </>
            )}

            {/* Signature block */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 mt-6">
              {/* Kracked Retention side — from content.signature when present, else legacy */}
              <div>
                <p className="text-xs font-bold text-foreground mb-3">Kracked Retention</p>
                <div className="space-y-2 text-sm text-foreground/80">
                  {content ? (
                    <>
                      <p>
                        <span className="font-semibold">Company:</span>{" "}
                        {isDraft ? (
                          <ContentTextEditor
                            content={content} proposalId={proposal.id}
                            getValue={(c) => c.signature.company}
                            apply={(c, v) => ({ ...c, signature: { ...c.signature, company: v } })}
                            placeholder="Company"
                          />
                        ) : content.signature.company}
                      </p>
                      <p>
                        <span className="font-semibold">Title:</span>{" "}
                        {isDraft ? (
                          <ContentTextEditor
                            content={content} proposalId={proposal.id}
                            getValue={(c) => c.signature.title}
                            apply={(c, v) => ({ ...c, signature: { ...c.signature, title: v } })}
                            placeholder="Title"
                          />
                        ) : content.signature.title}
                      </p>
                      <p>
                        <span className="font-semibold">Full Name:</span>{" "}
                        {isDraft ? (
                          <ContentTextEditor
                            content={content} proposalId={proposal.id}
                            getValue={(c) => c.signature.name}
                            apply={(c, v) => ({ ...c, signature: { ...c.signature, name: v } })}
                            placeholder="Full name"
                          />
                        ) : content.signature.name}
                      </p>
                    </>
                  ) : (
                    <>
                      <p><span className="font-semibold">Company:</span> KRACKED RETENTION</p>
                      <p><span className="font-semibold">Title:</span> CEO</p>
                      <p><span className="font-semibold">Full Name:</span> GAGE FLESHER</p>
                    </>
                  )}
                </div>
                <div className="mt-4">
                  <p className="text-xs text-foreground/60 mb-1">Signature:</p>
                  <div className="border-b border-foreground/40 pb-4 mb-2">
                    <span
                      className="text-xl text-foreground/70 italic"
                      style={{ fontFamily: "Georgia, serif" }}
                    >
                      {content ? titleCaseName(content.signature.name) : "Gage Flesher"}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/60">Date: {today}</p>
                </div>
              </div>

              {/* Client side */}
              <div>
                <p className="text-xs font-bold text-foreground mb-3">Client</p>
                <div className="space-y-3 text-sm">
                  {/* Full Name — required fillable field */}
                  <div>
                    <p className="text-xs text-foreground/60 mb-1">
                      Full Name <span className="text-red-500">*</span>
                    </p>
                    {signed ? (
                      <p className="text-sm font-medium text-foreground px-2 py-1.5">{signerName || "—"}</p>
                    ) : (
                      <input
                        type="text"
                        value={signerName}
                        onChange={(e) => setSignerName(e.target.value)}
                        className="w-full text-sm font-medium text-foreground rounded-[4px] px-2 py-1.5 outline-none transition-all bg-amber-50/70 hover:bg-amber-50 border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                        placeholder="Enter your full legal name"
                        autoComplete="name"
                      />
                    )}
                  </div>

                  {/* Title/Role — optional */}
                  <div>
                    <p className="text-xs text-foreground/60 mb-1">Title / Role <span className="text-foreground/40">(optional)</span></p>
                    {signed ? (
                      <p className="text-sm text-foreground/70 px-2 py-1.5">{signerTitle || "—"}</p>
                    ) : (
                      <input
                        type="text"
                        value={signerTitle}
                        onChange={(e) => setSignerTitle(e.target.value)}
                        className="w-full text-sm text-foreground rounded-[4px] px-2 py-1.5 outline-none transition-all bg-amber-50/70 hover:bg-amber-50 border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                        placeholder="e.g. CEO, Founder, Director"
                        autoComplete="organization-title"
                      />
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-xs text-foreground/60 mb-1">Signature:</p>
                  <div className="border-b border-foreground/40 pb-4 mb-2 min-h-[32px]">
                    <span className="text-xs text-foreground/40 italic">
                      <span className="lg:hidden">Sign using the panel above</span>
                      <span className="hidden lg:inline">Sign using the panel on the right</span>
                    </span>
                  </div>
                  <p className="text-xs text-foreground/60">Date: {today}</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-10 pt-4 border-t border-foreground/15 text-[11px] text-foreground/40">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <span>&copy; 2026 Confidential and Proprietary</span>
                <span className="hidden sm:inline">Statement of Work</span>
                <span>Customer Service: admin@krackedretention.com</span>
              </div>
            </div>
          </div>

          {/* ── Right: Sticky action panel ── */}
          <div className="w-full lg:w-72 shrink-0 print:hidden">
            <div className="lg:sticky lg:top-[52px] space-y-3">
              <div className="bg-white border border-black/8 rounded-[8px] overflow-hidden shadow-sm">
                {/* Amount */}
                {(() => {
                  const terms = proposal as BillingTerms;
                  const disc = discountInfo(terms);
                  const mult = termMultiplier(terms);
                  return (
                    <div className="px-5 py-4 border-b border-border bg-muted/10">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                        {amountBlockLabel(terms)}
                      </p>
                      {disc && (
                        <p className="text-sm text-muted-foreground/70 line-through tabular-nums leading-none">
                          {fmtAmount(disc.listAmount, proposal.currency)}
                        </p>
                      )}
                      <p
                        className="text-2xl font-bold text-foreground"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        {fmtAmount(fullTermTotal(terms), proposal.currency)}
                      </p>
                      {disc && (
                        <p className="text-xs font-semibold text-green-700 mt-0.5">
                          You save {fmtAmount(disc.saved, proposal.currency)} ({disc.pct}% off)
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
                        {clientSentence(terms)}
                      </p>
                    </div>
                  );
                })()}

                {/* Deposit schedule */}
                {proposal.hasDeposit && (() => {
                  const depositInstalments = proposal.instalments.filter(i => i.isDeposit);
                  if (depositInstalments.length === 0) return null;
                  return (
                    <div className="px-4 py-3 border-b border-border">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        Deposit Schedule
                      </p>
                      <div className="space-y-1.5">
                        {depositInstalments
                          .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
                          .map((inst) => (
                            <div key={inst.id} className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">
                                {inst.instalmentNumber}. {fmtDate(inst.dueDate)}
                              </span>
                              <span className="text-xs font-medium text-foreground tabular-nums">
                                {fmtAmount(inst.amount, proposal.currency)}
                              </span>
                            </div>
                          ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Deposits cover the first billing cycle. Subscription starts when fully paid.
                      </p>
                    </div>
                  );
                })()}

                {/* Payment schedule */}
                {proposal.paymentStructure === "instalment" && proposal.instalments.length > 0 && (
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Payment Schedule
                    </p>
                    <div className="space-y-1.5">
                      {proposal.instalments
                        .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
                        .map((inst) => (
                          <div key={inst.id} className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              {inst.instalmentNumber}. {fmtDate(inst.dueDate)}
                            </span>
                            <span className="text-xs font-medium text-foreground tabular-nums">
                              {fmtAmount(inst.amount, proposal.currency)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* 90-Day Management payment schedule (spread) */}
                {(() => {
                  const rows = managementSchedule(proposal as BillingTerms);
                  if (!rows || rows.length === 0) return null;
                  return (
                    <div className="px-4 py-3 border-b border-border">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        Payment Schedule
                      </p>
                      <div className="space-y-1.5">
                        {rows.map((row, i) => (
                          <div key={i} className="flex items-center justify-between gap-3">
                            <span className="text-xs text-muted-foreground min-w-0 truncate">
                              {row.label} · {row.when}
                            </span>
                            <span className="text-xs font-medium text-foreground tabular-nums shrink-0">
                              {fmtAmount(row.amount, proposal.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Sign section */}
                <div className="px-4 py-4">
                  <p className="text-xs font-semibold text-foreground mb-1">
                    Sign to accept &amp; proceed to payment
                  </p>
                  <p className="text-[11px] text-muted-foreground mb-3">
                    By signing you confirm you have read and agree to the terms in this agreement.
                  </p>

                  {signMutation.isError && (
                    <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200/50 rounded-[6px]">
                      <p className="text-xs text-red-600">Signing failed. Please try again.</p>
                    </div>
                  )}

                  {isPreview ? (
                    <div className="flex items-center justify-center py-6 border-2 border-dashed border-border rounded-[6px] text-xs text-muted-foreground">
                      Signature disabled in preview mode
                    </div>
                  ) : (
                    <SignatureCanvas
                      onSign={(dataUrl) => signMutation.mutate(dataUrl)}
                      disabled={signMutation.isPending}
                      canSign={signerName.trim().length > 0}
                    />
                  )}
                </div>
              </div>

              {/* Trust signal */}
              <div className="flex items-start gap-2 px-3 py-2.5 bg-white border border-black/8 rounded-[8px]">
                <Shield className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground leading-tight">
                  Secured by 256-bit encryption. Your signature is legally binding under e-signature law.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );

  // In draft mode, wrap the whole document in the shared autosave context so every inline
  // editor reports through one calm indicator. Non-draft views render the body unchanged.
  if (isDraft) {
    return (
      <SaveProvider>
        {body}
        <SaveIndicator />
      </SaveProvider>
    );
  }
  return body;
}
