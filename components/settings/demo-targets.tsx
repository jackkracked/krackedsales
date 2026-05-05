"use client";

import { useState, useEffect } from "react";
import { Save, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDemoTargets, useSaveDemoTargets, type DemoTargets } from "@/lib/hooks/use-demo-targets";

const FIELDS: { key: keyof DemoTargets; label: string; description: string }[] = [
  { key: "copyDays",        label: "Copy",               description: "Max days in Copy stage before at-risk" },
  { key: "designDays",      label: "Design",             description: "Max days in Design stage before at-risk" },
  { key: "copyRevDays",     label: "Copy Revision",      description: "Max days in Copy Revision stage before at-risk" },
  { key: "designRevDays",   label: "Design Revision",    description: "Max days in Design Revision stage before at-risk" },
  { key: "internalQaDays",  label: "Internal QA",        description: "Max days in Internal QA stage before at-risk" },
];

const DEFAULTS: DemoTargets = {
  copyDays:        2,
  designDays:      5,
  copyRevDays:     2,
  designRevDays:   2,
  internalQaDays:  1,
  fulfillmentDays: 7,
};

export function DemoTargets() {
  const { data, isLoading } = useDemoTargets();
  const { mutate: save, isPending } = useSaveDemoTargets();

  const [values, setValues] = useState<DemoTargets>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setValues(data);
  }, [data]);

  function handleChange(key: keyof DemoTargets, raw: string) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) {
      setValues((prev) => ({ ...prev, [key]: n }));
      setSaved(false);
    }
  }

  function handleSave() {
    save(values, {
      onSuccess: () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      },
    });
  }

  function handleReset() {
    setValues(DEFAULTS);
    setSaved(false);
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Demo Turnaround Targets</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Stage pills in the Demo Tracker turn green, amber, or red based on these targets.
          </p>
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <RotateCcw className="w-3 h-3" />
          Reset defaults
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="h-10 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {FIELDS.map(({ key, label, description }) => (
            <div key={key} className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={values[key]}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className={cn(
                    "w-16 text-center text-sm font-medium rounded-lg border border-border bg-background",
                    "px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30",
                    "tabular-nums"
                  )}
                />
                <span className="text-xs text-muted-foreground w-6">days</span>
              </div>
            </div>
          ))}

          {/* Fulfilment target — overall demo creation to send */}
          <div className="pt-3 border-t border-border">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Overall Fulfillment Target</p>
                <p className="text-xs text-muted-foreground">
                  Target days from demo request to demo sent (used for Fulfillment Split &amp; Avg Fulfillment card)
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={values.fulfillmentDays}
                  onChange={(e) => handleChange("fulfillmentDays", e.target.value)}
                  className={cn(
                    "w-16 text-center text-sm font-medium rounded-lg border border-border bg-background",
                    "px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30",
                    "tabular-nums"
                  )}
                />
                <span className="text-xs text-muted-foreground w-6">days</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          onClick={handleSave}
          disabled={isPending}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            saved
              ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
            isPending && "opacity-60 cursor-not-allowed"
          )}
        >
          <Save className="w-3.5 h-3.5" />
          {saved ? "Saved!" : isPending ? "Saving…" : "Save targets"}
        </button>
      </div>
    </div>
  );
}
