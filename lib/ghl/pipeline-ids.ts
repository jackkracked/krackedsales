/**
 * GHL pipeline ids that the UI needs to name directly.
 *
 * Kept in their own module with no imports so client components can use them. The server-side
 * copies in lib/leads/promote-meta-lead.ts cannot be imported from the browser: that module
 * pulls in the GHL client, which reads private tokens from the environment.
 */

/** Email Design Demo Pipeline (AD FUNNEL). Paid traffic, and the default for a manual create. */
export const AD_FUNNEL_PIPELINE_ID = "JRvrpfcwAlAOM38mPAUJ";

/** Email Design Demo Pipeline (ORGANIC FUNNEL). Instagram and DM leads. */
export const ORGANIC_FUNNEL_PIPELINE_ID = "uEefctNze07YOCaGOSNE";
