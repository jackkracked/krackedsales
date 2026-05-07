"use client";

import React, { useState, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import {
  Send,
  RefreshCw,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link2,
  Minus,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
// Minimal message shape — compatible with both the global GHLMessage type
// and the local interfaces defined in each modal.
interface MessageLike {
  id?: string;
  body?: string;
  messageType?: string;
  meta?: { email?: { subject?: string } };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Channel = "SMS" | "EMAIL" | "FB" | "IG";

interface MessageComposerProps {
  conversationId: string;
  contactId: string;
  messages: MessageLike[];
  onSent?: () => void;
}

// ─── Helper functions ─────────────────────────────────────────────────────────

function detectChannel(messages: MessageLike[]): Channel {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.messageType?.startsWith("TYPE_ACTIVITY")) continue;
    if (!m.body?.trim()) continue;
    if (m.messageType === "TYPE_EMAIL") return "EMAIL";
    if (m.messageType === "TYPE_FB") return "FB";
    if (m.messageType === "TYPE_INSTAGRAM") return "IG";
    return "SMS";
  }
  return "SMS";
}

function getLastEmailSubject(messages: MessageLike[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.messageType === "TYPE_EMAIL") {
      return m.meta?.email?.subject ?? "";
    }
  }
  return "";
}

function smsSegments(text: string): { chars: number; segments: number } {
  const chars = text.length;
  if (chars === 0) return { chars: 0, segments: 0 };
  if (chars <= 160) return { chars, segments: 1 };
  const segments = 1 + Math.ceil((chars - 160) / 153);
  return { chars, segments };
}

// ─── Small internal components ────────────────────────────────────────────────

function SendButton({
  sending,
  disabled,
  onClick,
}: {
  sending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || sending}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
    >
      {sending ? (
        <RefreshCw className="w-3 h-3 animate-spin" />
      ) : (
        <Send className="w-3 h-3" />
      )}
      Send
    </button>
  );
}

