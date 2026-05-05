import { FlowCanvas } from "@/components/flow/flow-canvas";

export const metadata = { title: "Templates — Kracked Sales" };

export default function TemplatesPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 pt-5 pb-4 shrink-0 border-b border-border">
        <div className="flex items-end justify-between">
          <div>
            <h1
              className="text-xl font-bold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Conversation Flow
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Click any message to edit · Drag to rearrange
            </p>
          </div>

          {/* Edge type key — inline, compact */}
          <div className="hidden sm:flex items-center gap-5 pb-0.5">
            {[
              { color: "#16a34a", label: "Yes / Positive", dashed: false },
              { color: "#dc2626", label: "No / Exit",      dashed: false },
              { color: "#d97706", label: "Follow-up",      dashed: true  },
              { color: "#7c3aed", label: "Immediate",      dashed: false },
            ].map(({ color, label, dashed }) => (
              <div key={label} className="flex items-center gap-1.5">
                <svg width="20" height="10" viewBox="0 0 20 10">
                  {dashed
                    ? <line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth="2" strokeDasharray="4 3" />
                    : <line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth="2" />
                  }
                </svg>
                <span className="text-[11px] text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <FlowCanvas />
      </div>
    </div>
  );
}
