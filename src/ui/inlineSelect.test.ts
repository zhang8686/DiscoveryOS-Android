import { expect, open, test } from "nsh/test";
import { createFinish } from "./InlineTextSelect";

test("a long press on the body opens the floor's text as plain selectable text", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  expect(app.shows("id:inline-select-body")).toBe(false);
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  // The whole floor's text, whole: plain text the platform can select character by character.
  expect(app.shows("text:第一行\n第二行 abc")).toBe(true);
});

test("the plain text is as tall as the floor's text, not as the row it replaced", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  // Two lines of the default body (15pt, ×1.5) is 46 points, and the text takes its own height —
  // what the bug left was the list row's whole height: hundreds of points of blank under it.
  const box = app.layout("id:inline-select-body");
  expect(box).not.toBe(null);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeLessThanOrEqual(52);
});

test("a press outside the text puts the rich body back", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  // No button of the app's: the card around the text hears the press and closes the selection.
  await app.press("label:楼层标题");
  await app.waitFor("text:长按这段正文");
  expect(app.shows("id:inline-select-body")).toBe(false);
});

test("closing waits for the platform's selection to be done, then puts the body back", async () => {
  const calls: string[] = [];
  const finish = createFinish(() => calls.push("done"));
  finish();
  // Nothing happens on the turn the selection ended on: the platform's own copy code is still
  // running there, and taking the text away inside it left the page deaf to touches.
  expect(calls).toEqual([]);
  // Twice is one close: the second would start a second state change on a gone view.
  finish();
  await new Promise((r) => setTimeout(r, 300));
  expect(calls).toEqual(["done"]);
});
