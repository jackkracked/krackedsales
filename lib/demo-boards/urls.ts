import { BOARD_PATH } from "./integration-config";

/** Stable production base URL (same resolution the proposal emails use). */
export const APP_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "https://kracked-sales.vercel.app";

/** Absolute public URL for a board, e.g. https://…/board/<token>. */
export function boardUrl(token: string): string {
  return `${APP_URL}${BOARD_PATH}/${token}`;
}
