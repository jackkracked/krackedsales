"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const SOURCES = [
  "Kracked IG DM's",
  "Kracked Messenger DM's",
  "Taylor's TikTok DM's",
  "Taylor's TikTok Funnel",
  "Main Website Funnel",
  "Free Demo Ads Funnel",
  "Free Audit Ads Funnel",
  "Aaron's Youtube",
];

interface Pipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
}

interface AddLeadModalProps {
  pipelines: Pipeline[];
  defaultPipelineId: string;
  onClose: () => void;
}

export function AddLeadModal({ pipelines, defaultPipelineId, onClose }: AddLeadModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [source, setSource] = useState("Kracked IG DM's");
  const [selectedPipelineId, setSelectedPipelineId] = useState(defaultPipelineId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId) ?? pipelines[0];
  const firstStageId = selectedPipeline?.stages[0]?.id ?? "";

  function handlePipelineChange(id: string) {
    setSelectedPipelineId(id);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }

    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/ghl/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: email || undefined,
          phone: phone || undefined,
          website: website || undefined,
          source,
          pipelineId: selectedPipeline?.id,
          pipelineStageId: firstStageId,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create lead");

      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add lead.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-card border border-border rounded-[10px] shadow-lg w-full max-w-md p-6 z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Add Lead Manually
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Contact Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Smith"
              className="w-full px-3 py-2 text-sm border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              className="w-full px-3 py-2 text-sm border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="w-full px-3 py-2 text-sm border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />
          </div>

          {/* Website */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Website URL</label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-3 py-2 text-sm border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />
          </div>

          {/* Pipeline */}
          {pipelines.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Pipeline</label>
              <select
                value={selectedPipelineId}
                onChange={(e) => handlePipelineChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-[7px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Source */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Lead Source *</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-[7px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            >
              {SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-foreground border border-border rounded-[7px] hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={cn(
                "flex-1 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-[7px] transition-colors",
                isSubmitting ? "opacity-60 cursor-not-allowed" : "hover:bg-primary/90"
              )}
            >
              {isSubmitting ? "Adding…" : "Add Lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
