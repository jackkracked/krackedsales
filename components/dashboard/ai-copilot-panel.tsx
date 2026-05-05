"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { Send, Bot, RefreshCw } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STARTER_MESSAGE: Message = {
  role: "assistant",
  content: "Hi! I'm your AI sales assistant. I can help you analyse your pipeline, find follow-up opportunities, and give you data-driven insights. What would you like to know?",
};

const QUICK_PROMPTS = [
  "How many demos are overdue?",
  "Who should I follow up with today?",
  "What's my busiest lead day this week?",
];

export function AiCopilotPanel({ salesContext }: { salesContext: string }) {
  const [messages, setMessages] = useState<Message[]>([STARTER_MESSAGE]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || isStreaming) return;

    const userMessage: Message = { role: "user", content: text.trim() };
    const updatedHistory = [...messages, userMessage];
    setMessages(updatedHistory);
    setInput("");
    setIsStreaming(true);

    // Add empty assistant message for streaming
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMessage: text.trim(),
          conversationHistory: messages
            .filter((m) => m.role !== "assistant" || m.content !== STARTER_MESSAGE.content)
            .map((m) => ({ role: m.role === "assistant" ? "model" : "user", text: m.content })),
          salesContext,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to generate response");
      }

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: `Sorry — ${message}. Try again in a moment.` },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-[10px] flex flex-col h-full min-h-[300px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <Bot className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          AI Sales Copilot
        </h3>
        {isStreaming && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] px-3 py-2 rounded-[8px] text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              )}
            >
              {msg.content || (isStreaming && i === messages.length - 1 ? (
                <span className="inline-flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse" style={{ animationDelay: "0ms", animationDuration: "1.2s" }} />
                  <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse" style={{ animationDelay: "200ms", animationDuration: "1.2s" }} />
                  <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse" style={{ animationDelay: "400ms", animationDuration: "1.2s" }} />
                </span>
              ) : "")}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => sendMessage(p)}
              className="text-xs px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-4 shrink-0">
        <div className="flex items-center gap-2 border border-border rounded-[7px] bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-colors">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
            placeholder="Ask anything about your sales…"
            className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
            disabled={isStreaming}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isStreaming}
            className={cn(
              "p-1 rounded transition-colors",
              input.trim() && !isStreaming
                ? "text-primary hover:text-primary/80"
                : "text-muted-foreground cursor-not-allowed"
            )}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
