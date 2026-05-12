"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils/cn";
import { useCopilotContext } from "@/lib/copilot/context";
import { X, Send, ArrowUpRight, Sparkles } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

// ── Persistence ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "copilot-messages-v3";
const MAX_STORED = 20;

function loadMessages(): Message[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") ?? []; } catch { return []; }
}
function saveMessages(msgs: Message[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_STORED))); } catch {}
}

// ── Quick prompts ──────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  "What's in the pipeline?",
  "Demos in progress?",
  "Who needs a follow-up?",
  "Find a lead",
];

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-[3px] h-4 px-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[5px] h-[5px] rounded-full bg-muted-foreground/40"
          style={{
            animation: "copilot-dot 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </span>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onNavigate,
}: {
  message: Message;
  onNavigate: (href: string) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] px-3.5 py-2 bg-primary text-primary-foreground rounded-[10px] rounded-br-[3px] text-[13px] leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-2">
      {/* K avatar */}
      <div className="w-5 h-5 rounded-[4px] bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <span
          className="text-primary font-black leading-none"
          style={{ fontFamily: "var(--font-heading)", fontSize: 11, letterSpacing: "-0.04em" }}
        >
          K
        </span>
      </div>
      <div className="flex-1 min-w-0">
        {message.streaming && !message.content ? (
          <TypingDots />
        ) : (
          <div className="text-[13px] leading-relaxed text-foreground copilot-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <button
                    onClick={() => href && onNavigate(href)}
                    className="inline-flex items-center gap-0.5 text-primary font-medium underline underline-offset-2 decoration-dotted hover:no-underline transition-all"
                  >
                    {children}
                    {href?.startsWith("/") && <ArrowUpRight className="w-3 h-3 opacity-50" />}
                  </button>
                ),
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="mb-2 last:mb-0 space-y-0.5 pl-4 list-disc marker:text-muted-foreground/60">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 last:mb-0 space-y-0.5 pl-4 list-decimal marker:text-muted-foreground/60">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                code: ({ children }) => (
                  <code className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono text-foreground/80">
                    {children}
                  </code>
                ),
                h1: ({ children }) => <h1 className="text-sm font-semibold text-foreground mb-1.5 mt-2 first:mt-0">{children}</h1>,
                h2: ({ children }) => <h2 className="text-[13px] font-semibold text-foreground mb-1 mt-2 first:mt-0">{children}</h2>,
                h3: ({ children }) => <h3 className="text-[12px] font-semibold text-foreground/90 mb-0.5 mt-1.5 first:mt-0">{children}</h3>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CopilotFAB() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { context } = useCopilotContext();
  const router = useRouter();

  useEffect(() => { setMessages(loadMessages()); }, []);
  useEffect(() => { if (messages.length > 0) saveMessages(messages); }, [messages]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 60); }, [open]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === "Escape" && open) setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleNavigate = useCallback((href: string) => {
    if (href.startsWith("/")) { router.push(href); setOpen(false); }
    else window.open(href, "_blank");
  }, [router]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setInput("");

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: trimmed };
    const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: "assistant", content: "", streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
          context,
        }),
      });

      if (!res.ok) throw new Error("Request failed");
      if (!res.body) throw new Error("No body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk, streaming: false }];
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { ...prev[prev.length - 1], content: "Something went wrong — try again.", streaming: false },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  const pageLabel = context.entityName
    ? `${context.pageTitle} · ${context.entityName}`
    : context.pageTitle;

  return (
    <>
      <style>{`
        @keyframes copilot-dot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        @keyframes copilot-glow {
          0%, 100% { box-shadow: 0 0 0 0 var(--primary-glow, oklch(55% 0.18 260 / 0)), 0 4px 14px oklch(0% 0 0 / 0.18); }
          50% { box-shadow: 0 0 0 5px var(--primary-glow, oklch(55% 0.18 260 / 0.15)), 0 4px 14px oklch(0% 0 0 / 0.18); }
        }
        @keyframes copilot-in {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-[80px] right-6 z-50 flex flex-col bg-card border border-border overflow-hidden"
          style={{
            width: 420,
            maxHeight: "72vh",
            minHeight: 360,
            borderRadius: 12,
            boxShadow: "0 20px 50px oklch(0% 0 0 / 0.14), 0 4px 12px oklch(0% 0 0 / 0.08)",
            animation: "copilot-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both",
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
            <div className="w-5 h-5 rounded-[5px] bg-primary flex items-center justify-center shrink-0">
              <span
                className="text-primary-foreground font-black leading-none"
                style={{ fontFamily: "var(--font-heading)", fontSize: 11, letterSpacing: "-0.04em" }}
              >
                K
              </span>
            </div>
            <span
              className="text-[13px] font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Co-pilot
            </span>
            <span className="text-[11px] text-muted-foreground truncate ml-0.5">{pageLabel}</span>
            <button
              onClick={() => setOpen(false)}
              className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 pb-4">
                <div className="w-10 h-10 rounded-[8px] bg-primary/8 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground text-center">What can I help with?</p>
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} onNavigate={handleNavigate} />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick prompts */}
          {messages.length === 0 && (
            <div className="px-4 pb-3 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => sendMessage(p)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/[0.04] transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 shrink-0 border-t border-border pt-3">
            <div className="flex items-center gap-2 rounded-[8px] border border-border bg-background px-3 py-2 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything…"
                rows={1}
                disabled={isStreaming}
                className="flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none leading-relaxed"
                style={{ maxHeight: 80 }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isStreaming}
                className={cn(
                  "shrink-0 w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors",
                  input.trim() && !isStreaming
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-center">⌘K to toggle · Enter to send</p>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center rounded-full bg-primary text-primary-foreground transition-all duration-200 hover:bg-primary/90 active:scale-95"
        style={{
          width: 48,
          height: 48,
          animation: !open ? "copilot-glow 3s ease-in-out infinite" : "none",
          boxShadow: "0 4px 14px oklch(0% 0 0 / 0.18)",
          transform: open ? "scale(0.94)" : "scale(1)",
        }}
        aria-label="AI Co-pilot (⌘K)"
        title="AI Co-pilot (⌘K)"
      >
        {open ? (
          <X className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
        ) : (
          <span
            className="font-black leading-none"
            style={{ fontFamily: "var(--font-heading)", fontSize: 20, letterSpacing: "-0.04em" }}
          >
            K
          </span>
        )}
      </button>
    </>
  );
}
