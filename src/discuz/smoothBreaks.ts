import type { TextViewBlock, TextViewDocument, TextViewInline } from "nsh/base";

/**
 * v1.2.2-2 experiment: fold a TextView document's line-break nodes into the
 * text before them, as a literal "\n" inside that text node.
 *
 * Why: nsh 589a60f renders `<br>` as its own Inline::Break -> its own text
 * view, and a body's text views never set `continues_text`. The selection
 * model then treats every text view as a separate "line": the two handles
 * cannot cross a break, so a floor with `<br>` selects whole lines only.
 * A document Text node that carries "\n" in its content, on the other hand,
 * is ONE text view that wraps onto several visual lines, and its handles
 * move character by character across those lines (the same geometry as a
 * floor that has no `<br>` at all).
 *
 * We fold every `break` inline into the nearest preceding text node:
 *   [text("a"), break, text("b")]  ->  [text("a\nb")]
 * When the break follows a non-text inline (a link, a styled span, an image)
 * we insert a standalone text node carrying "\n" instead, so a line break is
 * never lost and is never left as its own selectable unit. Nested inline
 * content (strong/link/textStyle/...) and every block kind are walked too.
 *
 * Pure: returns a new document, leaves the parsed input untouched.
 */

type Inline = TextViewInline;

function foldInline(content: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of content) {
    if (node.type === "break") {
      const prev = out[out.length - 1];
      if (prev && prev.type === "text") {
        out[out.length - 1] = { type: "text", text: prev.text + "\n" };
      } else {
        out.push({ type: "text", text: "\n" });
      }
      continue;
    }
    // Inline variants that hold nested content need the same treatment.
    const n = node as unknown as { type: string; content?: Inline[] };
    if (n.content && Array.isArray(n.content)) {
      out.push({ ...node, content: foldInline(n.content) } as Inline);
    } else if (node.type === "text") {
      // The parser can split "a<br>b" into text("a\n"), text("b"): join runs
      // of adjacent texts so each visual paragraph is ONE selectable unit.
      const prev = out[out.length - 1];
      if (prev && prev.type === "text") {
        out[out.length - 1] = { type: "text", text: prev.text + node.text };
      } else {
        out.push(node);
      }
    } else {
      out.push(node);
    }
  }
  return out;
}

function walkBlock(block: TextViewBlock): TextViewBlock {
  const b = block as unknown as {
    type: string;
    content?: Inline[];
    children?: TextViewBlock[];
    items?: { children: TextViewBlock[] }[];
  };
  if (b.content) {
    return { ...block, content: foldInline(b.content) } as TextViewBlock;
  }
  if (b.children) {
    return { ...block, children: b.children.map(walkBlock) } as TextViewBlock;
  }
  if (b.items) {
    return {
      ...block,
      items: b.items.map((item) => ({ ...item, children: item.children.map(walkBlock) })),
    } as TextViewBlock;
  }
  return block;
}

export function smoothDocumentBreaks(doc: TextViewDocument): TextViewDocument {
  return {
    ...doc,
    blocks: doc.blocks.map(walkBlock),
    ...(doc.footnotes
      ? { footnotes: doc.footnotes.map((f) => ({ ...f, children: f.children.map(walkBlock) })) }
      : {}),
  };
}
