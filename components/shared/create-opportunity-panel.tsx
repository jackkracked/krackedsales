"use client";

import { useState } from "react";
import { Check, GitMerge, Plus } from "lucide-react";
import { CreateOpportunityModal } from "@/components/shared/create-opportunity-modal";

/**
 * Shown in the slot where a deal would normally live, for a contact that has none.
 *
 * It states the absence rather than rendering nothing. Before this, a contact with no
 * opportunity simply had no pipeline section at all, so the drawer gave no answer to "where is
 * this person in our pipeline?" and no way to put them in one. The dead "Pipeline" button in the
 * inbox thread header was the only hint the feature was ever intended, and it had no handler.
 *
 * Rendered only when the contact has NO opportunity at all, open, won or lost.
 */
export function CreateOpportunityPanel({
  contactId,
  contactName,
  defaultSource,
  className = "",
  onCreated,
}: {
  contactId: string;
  contactName: string;
  defaultSource?: string | null;
  className?: string;
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Which contact we just created for, rather than a bare boolean. GHL's opportunity search is
  // eventually consistent, so for a second or two after creating, the drawer's lookup still
  // reports "no opportunity" and this panel would re-appear and invite a duplicate. Keying it to
  // the contact id also means switching contacts clears it with no effect or reset logic.
  const [createdFor, setCreatedFor] = useState<string | null>(null);
  const justCreated = createdFor === contactId;

  return (
    <div className={className}>
      <div
        data-r10n-sidebar-card
        className="rounded-[10px] border border-dashed border-border bg-muted/20 px-3.5 py-3"
      >
        {justCreated ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Check className="h-3 w-3 text-emerald-600" />
            Opportunity created. Syncing from GoHighLevel…
          </p>
        ) : (
          <>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <GitMerge className="h-3 w-3" /> Not on a pipeline
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[7px] bg-foreground px-3 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90 active:scale-[0.99]"
            >
              <Plus className="h-3.5 w-3.5" />
              Create opportunity
            </button>
          </>
        )}
      </div>

      {open && (
        <CreateOpportunityModal
          contactId={contactId}
          contactName={contactName}
          defaultSource={defaultSource}
          onClose={() => setOpen(false)}
          onCreated={() => { setCreatedFor(contactId); onCreated?.(); }}
        />
      )}
    </div>
  );
}
