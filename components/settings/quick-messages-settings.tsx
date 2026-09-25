"use client";

import { useState } from "react";
import { Zap, Plus, Trash2, Pencil, ArrowUp, ArrowDown, Check, X, Loader2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useQuickMessages,
  useCreateQuickMessage,
  useUpdateQuickMessage,
  useDeleteQuickMessage,
  useReorderQuickMessages,
  type QuickMessage,
} from "@/lib/hooks/use-quick-messages";

const CHAT_LIMIT = 5;

export function QuickMessagesSettings() {
  const { data, isLoading } = useQuickMessages();
  const create = useCreateQuickMessage();
  const reorder = useReorderQuickMessages();

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const all = data?.quickMessages ?? [];
  // The first CHAT_LIMIT *active* messages (in order) are the ones shown in the composer.
  const shownIds = new Set(all.filter((q) => q.active).slice(0, CHAT_LIMIT).map((q) => q.id));

  function saveNew() {
    if (!newBody.trim() || create.isPending) return;
    create.mutate(
      { title: newTitle.trim() || undefined, body: newBody.trim() },
      {
        onSuccess: () => {
          setNewTitle("");
          setNewBody("");
          setAdding(false);
        },
      },
    );
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...all];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next.map((q) => q.id));
  }

  return (
    <div className="bg-card border border-border rounded-[10px] p-5" data-r10n-settings-card>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-muted-foreground" data-r10n-settings-cardicon />
          <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }} data-r10n-settings-cardtitle>
            Quick Messages
          </h2>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            data-r10n-quickmsg-save
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-colors active:scale-[0.97]"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Canned replies your team can drop into the inbox. The first {CHAT_LIMIT} active ones (top of the list) show in the composer.
      </p>

      {/* Add form */}
      {adding && (
        <div className="mb-4 rounded-[10px] border border-border bg-background p-3">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Label (optional)"
            className="mb-2 w-full rounded-[7px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all"
          />
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Type the message…"
            className="w-full resize-none rounded-[7px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all leading-relaxed"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={saveNew}
              disabled={!newBody.trim() || create.isPending}
              data-r10n-quickmsg-save
              className="flex items-center gap-1.5 px-4 py-2 rounded-[7px] text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98]"
            >
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </button>
            <button
              onClick={() => { setAdding(false); setNewTitle(""); setNewBody(""); }}
              className="px-4 py-2 rounded-[7px] text-sm font-semibold border border-border text-foreground hover:bg-muted transition-colors active:scale-[0.98]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : all.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No quick messages yet. Add your first one above.</p>
      ) : (
        <div className="rounded-[10px] border border-border overflow-hidden divide-y divide-border">
          {all.map((q, i) => (
            <QuickMessageRow
              key={q.id}
              q={q}
              index={i}
              total={all.length}
              inChat={shownIds.has(q.id)}
              editing={editingId === q.id}
              onEdit={() => setEditingId(q.id)}
              onCloseEdit={() => setEditingId(null)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              reordering={reorder.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QuickMessageRow({
  q, index, total, inChat, editing, onEdit, onCloseEdit, onMoveUp, onMoveDown, reordering,
}: {
  q: QuickMessage;
  index: number;
  total: number;
  inChat: boolean;
  editing: boolean;
  onEdit: () => void;
  onCloseEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  reordering: boolean;
}) {
  const update = useUpdateQuickMessage();
  const del = useDeleteQuickMessage();
  const [title, setTitle] = useState(q.title ?? "");
  const [body, setBody] = useState(q.body);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function saveEdit() {
    if (!body.trim() || update.isPending) return;
    update.mutate(
      { id: q.id, title: title.trim(), body: body.trim() },
      { onSuccess: onCloseEdit },
    );
  }

  if (editing) {
    return (
      <div className="p-3 bg-muted/20">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Label (optional)"
          className="mb-2 w-full rounded-[7px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-[7px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all leading-relaxed"
        />
        {(update.isError || del.isError) && (
          <p className="mt-1 text-xs text-destructive">Couldn&apos;t save. It may have been deleted — refresh and try again.</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={saveEdit}
            disabled={!body.trim() || update.isPending}
            data-r10n-quickmsg-save
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-[7px] text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98]"
          >
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </button>
          <button
            onClick={() => { setTitle(q.title ?? ""); setBody(q.body); onCloseEdit(); }}
            className="px-4 py-1.5 rounded-[7px] text-sm font-semibold border border-border text-foreground hover:bg-muted transition-colors active:scale-[0.98]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3 px-3 py-2.5", !q.active && "opacity-55")}>
      {/* Reorder */}
      <div className="flex flex-col shrink-0 text-muted-foreground">
        <button onClick={onMoveUp} disabled={index === 0 || reordering} title="Move up" className="hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button onClick={onMoveDown} disabled={index === total - 1 || reordering} title="Move down" className="hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
      </div>
      <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" aria-hidden />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {q.title && <span className="text-sm font-medium text-foreground truncate">{q.title}</span>}
          {inChat && q.active && (
            <span data-r10n-quickmsg-badge className="shrink-0 rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-semibold">
              In chat
            </span>
          )}
        </div>
        <p className={cn("text-xs text-muted-foreground truncate leading-snug", !q.title && "text-foreground")}>{q.body}</p>
      </div>

      {/* Active toggle — same pattern as other Settings toggles */}
      <button
        onClick={() => update.mutate({ id: q.id, active: !q.active })}
        disabled={update.isPending}
        title={q.active ? "Active — click to hide from chat" : "Inactive — click to show in chat"}
        aria-pressed={q.active}
        style={{ WebkitAppearance: "none" }}
        data-r10n-settings-toggle
        data-state={q.active ? "on" : "off"}
        className={cn(
          "relative inline-flex items-center w-9 h-5 rounded-full transition-colors shrink-0 cursor-pointer border-0 p-0",
          q.active ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span className={cn("inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200", q.active ? "translate-x-[18px]" : "translate-x-[3px]")} />
      </button>

      {/* Actions */}
      <button onClick={onEdit} title="Edit" className="shrink-0 p-1.5 rounded-[7px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      {confirmDelete ? (
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => del.mutate(q.id)} title="Confirm delete" className="p-1.5 rounded-[7px] text-white bg-destructive hover:bg-destructive/90 transition-colors">
            {del.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setConfirmDelete(false)} title="Cancel" className="p-1.5 rounded-[7px] text-muted-foreground hover:bg-muted transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirmDelete(true)} title="Delete" className="shrink-0 p-1.5 rounded-[7px] text-muted-foreground hover:text-destructive hover:bg-destructive/[0.08] transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
