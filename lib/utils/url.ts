/**
 * Clean a URL that may have been typed with spaces (common form input mistake).
 * e.g. "www.paintedperfeclybyalisha. com" → "https://www.paintedperfeclybyalisha.com"
 */
export function cleanUrl(raw: string): string {
  // Strip all whitespace and lowercase everything
  const clean = raw.replace(/\s+/g, "").toLowerCase();
  // Add https:// if no protocol present
  if (!/^https?:\/\//.test(clean)) {
    return `https://${clean}`;
  }
  return clean;
}

/** Return true if a string looks like a URL */
export function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim().replace(/\s+/g, "");
  return (
    /^https?:\/\//i.test(trimmed) ||
    /^www\./i.test(trimmed) ||
    /\.(com|co|io|net|org|store|shop|uk|au|ca|de|fr|es|nz|app|ai)(\/?|$)/i.test(trimmed)
  );
}

/**
 * Parse a qualification note body (format: question\nanswer\n\nquestion\nanswer...)
 * Returns an array of {question, answer} pairs.
 */
export interface QualificationQA {
  question: string;
  answer: string;
  isUrl: boolean;
  cleanedUrl?: string; // set if isUrl is true
}

export function parseQualificationNote(body: string): QualificationQA[] {
  // Strip the header line if present
  const withoutHeader = body
    .replace(/^[❓🔴🟢✅⚠️]*\s*Qualification Questions?\s*:?\s*\n/i, "")
    .trim();

  // Split into blocks by double newline
  const blocks = withoutHeader.split(/\n\s*\n/).filter((b) => b.trim());

  const results: QualificationQA[] = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n").filter((l) => l.trim());

    let question: string;
    let answer: string;

    if (lines.length >= 2) {
      // Normal format: question on first line, answer on subsequent lines
      question = lines[0].trim().replace(/^[-•*]\s*/, "");
      answer = lines.slice(1).join(" ").trim();
    } else if (lines.length === 1) {
      // Inline format: "Question? Answer" — split on the first '?'
      const single = lines[0].trim();
      const qMark = single.indexOf("?");
      if (qMark > 0 && qMark < single.length - 1) {
        question = single.slice(0, qMark + 1).trim().replace(/^[-•*]\s*/, "");
        answer = single.slice(qMark + 1).trim();
      } else {
        continue;
      }
    } else {
      continue;
    }

    if (!question || !answer) continue;

    const isUrl = looksLikeUrl(answer);
    results.push({
      question,
      answer,
      isUrl,
      cleanedUrl: isUrl ? cleanUrl(answer) : undefined,
    });
  }

  return results;
}

/** Detect if a note is a qualification note (contains the marker) */
export function isQualificationNote(body: string): boolean {
  return /qualification questions?/i.test(body) || body.startsWith("❓");
}
