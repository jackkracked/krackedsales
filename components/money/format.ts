/** Number formatting for the Money page. Finance-grade: exact + grouped where a CFO audits,
 *  compact where scanning wins. Negatives use a true minus glyph (−), never a hyphen. */

const MINUS = "−"; // U+2212 true minus

export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = Math.round(v);
  const sign = n < 0 ? MINUS : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US")}`;
}

/** Compact for tight labels (bridge bars, strip): $98.6K, $1.2M. */
export function fmtMoneyK(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? MINUS : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export function fmtPct(v: number | null | undefined, dp = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(dp)}%`;
}

/** LTV:CAC style ratio → "4.2 : 1". */
export function fmtRatio(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)} : 1`;
}

export function fmtMonths(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)} mo`;
}

export function fmtHours(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "0h";
  return `${(Math.round(v * 10) / 10).toString()}h`;
}
