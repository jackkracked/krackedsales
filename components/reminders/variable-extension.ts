import { Node, mergeAttributes } from "@tiptap/core";
import { VAR_CATALOG } from "@/lib/reminders/variables";

/**
 * A TipTap inline atom that renders a dynamic variable as a styled pill (its friendly
 * label) while serializing to the canonical `{{token}}` form the send engine expects.
 *
 * Round-trip: stored `{{client.name}}` -> tokensToPillHtml -> `<span data-variable>` ->
 * TipTap node (pill) -> getHTML -> pillHtmlToTokens -> `{{client.name}}`. The pill is
 * atomic, so a client value can never be half-deleted into a broken token.
 */
const LABEL: Record<string, string> = Object.fromEntries(VAR_CATALOG.map((v) => [v.token, v.label]));

export const VariableNode = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { token: { default: null } };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-variable]",
        getAttrs: (el) => ({ token: (el as HTMLElement).getAttribute("data-variable") }),
      },
    ];
  },

  renderHTML({ node }) {
    const token = node.attrs.token as string;
    return [
      "span",
      mergeAttributes({ "data-variable": token, class: "rmd-pill" }),
      LABEL[token] ?? token,
    ];
  },
});

/** Stored `{{token}}` -> empty `<span data-variable="token">` for the editor to hydrate into pills. */
export function tokensToPillHtml(html: string): string {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, t) => `<span data-variable="${t}"></span>`);
}

/** Editor pill spans -> canonical `{{token}}` for storage / sending. */
export function pillHtmlToTokens(html: string): string {
  return html.replace(/<span[^>]*data-variable="([\w.]+)"[^>]*>.*?<\/span>/g, (_m, t) => `{{${t}}}`);
}

export const VARIABLE_LABEL = LABEL;
