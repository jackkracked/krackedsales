import { randomBytes } from "crypto";

/**
 * Public board token — same shape as the proposal token: a 64-char hex string
 * that's unguessable and identifies the intended prospect. The board URL is
 * `/board/<slug>-<token>`-free: we keep the token in the path segment directly
 * (BOARD_PATH + "/" + token) so the link works even before a slug is known.
 */
export function generateBoardToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * A short, human-friendly suffix for reference codes (e.g. the RAND in
 * DEMO-DRINKS-0613-9F2A). Math.random is unavailable in some runtimes, so we
 * derive it from crypto. 4 uppercase hex chars is plenty for human disambiguation.
 */
export function shortCode(): string {
  return randomBytes(2).toString("hex").toUpperCase();
}
