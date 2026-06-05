import { GoogleGenAI } from "@google/genai";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResearchSource {
  uri: string;
  title: string | null;
}

export interface CompanyResearch {
  whatTheySell: string;
  productsAndPricing: string;
  targetCustomer: string;
  positioningVoice: string;
  /** "Emerging brand" / "Established brand" + the evidence, definitively. */
  maturity: string;
  salesChannel: string;
  /** Their current email-marketing presence and the concrete opportunity for Kracked. */
  emailPresence: string;
  /** External numbers ONLY when grounding found a real source. Never guessed. */
  publicNumbers: Array<{ claim: string; sourceUrl: string }>;
  /** Specific things research could NOT establish — to ask on the call, not guess. */
  confirmOnCall: string[];
  /** Grounding citations, carried in code (never re-emitted by the model). */
  sources: ResearchSource[];
  /** True when research was thin/failed and the brief should note the gap. */
  degraded: boolean;
}

// ─── Site fetching (keyless, capped) ──────────────────────────────────────────

const RESEARCH_MODEL = "gemini-2.5-pro";
const STRUCTURE_MODEL = "gemini-2.5-flash";
const PER_FETCH_TIMEOUT_MS = 7000;
const TOTAL_SITE_TEXT_CAP = 12000;
const LINK_KEYWORDS = /about|story|product|shop|collection|pricing|services|faq/i;

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetch one URL as text with a hard timeout; returns "" on any failure (never throws). */
async function fetchOne(url: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PER_FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KrackedBot/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return "";
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Read the homepage plus a few same-origin key pages (about/products/pricing…).
 * Keyless (plain fetch), bounded in time and size. Returns "" if nothing readable.
 */
export async function fetchSitePages(website: string): Promise<string> {
  let base = website.trim();
  if (!base.startsWith("http")) base = `https://${base}`;
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return "";
  }

  const homeHtml = await fetchOne(origin.href);
  if (!homeHtml) return "";

  // Discover same-origin internal links worth reading.
  const hrefs = new Set<string>();
  const linkRe = /href=["']([^"'#?]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(homeHtml)) && hrefs.size < 40) {
    try {
      const u = new URL(m[1], origin);
      if (u.host === origin.host && LINK_KEYWORDS.test(u.pathname)) {
        hrefs.add(u.href.split("#")[0]);
      }
    } catch {
      /* ignore bad hrefs */
    }
  }

  const extraUrls = Array.from(hrefs).slice(0, 4);
  const extraHtml = await Promise.allSettled(extraUrls.map(fetchOne));

  const parts = [extractText(homeHtml)];
  for (const r of extraHtml) {
    if (r.status === "fulfilled" && r.value) parts.push(extractText(r.value));
  }
  return parts.join("\n\n---\n\n").slice(0, TOTAL_SITE_TEXT_CAP);
}

// ─── Grounded research ────────────────────────────────────────────────────────

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

const EMPTY_RESEARCH: CompanyResearch = {
  whatTheySell: "",
  productsAndPricing: "",
  targetCustomer: "",
  positioningVoice: "",
  maturity: "",
  salesChannel: "",
  emailPresence: "",
  publicNumbers: [],
  confirmOnCall: [],
  sources: [],
  degraded: true,
};

/**
 * Definitive company research: grounded web search + the company's own site.
 *
 * Two calls, because Gemini 2.5 rejects JSON output combined with the
 * google_search tool: (1) grounded research → prose + sources, (2) a plain
 * call structures that prose into JSON. Sources are carried in code, never
 * re-emitted by the model (it hallucinates URLs).
 *
 * Never throws — returns a degraded result so the brief still generates.
 */
