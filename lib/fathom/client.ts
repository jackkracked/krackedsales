/**
 * Fathom AI REST API client — wraps meeting, transcript, and summary endpoints.
 * Auth uses X-Api-Key header with user's personal Fathom API key.
 */

const FATHOM_BASE = "https://api.fathom.ai/external/v1";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FathomInvitee {
  name: string;
  email: string;
  email_domain: string;
  is_external: boolean;
}

export interface FathomTranscriptItem {
  speaker: {
    display_name: string;
    matched_calendar_invitee_email: string | null;
  };
  text: string;
  timestamp: string; // "HH:MM:SS"
}

export interface FathomMeeting {
  recording_id: number;
  title: string;
  meeting_title?: string;
  url: string;             // recording view URL on fathom.video
  meeting_url?: string;    // the Google Meet / Zoom link (matches GHL event address)
  share_url: string;       // public share link to the recording
  created_at: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  recording_start_time: string;
  recording_end_time: string;
  recorded_by: { name: string; email: string; email_domain: string };
  calendar_invitees: FathomInvitee[];
  transcript?: FathomTranscriptItem[];
  default_summary?: {
    template_name: string | null;
    markdown_formatted: string | null;
  };
}

// The Fathom external API returns meetings under `items` (not `meetings`).
interface ListMeetingsResponse {
  items: FathomMeeting[];
  next_cursor: string | null;
}

interface TranscriptResponse {
  transcript: FathomTranscriptItem[];
}

interface SummaryResponse {
  summary: {
    template_name: string | null;
    markdown_formatted: string | null;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

class FathomApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "FathomApiError";
  }
}

async function fathomFetch<T>(
  apiKey: string,
  path: string,
): Promise<T> {
  const res = await fetch(`${FATHOM_BASE}${path}`, {
    headers: { "X-Api-Key": apiKey },
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 401) throw new FathomApiError(401, "Invalid Fathom API key");
    if (res.status === 429) throw new FathomApiError(429, "Rate limited");
    const body = await res.text().catch(() => "");
    throw new FathomApiError(res.status, `Fathom API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * List meetings from Fathom, auto-paginating through all results.
 */
export async function listMeetings(
  apiKey: string,
  opts?: {
    createdAfter?: string;
    includeTranscript?: boolean;
    includeSummary?: boolean;
  },
): Promise<FathomMeeting[]> {
  const all: FathomMeeting[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams();
    if (opts?.createdAfter) params.set("created_after", opts.createdAfter);
    if (opts?.includeTranscript) params.set("include_transcript", "true");
    if (opts?.includeSummary) params.set("include_summary", "true");
    if (cursor) params.set("cursor", cursor);

    const qs = params.toString();
    const path = `/meetings${qs ? `?${qs}` : ""}`;

    const page = await fathomFetch<ListMeetingsResponse>(apiKey, path);
    all.push(...(page.items ?? []));
    cursor = page.next_cursor;
  } while (cursor);

  return all;
}

/**
 * Fetch the full transcript for a specific recording.
 */
export async function getTranscript(
  apiKey: string,
  recordingId: number,
): Promise<TranscriptResponse> {
  return fathomFetch<TranscriptResponse>(apiKey, `/recordings/${recordingId}/transcript`);
}

/**
 * Fetch the AI-generated summary for a specific recording.
 */
export async function getSummary(
  apiKey: string,
  recordingId: number,
): Promise<SummaryResponse> {
  return fathomFetch<SummaryResponse>(apiKey, `/recordings/${recordingId}/summary`);
}

/**
 * Validate a Fathom API key by attempting a lightweight list call.
 * Returns true if the key is valid, false if 401.
 */
export async function validateKey(apiKey: string): Promise<boolean> {
  try {
    await fathomFetch<ListMeetingsResponse>(apiKey, "/meetings");
    return true;
  } catch (err) {
    if (err instanceof FathomApiError && err.status === 401) return false;
    throw err;
  }
}
