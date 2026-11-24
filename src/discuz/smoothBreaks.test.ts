import { expect, test } from "nsh/test";
import { TextView } from "nsh/base";
import { smoothDocumentBreaks } from "./smoothBreaks";

function firstContent(doc: ReturnType<typeof smoothDocumentBreaks>): any[] {
  return (doc.blocks[0] as any).content;
}

test("a br between two texts folds into one text with a newline", () => {
  const doc = TextView.parseHtml("<p>a<br>b</p>", []);
  const out = smoothDocumentBreaks(doc);
  expect(JSON.stringify(firstContent(out))).toBe(
    JSON.stringify([{ type: "text", text: "a\nb" }]),
  );
  // The input document is untouched.
  expect(JSON.stringify(firstContent(doc))).toContain('"break"');
});

test("a br after a link inserts a text newline and links survive", () => {
  const doc = TextView.parseHtml('<p><a href="https://x">go</a><br>next</p>', []);
  const out = smoothDocumentBreaks(doc);
  const c = firstContent(out);
  expect(c.some((n: any) => n.type === "break")).toBe(false);
  expect(c.some((n: any) => n.type === "link")).toBe(true);
  // The newline survives inside a text node (merged with the following run).
  expect(c.some((n: any) => n.type === "text" && n.text.indexOf("\n") >= 0)).toBe(true);
});

test("br inside a styled span and across nested blocks is folded", () => {
  const doc = TextView.parseHtml(
    "<p><font color=red>a<br>b</font></p><p>c<br>d</p>",
    [{ name: "font", tag: "font" }],
  );
  const out = smoothDocumentBreaks(doc);
  expect(JSON.stringify(out).includes('"break"')).toBe(false);
  expect(JSON.stringify(out).includes("\\n")).toBe(true);
});

test("a document with no br is returned structurally unchanged", () => {
  const doc = TextView.parseHtml("<p>plain text</p>", []);
  const out = smoothDocumentBreaks(doc);
  expect(JSON.stringify(out)).toBe(JSON.stringify(doc));
});