export async function researchCompany(params: {
  website: string | null;
  companyName: string | null;
  contactName: string;
  siteText: string;
}): Promise<CompanyResearch> {
  const { website, companyName, contactName, siteText } = params;
  const subject = companyName || website || contactName;
  if (!subject) return EMPTY_RESEARCH;

  try {
    const ai = getClient();

    // ── Call 1: grounded research (web search). Prose + citations, no JSON. ──
    const researchPrompt = `You are a B2B sales researcher preparing intelligence on a prospect for Kracked, an email design agency.

Prospect: ${subject}${website ? `\nWebsite: ${website}` : ""}
Contact name on the lead: ${contactName}

${siteText ? `Their website content (already fetched):\n${siteText}` : "Their website could not be fetched directly — rely on web search."}

Using Google Search, establish DEFINITIVE, factual answers. Do NOT hedge — no "likely", "probably", "appears", "seems", "suggests", or "maybe". State what is verifiably true.

Cover:
1. What exactly they sell (specific products/services and price points).
2. Their target customer.
3. Brand positioning and voice (quote their own language if available).
4. Maturity: are they an EMERGING brand or an ESTABLISHED one? Give the evidence (product range size, review counts, founding year, press, funding, scale).
5. Sales channel (e.g. Shopify DTC, retail, wholesale).
6. Their CURRENT email-marketing presence (newsletter, popups, flows) and the specific opportunity an email design agency could add.
7. Any public NUMBERS (revenue, funding, team size, social following, customer count) — ONLY if you find them with a real source. If you cannot find a number with a source, do not state one.

Finally, list anything you genuinely could NOT determine — these become questions to confirm on the call, not guesses.

Write it as clear prose with concrete facts.`;

    const research = await ai.models.generateContent({
      model: RESEARCH_MODEL,
      contents: researchPrompt,
      config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
    });

    const researchText = (research.text ?? "").trim();
    const chunks =
      research.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources: ResearchSource[] = chunks
      .map((c) => ({ uri: c.web?.uri ?? "", title: c.web?.title ?? null }))
      .filter((s) => s.uri);

    if (!researchText) return { ...EMPTY_RESEARCH, sources };

    // ── Call 2: structure the prose into JSON (no tools → JSON allowed). ──
    const structurePrompt = `Convert the research below into JSON. Use ONLY facts present in the research — invent nothing. If a field is not covered, use an empty string or empty array. For publicNumbers, include an item ONLY if the research gives both a claim and a source URL.

Research:
${researchText}

Return ONLY this JSON (no markdown):
{
  "whatTheySell": "string",
  "productsAndPricing": "string",
  "targetCustomer": "string",
  "positioningVoice": "string",
  "maturity": "Emerging brand or Established brand, plus the evidence, as a definitive statement",
  "salesChannel": "string",
  "emailPresence": "their current email presence and the concrete opportunity for an email design agency",
  "publicNumbers": [{"claim": "string", "sourceUrl": "string"}],
  "confirmOnCall": ["specific question 1", "..."]
}`;

    const structured = await ai.models.generateContent({
      model: STRUCTURE_MODEL,
      contents: structurePrompt,
      config: { responseMimeType: "application/json", temperature: 0 },
    });

    const json = JSON.parse((structured.text ?? "{}").replace(/```json|```/g, "").trim());

    return {
      whatTheySell: json.whatTheySell ?? "",
      productsAndPricing: json.productsAndPricing ?? "",
      targetCustomer: json.targetCustomer ?? "",
      positioningVoice: json.positioningVoice ?? "",
      maturity: json.maturity ?? "",
      salesChannel: json.salesChannel ?? "",
      emailPresence: json.emailPresence ?? "",
      publicNumbers: Array.isArray(json.publicNumbers)
        ? json.publicNumbers.filter(
            (n: { claim?: string; sourceUrl?: string }) => n?.claim && n?.sourceUrl,
          )
        : [],
      confirmOnCall: Array.isArray(json.confirmOnCall) ? json.confirmOnCall : [],
      sources,
      degraded: false,
    };
  } catch (err) {
    console.error("[call-prep/research] degraded:", err);
    return EMPTY_RESEARCH;
  }
}
