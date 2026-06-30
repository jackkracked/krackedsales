// Realistic mock data for the Dialer high-fidelity PREVIEW only. No telephony,
// no API calls — this drives the visual + flow preview so the cockpit and keypad
// can be reviewed before any Twilio wiring. Real data swaps in during the build.

export type Sentiment = "positive" | "neutral" | "negative";

export interface DialerContact {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  stage: string;
  tags: string[];
  attempts: number;
  qualification: { q: string; a: string }[];
  messages: { dir: "in" | "out"; body: string; time: string }[];
  notes: { author: string; body: string; time: string }[];
  timeline: { label: string; time: string }[];
  lastCall?: { when: string; summary: string; sentiment: Sentiment; objection: string | null };
}

export interface DialerCampaign {
  id: string;
  name: string;
  reps: { name: string; initials: string }[];
  maxAttempts: number;
  reached: number;
  exhausted: number;
  contacts: DialerContact[];
}

// ── Real-data shapes (from the dialer API) ──────────────────────────────────
export interface CampaignCounts {
  queued: number; inProgress: number; completed: number; exhausted: number; suppressed: number; total: number;
}
/** A campaign as listed in the rail (GET /api/dialer/campaigns). */
export interface CampaignSummary {
  id: string; name: string; maxAttempts: number; status: string;
  reps: { userId: string; name: string }[];
  counts: CampaignCounts;
}
/** A contact in a campaign's queue (roster). */
export interface RosterContact {
  id: string; contactId: string; contactName: string | null; phone: string | null; attempts: number; status: string;
}
/** Full campaign detail (GET /api/dialer/campaigns/[id]). */
export interface CampaignDetail {
  campaign: { id: string; name: string; maxAttempts: number; status: string; ownerScope: string };
  reps: { userId: string; name: string }[];
  counts: CampaignCounts;
  contacts: RosterContact[];
}
/** The contact currently claimed for dialing (from /next or /disposition). */
export interface ClaimedContact {
  id: string; contactId: string; contactName: string | null; phone: string | null; attempts: number;
}