function ToolbarButton({
  icon: Icon,
  onClick,
  active,
  title,
}: {
  icon: React.ElementType;
  onClick: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "p-1.5 rounded-[5px] transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function MessageComposer({
  conversationId,
  contactId,
  messages,
  onSent,
}: MessageComposerProps) {
  const [channel, setChannel] = useState<Channel>(() => detectChannel(messages));
  const [smsDraft, setSmsDraft] = useState("");
  const [fbDraft, setFbDraft] = useState("");
  const [subject, setSubject] = useState(() => {
    const last = getLastEmailSubject(messages);
    return last ? `Re: ${last}` : "";
  });
  const [subjectOpen, setSubjectOpen] = useState(
    () => !getLastEmailSubject(messages)
  );
  const [ccOpen, setCcOpen] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
    ],
    editorProps: {
      attributes: {
        class:
          "min-h-[90px] max-h-[200px] overflow-y-auto px-3.5 py-2.5 text-sm focus:outline-none",
      },
    },
  });

  // Cmd/Ctrl+Enter to send when in Email mode
  useEffect(() => {
    if (channel !== "EMAIL") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, sending, subject, cc, bcc]);

  async function handleSend() {
    if (sending || channel === "IG") return;
    const body =
      channel === "EMAIL"
        ? (editor?.getHTML() ?? "")
        : channel === "SMS"
        ? smsDraft
        : fbDraft;
    if (!body.trim() || body === "<p></p>") return;
    setSending(true);
    setError(null);
    try {
      const payload: Record<string, string> = {
        message:
          channel === "EMAIL" ? (editor?.getText() ?? "") : body,
        type:
          channel === "SMS"
            ? "TYPE_SMS"
            : channel === "EMAIL"
            ? "TYPE_EMAIL"
            : "TYPE_FB",
        contactId,
      };
      if (channel === "EMAIL") {
        payload.subject = subject;
        if (cc.trim()) payload.cc = cc.trim();
        if (bcc.trim()) payload.bcc = bcc.trim();
        payload.html = editor?.getHTML() ?? "";
      }
      const res = await fetch(
        `/api/ghl/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to send");
      }
      if (channel === "SMS") setSmsDraft("");
      else if (channel === "FB") setFbDraft("");
      else editor?.commands.clearContent();
      setError(null);
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send. Try again.");
    } finally {
      setSending(false);
    }
  }

  const channelDefs: { key: Channel; label: string }[] = [
    { key: "SMS", label: "SMS" },
    { key: "EMAIL", label: "Email" },
    { key: "FB", label: "Facebook" },
    { key: "IG", label: "Instagram" },
  ];

  const { chars, segments } = smsSegments(smsDraft);

  return (
    <div className="shrink-0 border-t border-border bg-card">
      {/* ── Channel pills ───────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        {channelDefs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setChannel(key)}
            className={cn(
              channel === key
                ? "bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium"
                : "border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              key === "IG" && channel !== "IG" && "opacity-40"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Instagram warning ───────────────────────────────────────── */}
      {channel === "IG" && (
        <div className="mx-4 mb-3 px-3 py-2.5 rounded-[8px] bg-amber-50 border border-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-snug">
            Instagram replies aren&apos;t set up yet. Use SMS or Email to reach
            this contact.
          </p>
        </div>
      )}

      {/* ── SMS mode ────────────────────────────────────────────────── */}
      {channel === "SMS" && (
        <div className="px-4 pb-4">
          <div className="border border-border rounded-[10px] overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all">
            <textarea
              value={smsDraft}
              onChange={(e) => setSmsDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={3}
              placeholder="Type a message…"
              className="w-full px-3.5 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none"
            />
            <div className="flex items-center justify-between px-3.5 pb-2.5">
              <span className="text-[11px] text-muted-foreground/40">
                ⌘↵ to send
              </span>
              <div className="flex items-center gap-2">
                {chars > 0 && (
                  <span className="text-[11px] text-muted-foreground/50">
                    {chars} / 160
                    {segments > 1 && ` · ${segments} SMS`}
                  </span>
                )}
                <SendButton
                  sending={sending}
                  disabled={!smsDraft.trim()}
                  onClick={handleSend}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Facebook mode ───────────────────────────────────────────── */}
      {channel === "FB" && (
        <div className="px-4 pb-4">
          <div className="border border-border rounded-[10px] overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all">
            <textarea
              value={fbDraft}
              onChange={(e) => setFbDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={3}
              placeholder="Type a Facebook message…"
              className="w-full px-3.5 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none"
            />
            <div className="flex items-center justify-between px-3.5 pb-2.5">
              <span className="text-[11px] text-muted-foreground/40">
                ⌘↵ to send
              </span>
              <SendButton
                sending={sending}
                disabled={!fbDraft.trim()}
                onClick={handleSend}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Email mode ──────────────────────────────────────────────── */}
      {channel === "EMAIL" && (
        <div className="px-4 pb-4">
          {/* Unified bordered box: subject + cc + toolbar + editor + bottom bar */}
          <div className="border border-border rounded-[10px] overflow-hidden">
            {/* Subject row */}
            <div className="border-b border-border">
              {subjectOpen ? (
                <div className="flex items-center gap-2 px-3.5 py-2">
                  <span className="text-[11px] text-muted-foreground/60 shrink-0 w-14">
                    Subject
                  </span>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject…"
                    className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                  />
                  <button
                    onClick={() => setSubjectOpen(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3.5 py-2">
                  <span className="text-[11px] text-muted-foreground/60 shrink-0 w-14">
                    Subject
                  </span>
                  <span className="flex-1 text-sm text-foreground truncate">
                    {subject || (
                      <span className="text-muted-foreground/40">
                        No subject
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => setSubjectOpen(true)}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* CC / BCC row */}
            <div className="border-b border-border">
              {ccOpen ? (
                <div className="flex flex-col divide-y divide-border/60">
                  <div className="flex items-center gap-2 px-3.5 py-2">
                    <span className="text-[11px] text-muted-foreground/60 shrink-0 w-14">
                      CC
                    </span>
                    <input
                      type="text"
                      value={cc}
                      onChange={(e) => setCc(e.target.value)}
                      placeholder="cc@example.com"
                      className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                    />
                    <button
                      onClick={() => setCcOpen(false)}
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 px-3.5 py-2">
                    <span className="text-[11px] text-muted-foreground/60 shrink-0 w-14">
                      BCC
                    </span>
                    <input
                      type="text"
                      value={bcc}
                      onChange={(e) => setBcc(e.target.value)}
                      placeholder="bcc@example.com"
                      className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="px-3.5 py-2">
                  <button
                    onClick={() => setCcOpen(true)}
                    className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    CC · BCC
                  </button>
                </div>
              )}
            </div>

            {/* Rich text toolbar */}
            <div className="bg-muted/30 border-b border-border px-2 py-1.5 flex items-center gap-0.5">
              {/* Group 1: Bold, Italic, Underline */}
              <ToolbarButton
                icon={Bold}
                title="Bold"
                active={editor?.isActive("bold")}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              />
              <ToolbarButton
                icon={Italic}
                title="Italic"
                active={editor?.isActive("italic")}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              />
              <ToolbarButton
                icon={UnderlineIcon}
                title="Underline"
                active={editor?.isActive("underline")}
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
              />

              <div className="w-px h-4 bg-border/60 mx-1" />

              {/* Group 2: Bullet list, Ordered list */}
              <ToolbarButton
                icon={List}
                title="Bullet list"
                active={editor?.isActive("bulletList")}
                onClick={() =>
                  editor?.chain().focus().toggleBulletList().run()
                }
              />
              <ToolbarButton
                icon={ListOrdered}
                title="Ordered list"
                active={editor?.isActive("orderedList")}
                onClick={() =>
                  editor?.chain().focus().toggleOrderedList().run()
                }
              />

              <div className="w-px h-4 bg-border/60 mx-1" />

              {/* Group 3: Link, Horizontal rule */}
              <ToolbarButton
                icon={Link2}
                title="Insert link"
                active={editor?.isActive("link")}
                onClick={() => {
                  const url = window.prompt("Enter URL");
                  if (url) {
                    editor
                      ?.chain()
                      .focus()
                      .setLink({ href: url })
                      .run();
                  }
                }}
              />
              <ToolbarButton
                icon={Minus}
                title="Horizontal rule"
                onClick={() =>
                  editor?.chain().focus().setHorizontalRule().run()
                }
              />
            </div>

            {/* TipTap editor */}
            <div
              onClick={() => editor?.commands.focus()}
              className="cursor-text"
            >
              <EditorContent editor={editor} />
            </div>

            {/* ProseMirror prose styles */}
            <style>{`
              .ProseMirror p { margin: 0; }
              .ProseMirror ul { list-style: disc; padding-left: 1.25rem; }
              .ProseMirror ol { list-style: decimal; padding-left: 1.25rem; }
              .ProseMirror a { color: var(--primary); text-decoration: underline; }
            `}</style>

            {/* Bottom bar */}
            <div className="border-t border-border bg-muted/20 flex items-center justify-between px-3.5 py-2">
              <span className="text-[11px] text-muted-foreground/40">
                ⌘↵ to send
              </span>
              <SendButton
                sending={sending}
                disabled={
                  !editor?.getText().trim() ||
                  editor?.getHTML() === "<p></p>"
                }
                onClick={handleSend}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Error message ───────────────────────────────────────────── */}
      {error && (
        <div className="px-4 pb-3">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}

export { MessageComposer };
