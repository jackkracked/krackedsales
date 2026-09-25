/**
 * Meta Conversions API — sending lead qualification back to Facebook.
 *
 * THE POINT OF THIS FILE, because it is easy to get wrong and expensive to get wrong:
 * Gage changes a lead's stage in Meta's Leads Centre believing it feeds ad optimisation.
 * It largely doesn't. For a Conversion Leads campaign the algorithm learns from a
 * Conversions API event, not from the dropdown. Once the Leads Centre lives in this app,
 * THIS FILE is the only thing telling Facebook which leads were any good.
 *
 * The campaigns run "Maximise number of qualified leads" against dataset 969023258488979
 * at $117-$337 per qualified lead. A silently broken event here degrades targeting on real
 * spend, slowly, with nothing on screen to show it. So every send is recorded on the
 * contact (capi_status / capi_sent_at / capi_error) and surfaced in the UI.
 *
 * Matching, best first:
 *   1. Meta's own lead id from facebook_leads (exact; only present for leads that arrived
 *      via the leadgen webhook)
 *   2. hashed email + phone (Meta's documented fallback — every GHL lead has these)
 *
 * All personal data is SHA-256 hashed before it leaves this process. Meta requires it, and
 * we never want raw customer email in a third party's request log.
 */
import crypto from "crypto";

const GRAPH_VERSION = "v25.0";

/**
 * Leads Centre stage -> the EXACT event name already live on dataset 969023258488979.
 *
 * These names are not our invention and must not be "tidied". Gage changing Meta's stage
 * dropdown is confirmed (by Jack, 2026-08-07) to be what fires these events today:
 *
 *     QUALIFIED   86 events      CONVERTED   93 events      BAD   143 events
 *
 * Meta's optimiser has months of history against those exact strings. Inventing
 * `QualifiedLead` or `qualified` would start a brand-new event from zero and throw that
 * history away, on traffic costing $117-$337 per qualified lead.
 *
 * Stages mapped to null send nothing: they are internal triage states that Meta has no
 * history for, and a stage with no established event is worse than silence.
 */
export const STAGE_TO_META_EVENT: Record<string, string | null> = {
  qualified: "QUALIFIED",
  converted: "CONVERTED",
  // "Not qualified" is what fires BAD. This is MEASURED, not inferred (Jack, 2026-08-07):
  // filtering Leads Centre to "Not qualified" over 8 Jul - 6 Aug returns exactly
  // 143 Total leads, and BAD on the dataset shows exactly 143 events for the same window.
  // Filtering the same view to "Disqualified" returns 0. Meta's dropdown carries BOTH
  // stages; only one of them is in use.
  not_qualified: "BAD",
  // Genuinely unused in Leads Centre (0 leads), so it has no established event. Silent
  // rather than guessed: BAD is a NEGATIVE signal, and a wrong negative teaches the
  // optimiser that good leads are bad — worse than sending nothing at all.
  disqualified: null,
  intake: null,
  need_more_info: null,
  lost: null,
};

/**
 *
 * TRANSITION RISK, the one that actually matters: while Gage uses BOTH this app AND Meta's
 * Leads Centre, every qualification is sent TWICE and the optimiser sees inflated quality.
 * The cutover must be clean — once this ships, Leads Centre stops being opened.
 */

export type CapiResult =
  | { status: "sent"; eventId: string; matched: "lead_id" | "email_phone" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/** Meta requires SHA-256 of the normalised value: trimmed, lowercased, no formatting. */
function hash(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalised = value.trim().toLowerCase();
  if (!normalised) return null;
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

/** Phones must be digits only (with country code) BEFORE hashing, or matching silently fails. */
function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return crypto.createHash("sha256").update(digits).digest("hex");
}

export interface QualifiedLeadEvent {
  /** Our contact id — used as the deduplication key so a double-click never double-counts. */
  contactId: string;
  email?: string | null;
  phone?: string | null;
  /** Meta's 15-17 digit lead id, when we have it. Exact matching. */
  leadgenId?: string | null;
  /** When the human actually qualified them. Meta rejects events older than 7 days. */
  occurredAt?: Date;
  /** Defaults to the stage name; overridable if the campaign targets a custom event. */
  eventName?: string;
}

/**
 * Send one qualified-lead event. NEVER throws — returns a structured result so the caller
 * records it and the UI can show a failed signal rather than pretending it succeeded.
 */
export async function sendQualifiedLead(event: QualifiedLeadEvent): Promise<CapiResult> {
  const datasetId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;

  if (!datasetId) return { status: "skipped", reason: "META_PIXEL_ID is not configured" };
  if (!token) return { status: "skipped", reason: "no Meta access token configured" };

  const emailHash = hash(event.email);
  const phoneHash = hashPhone(event.phone);
  if (!event.leadgenId && !emailHash && !phoneHash) {
    return { status: "skipped", reason: "no identifier to match on (no lead id, email or phone)" };
  }

  // Meta rejects events dated more than 7 days back. Clamp rather than fail: a slightly
  // late timestamp still optimises, a rejected event teaches nothing.
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86_400_000;
  const occurred = event.occurredAt ? event.occurredAt.getTime() : now;
  const eventTime = Math.floor(Math.max(occurred, sevenDaysAgo + 60_000) / 1000);

  // Stable per contact per stage, so a retry or a double-click is deduplicated by Meta
  // rather than counted twice and inflating the optimiser's view of quality.
  const eventId = `${(event.eventName ?? "QUALIFIED").toLowerCase()}_${event.contactId}`;

  const userData: Record<string, unknown> = {};
  if (emailHash) userData.em = [emailHash];
  if (phoneHash) userData.ph = [phoneHash];
  if (event.leadgenId) userData.lead_id = event.leadgenId;

  const payload = {
    data: [
      {
        // Must match the live event name exactly — see STAGE_TO_META_EVENT.
        event_name: event.eventName ?? "QUALIFIED",
        event_time: eventTime,
        event_id: eventId,
        action_source: "system_generated",
        // Mirrors what the existing events on this dataset carry. The ad sets optimise on
        // QUALITY_LEAD, which consumes CRM lead-stage events keyed to Meta's lead_id.
        custom_data: { lead_event_source: "Kracked Sales", event_source: "crm" },
        user_data: userData,
      },
    ],
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${datasetId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = (await res.json()) as { events_received?: number; error?: { message?: string } };

    if (!res.ok || body.error) {
      return { status: "failed", error: body.error?.message ?? `HTTP ${res.status}` };
    }
    if (!body.events_received) {
      return { status: "failed", error: "Meta accepted the request but received 0 events" };
    }
    return {
      status: "sent",
      eventId,
      matched: event.leadgenId ? "lead_id" : "email_phone",
    };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