export const MOCK_CAMPAIGNS: DialerCampaign[] = [
  {
    id: "camp_dtc_q3",
    name: "DTC Q3 — Free Demo Offer",
    reps: [{ name: "Gage Flasher", initials: "GF" }, { name: "Alice Monroe", initials: "AM" }],
    maxAttempts: 3,
    reached: 18,
    exhausted: 4,
    contacts: [
      {
        id: "c1",
        name: "Renee Sembera",
        company: "Shop Hazel Lane",
        phone: "+1 (415) 555-0182",
        email: "renee@shophazellane.com",
        stage: "New Lead",
        tags: ["FB Lead", "DTC", "$25K–$100K/mo"],
        attempts: 1,
        qualification: [
          { q: "Currently running email?", a: "Yes" },
          { q: "Platform", a: "Klaviyo" },
          { q: "Current state", a: "Running basic flows but not performing" },
          { q: "Who manages it", a: "Managing it in-house, needs a strategic upgrade" },
          { q: "Monthly revenue", a: "Growing: $25K–$100K/month" },
          { q: "Biggest blocker", a: "Tried email but it hasn't converted" },
        ],
        messages: [
          { dir: "in", body: "Hey, saw your free demo offer — interested to see what you'd do for our flows", time: "2d ago" },
          { dir: "out", body: "Love it Renee. Quick call to walk you through it? I've got a slot tomorrow AM.", time: "2d ago" },
          { dir: "in", body: "Tomorrow works, morning is better for me", time: "1d ago" },
        ],
        notes: [
          { author: "Gage", body: "Warm — replied within an hour of the demo DM. Klaviyo already set up, just underperforming.", time: "1d ago" },
        ],
        timeline: [
          { label: "Lead created from FB demo form", time: "2d ago" },
          { label: "Moved to New Lead", time: "2d ago" },
          { label: "First call attempt — no answer", time: "4h ago" },
        ],
        lastCall: { when: "4h ago", summary: "No answer, went to voicemail. Left a short intro.", sentiment: "neutral", objection: null },
      },
      {
        id: "c2",
        name: "Marcus Bell",
        company: "Camp & Co",
        phone: "+1 (312) 555-0147",
        email: "marcus@campco.com",
        stage: "Initial Contact Made",
        tags: ["FB Lead", "Apparel"],
        attempts: 0,
        qualification: [
          { q: "Currently running email?", a: "Yes" },
          { q: "Platform", a: "Other" },
          { q: "Current state", a: "Using templates, nothing custom built" },
          { q: "Monthly revenue", a: "Growing: $25K–$100K/month" },
        ],
        messages: [
          { dir: "in", body: "What's the catch with the free audit?", time: "3d ago" },
          { dir: "out", body: "No catch — we show you exactly what we'd change, you decide if you want us to build it.", time: "3d ago" },
        ],
        notes: [{ author: "Alice", body: "Skeptical but engaged. Lead with proof, not pitch.", time: "3d ago" }],
        timeline: [
          { label: "Lead created from FB demo form", time: "3d ago" },
          { label: "Replied to outreach", time: "3d ago" },
        ],
        lastCall: undefined,
      },
      {
        id: "c3",
        name: "Priya Desai",
        company: "Lumen Skincare",
        phone: "+1 (646) 555-0193",
        email: "priya@lumenskin.co",
        stage: "New Lead",
        tags: ["FB Lead", "Beauty", "$100K+/mo"],
        attempts: 2,
        qualification: [
          { q: "Currently running email?", a: "Yes" },
          { q: "Platform", a: "Klaviyo" },
          { q: "Monthly revenue", a: "Scaling: $100K+/month" },
          { q: "Biggest blocker", a: "No bandwidth to build a proper lifecycle program" },
        ],
        messages: [{ dir: "in", body: "Send me some examples of brands like ours", time: "5d ago" }],
        notes: [{ author: "Gage", body: "High value. Two no-answers already — last attempt before requeue cap.", time: "1d ago" }],
        timeline: [
          { label: "Lead created from FB demo form", time: "5d ago" },
          { label: "Call attempt — no answer", time: "2d ago" },
          { label: "Call attempt — no answer", time: "1d ago" },
        ],
        lastCall: { when: "1d ago", summary: "No answer. Did not leave a second voicemail.", sentiment: "neutral", objection: null },
      },
    ],
  },
  {
    id: "camp_followups",
    name: "Free Audit — Follow-ups",
    reps: [{ name: "Gage Flasher", initials: "GF" }],
    maxAttempts: 5,
    reached: 9,
    exhausted: 1,
    contacts: [
      {
        id: "c4",
        name: "Tyler Delphous",
        company: "Foreverhome Apparel",
        phone: "+1 (213) 555-0166",
        email: "tyler@foreverhomeapparel.com",
        stage: "Audit Delivered",
        tags: ["Audit sent", "Apparel"],
        attempts: 1,
        qualification: [
          { q: "Audit delivered", a: "Yes — 3 days ago" },
          { q: "Monthly revenue", a: "Growing: $25K–$100K/month" },
        ],
        messages: [{ dir: "out", body: "Your audit's ready — 4 quick wins inside. Want me to walk you through it?", time: "3d ago" }],
        notes: [{ author: "Gage", body: "Opened the audit twice. Strike while it's warm.", time: "1d ago" }],
        timeline: [
          { label: "Audit delivered", time: "3d ago" },
          { label: "Audit opened (2x)", time: "1d ago" },
        ],
        lastCall: { when: "1d ago", summary: "Brief connect — asked to call back after their team sync.", sentiment: "positive", objection: "Needs buy-in from co-founder" },
      },
    ],
  },
  {
    id: "camp_reengage",
    name: "Re-engagement — Past No-Shows",
    reps: [{ name: "Alice Monroe", initials: "AM" }],
    maxAttempts: 3,
    reached: 3,
    exhausted: 6,
    contacts: [
      {
        id: "c5",
        name: "Wauna Johnson",
        company: "Scale Creations",
        phone: "+1 (704) 555-0110",
        email: "wauna@scalecreations.org",
        stage: "Unresponsive",
        tags: ["No-show", "Re-engage"],
        attempts: 2,
        qualification: [{ q: "Monthly revenue", a: "Growing: $25K–$100K/month" }],
        messages: [{ dir: "out", body: "We missed you at the demo — still want those 4 wins? Happy to find a new time.", time: "1w ago" }],
        notes: [{ author: "Alice", body: "Ghosted after booking. Last shot before exhausted.", time: "2d ago" }],
        timeline: [
          { label: "No-showed booked demo", time: "1w ago" },
          { label: "Re-engagement attempt", time: "2d ago" },
        ],
        lastCall: { when: "2d ago", summary: "No answer.", sentiment: "neutral", objection: null },
      },
    ],
  },
];
