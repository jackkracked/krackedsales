/**
 * Resolve {{node_id.field.path}} variables in a string using the run context.
 */
export function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const parts = (path as string).trim().split(".");
    let value: unknown = context;
    for (const part of parts) {
      if (value == null || typeof value !== "object") return match;
      value = (value as Record<string, unknown>)[part];
    }
    if (value == null) return match;
    return String(value);
  });
}

export function interpolateConfig(
  config: Record<string, unknown>,
  context: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(config)) {
    if (typeof val === "string") {
      result[key] = interpolate(val, context);
    } else if (Array.isArray(val)) {
      result[key] = val.map((item) =>
        typeof item === "string" ? interpolate(item, context) : item
      );
    } else if (val != null && typeof val === "object") {
      result[key] = interpolateConfig(val as Record<string, unknown>, context);
    } else {
      result[key] = val;
    }
  }
  return result;
}

export function evaluateCondition(expression: string, context: Record<string, unknown>): boolean {
  try {
    const resolved = interpolate(expression, context);

    const containsMatch = resolved.match(/^(.+?)\s+contains\s+(.+)$/i);
    if (containsMatch) {
      return String(containsMatch[1]).toLowerCase().includes(
        String(containsMatch[2]).toLowerCase().trim().replace(/^["']|["']$/g, "")
      );
    }

    const existsMatch = resolved.match(/^(.+?)\s+exists$/i);
    if (existsMatch) {
      const v = existsMatch[1].trim();
      return v !== "" && v !== "undefined" && v !== "null";
    }

    const numericMatch = resolved.match(/^([\d.]+)\s*(==|!=|>=|<=|>|<)\s*([\d.]+)$/);
    if (numericMatch) {
      const l = parseFloat(numericMatch[1]);
      const r = parseFloat(numericMatch[3]);
      switch (numericMatch[2]) {
        case "==": return l === r;
        case "!=": return l !== r;
        case ">":  return l > r;
        case "<":  return l < r;
        case ">=": return l >= r;
        case "<=": return l <= r;
      }
    }

    const strMatch = resolved.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
    if (strMatch) {
      const l = strMatch[1].trim().replace(/^["']|["']$/g, "");
      const r = strMatch[3].trim().replace(/^["']|["']$/g, "");
      return strMatch[2] === "==" ? l === r : l !== r;
    }

    return resolved !== "" && resolved !== "false" && resolved !== "0" && resolved !== "null" && resolved !== "undefined";
  } catch {
    return false;
  }
}
