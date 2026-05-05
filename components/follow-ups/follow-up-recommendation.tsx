"use client";

import { useState } from "react";
import { Send, RefreshCw, SkipForward, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { FollowUpMessageEditor } from "./follow-up-message-editor";
import { FollowUpSequenceReview } from "./follow-up-sequence-review";

interface Message {
  subject?: string;
  body: string;
  channel: string;
  delayDays: number;
  angle: string;
}

interface Recommendation {
  id: string;
  type: string;
  reasoning: string;
  messages: Message[];
  status: string;
}

interface Props {
  recommendation: Recommendation;
  contactId: string;
  oppId: string;
  stageName: string;
  daysSince: number;
  contactName: string;
  website: string | null;
  channel: string;
  conversationId: string | null;
  onSent: () => void;
  onSkipped: () => void;
  onRemoved: () => void;
  onRegenerate: (newRec: Recommendation) => void;
}

export function FollowUpRecommendation({
  recommendation,
  contactId,
  oppId,
  stageName,
  daysSince,
  contactName,
  website,
  channel,
  conversationId,
  onSent,
  onSkipped,
  onRemoved,
  onRegenerate,
}: Props) {
  const [messages, setMessages] = useState<Message[]>(
    Array.isArray(recommendation.messages) ? recommendation.messages : []
  );
  const [sendStatus, setSendStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [regenerating, setRegenerating] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const isSingle = recommendation.type === "single" || messages.length === 1;
  const firstMsg = messages[0];

  async function handleSend() {
    if (!firstMsg) return;
    setSendStatus("sending");
    try {
      const res = await fetch(`/api/follow-ups/${contactId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oppId,
          messageText: firstMsg.body,
          channel: firstMsg.channel || channel,
          angle: firstMsg.angle,
          subject: firstMsg.subject,
          stageName,
          recommendationId: recommendation.id,
          conversationId,
        }),
      });
      if (!res.ok) throw new Error();
      setSendStatus("sent");
      setTimeout(onSent, 800);
    } catch {
      setSendStatus("error");
    }
  }

  async function handleApproveSequence() {
    if (messages.length === 0) return;
    setSendStatus("sending");
    try {
      // Send the first message immediately; the rest are scheduled
      const firstRes = await fetch(`/api/follow-ups/${contactId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oppId,
          messageText: messages[0].body,
          channel: messages[0].channel || channel,
          angle: messages[0].angle,
          subject: messages[0].subject,
          stageName,
          recommendationId: recommendation.id,
          conversationId,
        }),
      });
      if (!firstRes.ok) throw new Error();
      setSendStatus("sent");
      setTimeout(onSent, 800);
    } catch {
      setSendStatus("error");
    }
  }

  async function handleSkip() {
    setSkipping(true);
    try {
      await fetch(`/api/follow-ups/${contactId}/skip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oppId }),
      });
      onSkipped();
    } catch {
      setSkipping(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/follow-ups/${contactId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oppId,
          stageName,
          daysSince,
          contactName,
          website,
          channel,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.recommendation) {
        const newRec = data.recommendation;
        setMessages(
          Array.isArray(newRec.messages) ? newRec.messages : []
        );
        onRegenerate(newRec);
      }
    } catch {
      // non-fatal
    } finally {
      setRegenerating(false);
    }
  }

  if (sendStatus === "sent") {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-[10px] bg-green-50 border border-green-200">
        <svg
          className="w-4 h-4 text-green-600 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <p className="text-sm text-green-800 font-medium">Message sent</p>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-border bg-muted/10 overflow-hidden">
      {/* Reasoning */}
      <div className="px-4 pt-3.5 pb-3 border-b border-border/60">
        <div className="flex items-center gap-1.5 mb-2">
          <svg
            className="w-3.5 h-3.5 text-primary shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
            />
          </svg>
          <span className="text-xs font-semibold text-foreground">
            {isSingle ? "Sending a single message" : `Recommending a ${messages.length}-message sequence`}
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {recommendation.reasoning}
        </p>
      </div>

      {/* Message(s) */}
      <div className="px-4 py-3">
        {isSingle && firstMsg ? (
          <FollowUpMessageEditor
            body={firstMsg.body}
            subject={firstMsg.subject}
            channel={firstMsg.channel || channel}
            onChange={(body, subject) =>
              setMessages([{ ...firstMsg, body, subject: subject ?? firstMsg.subject }])
            }
          />
        ) : (
          <FollowUpSequenceReview messages={messages} onChange={setMessages} />
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-3.5 flex items-center gap-2 flex-wrap">
        {isSingle ? (
          <button
            onClick={handleSend}
            disabled={sendStatus === "sending" || !firstMsg}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-[8px] transition-colors",
              sendStatus === "sending"
                ? "opacity-60 cursor-not-allowed"
                : "hover:bg-primary/90"
            )}
          >
            <Send className="w-3 h-3" />
            {sendStatus === "sending" ? "Sending…" : "Send Now"}
          </button>
        ) : (
          <button
            onClick={handleApproveSequence}
            disabled={sendStatus === "sending"}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-[8px] transition-colors",
              sendStatus === "sending"
                ? "opacity-60 cursor-not-allowed"
                : "hover:bg-primary/90"
            )}
          >
            <Send className="w-3 h-3" />
            {sendStatus === "sending" ? "Sending…" : "Approve & Send First"}
          </button>
        )}

        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[8px] hover:border-primary/30 hover:text-foreground transition-colors"
        >
          <RefreshCw className={cn("w-3 h-3", regenerating && "animate-spin")} />
          {regenerating ? "Thinking…" : "Different angle"}
        </button>

        <button
          onClick={handleSkip}
          disabled={skipping}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[8px] hover:border-primary/30 hover:text-foreground transition-colors"
        >
          <SkipForward className="w-3 h-3" />
          Skip today
        </button>

        <button
          onClick={onRemoved}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground/50 hover:text-destructive transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Remove
        </button>
      </div>

      {sendStatus === "error" && (
        <p className="text-xs text-destructive px-4 pb-3 -mt-1">
          Failed to send. Check your GHL connection and try again.
        </p>
      )}
    </div>
  );
}
