"use client";

// Visual (WYSIWYG) editor that stores MARKDOWN, so the same string renders on the client
// proposal (react-markdown) and in the PDF (the existing MarkdownSection parser). Constrained
// node set: bold, italic, H2/H3, bullet + ordered lists, links, horizontal rule. No raw HTML is
// ever produced or stored, so there is no XSS path on the public signing page.
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect, useRef } from "react";
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, Link2, Minus } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ─── Markdown <-> HTML (constrained set; deterministic, no deps) ─────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline markdown -> HTML: links, bold, italic (order matters: links before emphasis). */
function inlineMdToHtml(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, url) => {
    const safe = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return `<a href="${safe}">${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
  return s;
}

/** Block markdown -> HTML for the constrained set. */
export function markdownToHtml(md: string): string {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inlineMdToHtml).join("<br>")}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.type}>${list.items.map((i) => `<li>${inlineMdToHtml(i)}</li>`).join("")}</${list.type}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushPara(); flushList(); out.push("<hr>"); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); const lvl = h[1].length >= 3 ? 3 : 2; out.push(`<h${lvl}>${inlineMdToHtml(h[2])}</h${lvl}>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { flushPara(); if (list && list.type !== "ul") flushList(); if (!list) list = { type: "ul", items: [] }; list.items.push(ul[1]); continue; }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { flushPara(); if (list && list.type !== "ol") flushList(); if (!list) list = { type: "ol", items: [] }; list.items.push(ol[1]); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join("");
}

/** Serialize an element's inline children to markdown. */
function inlineHtmlToMd(node: Node): string {
  let s = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) { s += child.textContent ?? ""; return; }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = inlineHtmlToMd(el);
    if (tag === "strong" || tag === "b") s += `**${inner}**`;
    else if (tag === "em" || tag === "i") s += `*${inner}*`;
    else if (tag === "a") s += `[${inner}](${el.getAttribute("href") ?? ""})`;
    else if (tag === "br") s += "\n";
    else s += inner;
  });
  return s;
}

/** Tiptap HTML -> markdown for the constrained set. */
export function htmlToMarkdown(html: string): string {
  if (typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const blocks: string[] = [];
  doc.body.childNodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "h1" || tag === "h2") blocks.push(`## ${inlineHtmlToMd(el)}`);
    else if (tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") blocks.push(`### ${inlineHtmlToMd(el)}`);
    else if (tag === "hr") blocks.push("---");
    else if (tag === "ul") el.querySelectorAll(":scope > li").forEach((li) => blocks.push(`- ${inlineHtmlToMd(li)}`));
    else if (tag === "ol") { let n = 1; el.querySelectorAll(":scope > li").forEach((li) => blocks.push(`${n++}. ${inlineHtmlToMd(li)}`)); }
    else if (tag === "p") { const t = inlineHtmlToMd(el).trim(); if (t) blocks.push(t); }
    else { const t = inlineHtmlToMd(el).trim(); if (t) blocks.push(t); }
  });
  // Join: lists stay tight, everything else double-spaced.
  let md = "";
  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i];
    const prev = blocks[i - 1];
    const bothList = /^(- |\d+\. )/.test(cur) && prev !== undefined && /^(- |\d+\. )/.test(prev);
    if (i > 0) md += bothList ? "\n" : "\n\n";
    md += cur;
  }
  return md.trim();
}

// ─── Component ──────────────────────────────────────────────────────────────────

function TB({ active, onClick, label, children }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active && "bg-primary/10 text-primary",
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  // Track the last markdown we emitted so external prop updates don't clobber the caret,
  // and we only re-hydrate when the value genuinely changes from elsewhere.
  const lastEmitted = useRef<string>(value ?? "");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        blockquote: false,
        codeBlock: false,
        code: false,
      }),
      Link.configure({ openOnClick: false, autolink: false, HTMLAttributes: { rel: "noopener nofollow", target: "_blank" } }),
    ],
    content: markdownToHtml(value ?? ""),
    immediatelyRender: false,
    editorProps: { attributes: { class: "rte-content", "aria-label": ariaLabel ?? "Rich text editor" } },
    onUpdate: ({ editor }) => {
      const md = htmlToMarkdown(editor.getHTML());
      lastEmitted.current = md;
      onChange(md);
    },
  });

  useEffect(() => {
    if (editor && value !== lastEmitted.current) {
      lastEmitted.current = value ?? "";
      editor.commands.setContent(markdownToHtml(value ?? ""), { emitUpdate: false });
    }
  }, [value, editor]);

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className={cn("rounded-[8px] border border-border bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
        <TB label="Bold" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold className="h-3.5 w-3.5" /></TB>
        <TB label="Italic" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic className="h-3.5 w-3.5" /></TB>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <TB label="Heading" active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-3.5 w-3.5" /></TB>
        <TB label="Subheading" active={editor?.isActive("heading", { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-3.5 w-3.5" /></TB>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <TB label="Bullet list" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List className="h-3.5 w-3.5" /></TB>
        <TB label="Numbered list" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-3.5 w-3.5" /></TB>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <TB label="Link" active={editor?.isActive("link")} onClick={setLink}><Link2 className="h-3.5 w-3.5" /></TB>
        <TB label="Divider" onClick={() => editor?.chain().focus().setHorizontalRule().run()}><Minus className="h-3.5 w-3.5" /></TB>
      </div>
      <EditorContent editor={editor} className="rte-wrap px-3 py-2.5 text-sm" data-placeholder={placeholder} />
    </div>
  );
}
