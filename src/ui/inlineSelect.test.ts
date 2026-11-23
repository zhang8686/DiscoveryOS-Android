import { expect, open, test } from "nsh/test";
import { createFinish, createSelectionEnd } from "./InlineTextSelect";

test("a long press on the body opens the floor's text as an input the platform selects in", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  expect(app.shows("id:inline-select-body")).toBe(false);
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  // The whole floor's text, whole: the platform's own selection moves by character in a field.
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

test("a copy ends the selection: the platform collapses it, and the body comes back", () => {
  let closes = 0;
  const ended = createSelectionEnd(() => closes++);
  // Opening the field reports a caret, before anything is selected: not an end.
  ended(0, 0);
  expect(closes).toBe(0);
  // A long press picks a word, and the handles widen it.
  ended(2, 6);
  ended(2, 9);
  expect(closes).toBe(0);
  // Copy ends the action mode in the platform's own code, which sets the selection to its
  // end (`TextView.onTextContextMenuItem`, `ID_COPY` → `stopTextActionMode`). That is the end.
  ended(9, 9);
  expect(closes).toBe(1);
  // A later caret report is nothing new: the body is already back.
  ended(9, 9);
  expect(closes).toBe(1);
});

test("closing clears the selection off the gesture's dispatch, then puts the body back", async () => {
  const calls: string[] = [];
  const finish = createFinish(() => calls.push("clear"), () => calls.push("done"));
  finish();
  // Nothing on the turn the selection ended on: the platform's own copy code is still running
  // there, and taking the field away inside it left the page deaf to every touch afterwards.
  expect(calls).toEqual([]);
  // Twice is one close: the second would start a second state change on a gone field.
  finish();
  await new Promise((r) => setTimeout(r, 400));
  expect(calls).toEqual(["clear", "done"]);
});
