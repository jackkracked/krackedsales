export type ConditionField =
  | "brand_category"
  | "has_website"
  | "lead_source"
  | "pipeline_stage"
  | "days_since_created";

export type ConditionOperator = "equals" | "not_equals" | "greater_than" | "less_than";

export interface TemplateCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
}

export interface ReplyTemplate {
  id: string;
  name: string;
  body: string;
  conditions: TemplateCondition[];
  abGroup: string | null;
  weight: number;
  priority: number;
  active: boolean;
  isWinner: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateStats {
  templateId: string;
  sends: number;
  sends30d: number;
  responses: number;
  conversions: number;
  responseRate: number;   // 0–1
  conversionRate: number; // 0–1
}

export interface TemplateWithStats extends ReplyTemplate {
  stats: TemplateStats;
}

// ─── Condition field metadata ─────────────────────────────────────────────────

export const CONDITION_FIELDS: Record<ConditionField, {
  label: string;
  operators: ConditionOperator[];
  valueType: "select" | "number";
  options?: string[];
}> = {
  brand_category: {
    label: "Brand Category",
    operators: ["equals", "not_equals"],
    valueType: "select",
    options: ["ecommerce", "service", "local", "b2b", "other", "no_website"],
  },
  has_website: {
    label: "Has Website",
    operators: ["equals"],
    valueType: "select",
    options: ["true", "false"],
  },
  lead_source: {
    label: "Lead Source",
    operators: ["equals", "not_equals"],
    valueType: "select",
    options: ["GHL", "INSTAGRAM (MAIN ACCOUNT)", "INSTAGRAM (BTS ACCOUNT)", "TikTok", "LinkedIn", "Manual"],
  },
  pipeline_stage: {
    label: "Pipeline Stage",
    operators: ["equals", "not_equals"],
    valueType: "select",
    options: ["New Lead", "Initial Contact Made (Verify Info)", "Demo In Progress", "Demo Sent (Completed Demo)"],
  },
  days_since_created: {
    label: "Days Since Created",
    operators: ["greater_than", "less_than"],
    valueType: "number",
  },
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "is",
  not_equals: "is not",
  greater_than: "greater than",
  less_than: "less than",
};

// ─── Condition evaluation ─────────────────────────────────────────────────────

export interface EvalContext {
  brand_category?: string;
  has_website?: boolean;
  lead_source?: string;
  pipeline_stage?: string;
  days_since_created?: number;
}

export function evaluateConditions(
  conditions: TemplateCondition[],
  ctx: EvalContext
): boolean {
  return conditions.every((c) => {
    const raw = ctx[c.field as keyof EvalContext];
    const actual = raw === undefined ? "" : String(raw);
    switch (c.operator) {
      case "equals":     return actual === c.value;
      case "not_equals": return actual !== c.value;
      case "greater_than": return Number(actual) > Number(c.value);
      case "less_than":    return Number(actual) < Number(c.value);
    }
  });
}

/** Deterministic A/B assignment — same contact always gets same variant */
export function pickAbVariant(
  templates: ReplyTemplate[],
  contactId: string
): ReplyTemplate {
  const totalWeight = templates.reduce((s, t) => s + t.weight, 0);
  // Simple hash of contactId → 0..totalWeight
  let hash = 0;
  for (let i = 0; i < contactId.length; i++) {
    hash = ((hash << 5) - hash + contactId.charCodeAt(i)) | 0;
  }
  const bucket = Math.abs(hash) % totalWeight;
  let cumulative = 0;
  for (const t of templates) {
    cumulative += t.weight;
    if (bucket < cumulative) return t;
  }
  return templates[0];
}
