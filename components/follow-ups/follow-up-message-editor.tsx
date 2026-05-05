"use client";

import { useState } from "react";
import { Edit3 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Props {
  body: string;
  subject?: string;
  channel: string;
  onChange: (body: string, subject?: string) => void;
}

export function FollowUpMessageEditor({ body, subject, channel, onChange }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [localBody, setLocalBody] = useState(body);
  const [localSubject, setLocalSubject] = useState(subject ?? "");
  const isEmail = channel.toUpperCase() === "EMAIL";

  function commit() {
    setIsEditing(false);
    onChange(localBody, isEmail ? localSubject : undefined);
  }

  if (!isEditing) {
    return (
      <div
        onClick={() => setIsEditing(true)}
        className="group relative cursor-text rounded-[8px] border border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/30 transition-all"
      >
        {isEmail && localSubject && (
          <div className="px-3 pt-2.5 pb-1 border-b border-border/60">
            <span className="text-xs text-muted-foreground">Subject: </span>
            <span className="text-xs font-medium text-foreground">{localSubject}</span>
          </div>
        )}
        <p className="px-3 py-2.5 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {localBody}
        </p>
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="flex items-center gap-1 text-xs text-muted-foreground bg-background border border-border rounded-md px-1.5 py-0.5">
            <Edit3 className="w-3 h-3" />
            edit
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border border-primary/40 bg-background shadow-sm">
      {isEmail && (
        <input
          type="text"
          value={localSubject}
          onChange={(e) => setLocalSubject(e.target.value)}
          placeholder="Subject line…"
          className="w-full px-3 py-2 text-xs border-b border-border/60 bg-transparent text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
        />
      )}
      <textarea
        autoFocus
        value={localBody}
        onChange={(e) => setLocalBody(e.target.value)}
        rows={isEmail ? 4 : 3}
        className="w-full px-3 py-2.5 text-sm text-foreground bg-transparent resize-none focus:outline-none leading-relaxed"
      />
      <div className="flex items-center justify-end gap-2 px-3 pb-2">
        <button
          onClick={() => {
            setLocalBody(body);
            setLocalSubject(subject ?? "");
            setIsEditing(false);
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={commit}
          className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
