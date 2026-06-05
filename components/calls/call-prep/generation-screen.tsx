"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  User,
  Globe,
  History,
  Sparkles,
  Check,
  AlertCircle,
} from "lucide-react";
import type { GenerationStep } from "@/lib/call-prep/types";

const STEP_ICONS = {
  contact: User,
  website: Globe,
  history: History,
  generating: Sparkles,
} as const;

interface GenerationScreenProps {
  steps: GenerationStep[];
  contactName: string;
  callType: "intro" | "follow_up";
}

export function GenerationScreen({
  steps,
  contactName,
  callType,
}: GenerationScreenProps) {
  // Stagger the entrance of each step for visual rhythm
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (visibleCount < steps.length) {
      const timer = setTimeout(() => setVisibleCount((c) => c + 1), 120);
      return () => clearTimeout(timer);
    }
  }, [visibleCount, steps.length]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[480px] px-8 py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 mb-4">
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full",
              callType === "intro"
                ? "bg-gold/15 text-gold-foreground"
                : "bg-primary/10 text-primary"
            )}
          >
            {callType === "intro" ? "Intro Call" : "Follow-up"}
          </span>
        </div>
        <h2
          className="text-xl font-bold text-foreground mb-1.5"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Preparing your brief
        </h2>
        <p className="text-sm text-muted-foreground">
          {contactName}
        </p>
      </div>

      {/* Step tracker */}
      <div className="w-full max-w-[320px] space-y-1">
        {steps.map((step, i) => {
          const Icon = STEP_ICONS[step.key as keyof typeof STEP_ICONS] ?? Sparkles;
          const isVisible = i < visibleCount;

          return (
            <div
              key={step.key}
              className={cn(
                "flex items-center gap-4 px-4 py-3.5 rounded-[10px] transition-all duration-500",
                !isVisible && "opacity-0 translate-y-2",
                isVisible && "opacity-100 translate-y-0",
                step.status === "active" && "bg-primary/[0.06]",
                step.status === "complete" && "opacity-70",
              )}
              style={{
                transitionDelay: isVisible ? `${i * 60}ms` : "0ms",
              }}
            >
              {/* Status indicator */}
              <div
                className={cn(
                  "relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-300",
                  step.status === "pending" && "bg-muted",
                  step.status === "active" && "bg-primary/10",
                  step.status === "complete" && "bg-accent-green/10",
                  step.status === "failed" && "bg-destructive/10",
                )}
              >
                {step.status === "complete" ? (
                  <Check className="w-3.5 h-3.5 text-accent-green" />
                ) : step.status === "failed" ? (
                  <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                ) : (
                  <Icon
                    className={cn(
                      "w-3.5 h-3.5 transition-colors duration-300",
                      step.status === "active"
                        ? "text-primary"
                        : "text-muted-foreground/50"
                    )}
                  />
                )}

                {/* Active pulse ring */}
                {step.status === "active" && (
                  <span className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping" />
                )}
              </div>

              {/* Label */}
              <span
                className={cn(
                  "text-sm transition-colors duration-300",
                  step.status === "active" && "text-foreground font-medium",
                  step.status === "complete" && "text-muted-foreground",
                  step.status === "pending" && "text-muted-foreground/50",
                  step.status === "failed" && "text-destructive",
                )}
              >
                {step.label}
                {step.status === "active" && (
                  <span className="inline-flex ml-1">
                    <span className="animate-pulse">.</span>
                    <span className="animate-pulse" style={{ animationDelay: "200ms" }}>.</span>
                    <span className="animate-pulse" style={{ animationDelay: "400ms" }}>.</span>
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

    </div>
  );
}
