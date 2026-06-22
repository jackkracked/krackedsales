/**
 * Dataset REGISTRY — the single source of every queryable KPI dataset.
 *
 * `REGISTRY` maps a dataset key → its DatasetDef. The engine looks a dataset up
 * by key (from a saved config), calls `load()` once, then filters/buckets/
 * aggregates in memory. `describeRegistry()` returns the client-safe descriptors
 * (no functions) that power the configurator dropdowns.
 */
import type { DatasetDef, DatasetDescriptor } from "../types";
import { describeDataset } from "../types";

import { stripeCharges, stripeInvoices, stripeSubscriptions } from "./stripe";
import { metaSpend, metaLeads } from "./meta";
import { proposalsDataset } from "./proposals";
import { callsDataset } from "./calls";
import { softwareCostsDataset, manualExpensesDataset, demoBoardsDataset } from "./internal";
import { ghlOpportunities, ghlAppointments } from "./ghl";
import { clickupTasks } from "./clickup";

/** key → DatasetDef for ALL datasets in the catalog (plan §C.2). */
export const REGISTRY: Record<string, DatasetDef> = {
  [stripeCharges.key]: stripeCharges,
  [stripeInvoices.key]: stripeInvoices,
  [stripeSubscriptions.key]: stripeSubscriptions,
  [metaSpend.key]: metaSpend,
  [metaLeads.key]: metaLeads,
  [proposalsDataset.key]: proposalsDataset,
  [callsDataset.key]: callsDataset,
  [softwareCostsDataset.key]: softwareCostsDataset,
  [manualExpensesDataset.key]: manualExpensesDataset,
  [demoBoardsDataset.key]: demoBoardsDataset,
  [ghlOpportunities.key]: ghlOpportunities,
  [ghlAppointments.key]: ghlAppointments,
  [clickupTasks.key]: clickupTasks,
};

/** Look up a dataset by its key. Returns undefined for an unknown key. */
export function getDataset(key: string): DatasetDef | undefined {
  return REGISTRY[key];
}

/** Client-safe descriptors for every dataset (drives the configurator UI). */
export function describeRegistry(): DatasetDescriptor[] {
  return Object.values(REGISTRY).map(describeDataset);
}
