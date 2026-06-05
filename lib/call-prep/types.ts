export interface CallPrepSections {
  executiveSummary: string;
  callAgenda: string[];
  brandResearch: {
    summary: string;
    audience: string;
    currentMarketing: string;
  } | null;
  qualification: {
    budget: string;
    timeline: string;
    decisionMaker: string;
    fit: string;
  };
  objectionPlaybook: Array<{
    objection: string;
    response: string;
  }>;
  previousInteractions: {
    lastCallSummary: string;
    recentMessages: Array<{ channel: string; body: string; date: string }>;
    promisesMade: string[];
  } | null;
  demoStatus: {
    status: string;
    clickupLink: string | null;
  } | null;
}

export interface CallPrepData {
  id: string;
  calendarEventId: string;
  contactId: string;
  contactName: string | null;
  callType: "intro" | "follow_up";
  status: "pending" | "generating" | "ready" | "failed";
  sections: CallPrepSections | null;
  failedSections: string[];
  generatedAt: string | null;
}

export interface GenerationStep {
  key: string;
  label: string;
  status: "pending" | "active" | "complete" | "failed";
}

export const GENERATION_STEPS: Omit<GenerationStep, "status">[] = [
  { key: "contact", label: "Fetching contact details" },
  { key: "website", label: "Researching brand website" },
  { key: "history", label: "Analysing call history" },
  { key: "generating", label: "Generating call brief" },
];
