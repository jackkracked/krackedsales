"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, PoundSterling, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface CostSettingsData {
  costPerEmail: number;
  costPerAudit: number;
}

async function fetchCostSettings(): Promise<CostSettingsData> {
  const res = await fetch("/api/settings/cost-settings");
  if (!res.ok) throw new Error("Failed to load cost settings");
  return res.json();
}

async function saveCostSettings(data: CostSettingsData) {
  const res = await fetch("/api/settings/cost-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save");
}

function CostCard({
  icon: Icon,
  title,
  description,
  label,
  value,
  onChange,
  onSave,
  isPending,
  isError,
  saved,
}: {
  icon: React.ElementType;
  title: string;
  description: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  isPending: boolean;
  isError: boolean;
  saved: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-[10px] p-5" data-r10n-settings-card>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-muted-foreground" data-r10n-settings-cardicon />
        <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }} data-r10n-settings-cardtitle>
          {title}
        </h2>
      </div>
      <p className="text-xs text-muted-foreground mb-5">{description}</p>

      <form
        onSubmit={(e) => { e.preventDefault(); onSave(); }}
        className="flex items-end gap-3"
      >
        <div className="space-y-1.5 flex-1 max-w-[200px]">
          <label className="text-xs font-medium text-foreground">{label}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="0.00"
              className={cn(
                "w-full rounded-[6px] border border-border bg-background pl-6 pr-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              )}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
            "bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
          Save
        </button>

        {saved && (
          <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved
          </span>
        )}
        {isError && (
          <span className="text-xs text-destructive">Failed to save. Try again.</span>
        )}
      </form>
    </div>
  );
}

export function CostSettings() {
  const queryClient = useQueryClient();
  const [emailValue, setEmailValue] = useState("");
  const [auditValue, setAuditValue] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);
  const [auditSaved, setAuditSaved] = useState(false);

  const { data } = useQuery({
    queryKey: ["cost-settings"],
    queryFn: fetchCostSettings,
  });

  useEffect(() => {
    if (data !== undefined) {
      setEmailValue(String(data.costPerEmail));
      setAuditValue(String(data.costPerAudit));
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: saveCostSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cost-settings"] });
      queryClient.invalidateQueries({ queryKey: ["computed-costs"] });
    },
  });

  function saveEmail() {
    const parsed = parseFloat(emailValue);
    if (isNaN(parsed) || parsed < 0) return;
    saveMutation.mutate(
      { costPerEmail: parsed, costPerAudit: parseFloat(auditValue) || 0 },
      { onSuccess: () => { setEmailSaved(true); setTimeout(() => setEmailSaved(false), 3000); } }
    );
  }

  function saveAudit() {
    const parsed = parseFloat(auditValue);
    if (isNaN(parsed) || parsed < 0) return;
    saveMutation.mutate(
      { costPerEmail: parseFloat(emailValue) || 0, costPerAudit: parsed },
      { onSuccess: () => { setAuditSaved(true); setTimeout(() => setAuditSaved(false), 3000); } }
    );
  }

  return (
    <div className="space-y-4">
      <CostCard
        icon={PoundSterling}
        title="Cost Per Email Demo"
        description={
          <>
            The staff cost to fulfill one email demo. <strong>Team Fulfillment</strong> on the KPI page is calculated as this value × completed demos that month — updated automatically.
          </>
        }
        label="Cost per demo ($)"
        value={emailValue}
        onChange={setEmailValue}
        onSave={saveEmail}
        isPending={saveMutation.isPending}
        isError={saveMutation.isError}
        saved={emailSaved}
      />

      <CostCard
        icon={ClipboardCheck}
        title="Cost Per Audit"
        description={
          <>
            The staff cost to fulfill one email audit. <strong>Team Fulfillment</strong> on the KPI page includes this value × audits completed that month — updated automatically.
          </>
        }
        label="Cost per audit ($)"
        value={auditValue}
        onChange={setAuditValue}
        onSave={saveAudit}
        isPending={saveMutation.isPending}
        isError={saveMutation.isError}
        saved={auditSaved}
      />
    </div>
  );
}
